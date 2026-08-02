/**
 * Adaptador real de CLIMA — Open-Meteo Forecast API.
 * =====================================================================
 *
 * VERIFICADO CONTRA LA DOC OFICIAL Y CONTRA LA API EN VIVO (2026-07-26):
 *   · Endpoint: https://api.open-meteo.com/v1/forecast
 *   · Multicoordenada: `latitude=-33.44,-33.40&longitude=-70.66,-70.56`.
 *     Petición real con las 52 comunas → HTTP 200, arreglo de 52, 1,3 s, 146 KB.
 *   · Variables horarias (nombres exactos, confirmados en la respuesta):
 *       precipitation             → mm
 *       precipitation_probability → %
 *       wind_speed_10m            → km/h   (unidad por defecto, confirmada en
 *                                           `hourly_units`)
 *       temperature_2m            → °C
 *   · `timezone=America/Santiago` → `time` en hora LOCAL NAIVE + un
 *     `utc_offset_seconds` aparte. Ver GOTCHA 3 de `../../open-meteo-comun.ts`.
 *   · `forecast_days`: default 7, máximo 16.
 *   · Error: HTTP 400 con cuerpo `{ "error": true, "reason": "..." }`.
 *   · Cuota del tier gratuito: 10.000 llamadas/día · 5.000/hora · 600/minuto.
 *
 * ⚠️ USO COMERCIAL: el tier gratuito NO lo permite (ver el encabezado de
 * `../../open-meteo-comun.ts`). `baseUrl` y `apiKey` son configurables por eso.
 *
 * RESILIENCIA
 *   · Timeout explícito en el fetch (`AbortSignal.timeout`).
 *   · `reintentarConBackoff` (jitter completo) solo para errores marcados
 *     reintentables — red, timeout, 429 con `Retry-After`, 5xx. Un 400 no se
 *     reintenta: quemaría cuota sin arreglar nada.
 *   · Agotados los reintentos, DEGRADA: devuelve `{ ok: false, motivo }` en vez
 *     de lanzar, para que el job escriba el estado en `contexto.fuentes_estado`
 *     y siga con las demás capas.
 *
 * IDEMPOTENCIA: este adaptador es una lectura pura (GET, sin efectos). Llamarlo
 * dos veces con los mismos parámetros produce el mismo conjunto de filas, con la
 * misma clave `(comuna, hora)`. La idempotencia de ESCRITURA la da el PK de
 * `contexto.clima_horario` con `on conflict do update` — trabajo del job (A4).
 */

import {
  reintentarConBackoff,
  type OpcionesReintento,
} from '@/modules/integraciones/resiliencia';
import {
  ErrorContextoProveedor,
  ErrorContextoRespuesta,
} from '../../errores';
import {
  obtenerJson,
  TIMEOUT_CONTEXTO_MS,
} from '../../http';
import {
  bloqueHorario,
  comoArreglo,
  construirUrlOpenMeteo,
  emparejarPorIndice,
  extraerVariable,
  horaSantiagoAInstante,
  puntosDeConsulta,
  trocear,
  type PuntoComuna,
} from '../../open-meteo-comun';
import {
  exito,
  fallo,
  MOTIVOS_DEGRADACION,
  sanearParaMensaje,
  type ResultadoContexto,
} from '../../resultado';
import type { PuertoClima } from '../puerto';
import type {
  ParametrosClima,
  PronosticoClima,
  PronosticoHoraComuna,
} from '../tipos';

const URL_FORECAST_LIBRE = 'https://api.open-meteo.com/v1/forecast';

/** Nombre de la fuente tal como lo lee un coordinador en la barra de frescura. */
const FUENTE = 'clima';

/** Horizonte por defecto: Hoy / Mañana / 72 h (§8.1 del diseño). */
const DIAS_POR_DEFECTO = 3;
const DIAS_MAXIMO = 16;

/**
 * Nombres EXACTOS de las variables horarias, verificados en la respuesta real.
 * El orden no importa; los nombres sí.
 */
const VARIABLES = [
  'precipitation',
  'precipitation_probability',
  'wind_speed_10m',
  'temperature_2m',
] as const;

export interface ConfigOpenMeteoClima {
  /** Por defecto, el host gratuito. El tier comercial usa otro host. */
  baseUrl?: string;
  /** Solo tier comercial. SECRETO: nunca se loguea ni entra en un mensaje. */
  apiKey?: string;
  timeoutMs?: number;
  /** Inyectable en pruebas para correr sin red. */
  fetchImpl?: typeof fetch;
  /** Inyectable en pruebas para no dormir de verdad. */
  reintentos?: OpcionesReintento;
}

export class OpenMeteoClimaAdapter implements PuertoClima {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl?: typeof fetch;
  private readonly reintentos: OpcionesReintento;

  constructor(config: ConfigOpenMeteoClima = {}) {
    this.baseUrl = config.baseUrl ?? URL_FORECAST_LIBRE;
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? TIMEOUT_CONTEXTO_MS;
    this.fetchImpl = config.fetchImpl;
    this.reintentos = config.reintentos ?? {};
  }

  async obtenerPronostico(
    args: ParametrosClima = {},
  ): Promise<ResultadoContexto<PronosticoClima>> {
    const dias = Math.min(Math.max(args.dias ?? DIAS_POR_DEFECTO, 1), DIAS_MAXIMO);

    let puntos: PuntoComuna[];
    try {
      puntos = puntosDeConsulta(args.comunas);
    } catch (e) {
      return fallo(
        MOTIVOS_DEGRADACION.malConfigurada(FUENTE),
        sanearParaMensaje((e as Error).message),
        false,
      );
    }

    try {
      const horas: PronosticoHoraComuna[] = [];

      // Hoy son 52 comunas → un solo lote. El bucle existe para que consultar
      // más puntos algún día no reviente la URL en silencio.
      for (const lote of trocear(puntos)) {
        horas.push(...(await this.consultarLote(lote, dias)));
      }

      return exito({
        proveedor: 'open-meteo',
        horas,
        comunasResueltas: puntos.map((p) => p.comuna),
      });
    } catch (e) {
      return this.degradar(e);
    }
  }

  /** Una petición HTTP con reintentos; devuelve las filas ya normalizadas. */
  private async consultarLote(
    lote: readonly PuntoComuna[],
    dias: number,
  ): Promise<PronosticoHoraComuna[]> {
    const url = construirUrlOpenMeteo({
      baseUrl: this.baseUrl,
      puntos: lote,
      variablesHorarias: VARIABLES,
      forecastDays: dias,
      apiKey: this.apiKey,
    });

    const cuerpo = await reintentarConBackoff(
      () =>
        obtenerJson<unknown>(url, {
          timeoutMs: this.timeoutMs,
          fetchImpl: this.fetchImpl,
        }),
      this.reintentos,
    );

    return this.normalizar(lote, cuerpo);
  }

  /**
   * Traduce la respuesta cruda a filas de `contexto.clima_horario`.
   * El emparejamiento comuna↔resultado es POSICIONAL y se valida — ver GOTCHA 2.
   */
  private normalizar(
    lote: readonly PuntoComuna[],
    cuerpo: unknown,
  ): PronosticoHoraComuna[] {
    const pares = emparejarPorIndice(lote, comoArreglo(cuerpo));
    const filas: PronosticoHoraComuna[] = [];

    for (const { punto, resultado } of pares) {
      const bloque = bloqueHorario(resultado, punto.comuna);
      const marcas = bloque.time;

      const precipitacion = extraerVariable(bloque, 'precipitation', marcas.length);
      const probabilidad = extraerVariable(
        bloque,
        'precipitation_probability',
        marcas.length,
      );
      const viento = extraerVariable(bloque, 'wind_speed_10m', marcas.length);
      const temperatura = extraerVariable(bloque, 'temperature_2m', marcas.length);

      for (let i = 0; i < marcas.length; i += 1) {
        // La columna es `smallint check (between 0 and 100)`: se redondea aquí
        // para que un decimal del modelo no reviente el INSERT.
        const prob = probabilidad[i];

        filas.push({
          comuna: punto.comuna,
          hora: horaSantiagoAInstante(marcas[i]),
          precipitacionMm: precipitacion[i],
          probPrecipitacion: prob === null ? null : Math.round(prob),
          vientoKmh: viento[i],
          tempC: temperatura[i],
        });
      }
    }

    return filas;
  }

  /** Traduce cualquier fallo a un resultado degradado, sin lanzar. */
  private degradar(e: unknown): ResultadoContexto<PronosticoClima> {
    if (e instanceof ErrorContextoRespuesta) {
      return fallo(
        MOTIVOS_DEGRADACION.respuestaIlegible(FUENTE),
        sanearParaMensaje(e.message),
        false,
      );
    }
    if (e instanceof ErrorContextoProveedor) {
      if (!e.reintentable && e.codigoHttp !== null) {
        return fallo(
          MOTIVOS_DEGRADACION.peticionRechazada(FUENTE),
          sanearParaMensaje(e.message),
          false,
        );
      }
      return fallo(
        e.codigoHttp === null
          ? MOTIVOS_DEGRADACION.sinRespuesta(FUENTE)
          : MOTIVOS_DEGRADACION.errorProveedor(FUENTE),
        sanearParaMensaje(e.message),
        true,
      );
    }
    return fallo(
      MOTIVOS_DEGRADACION.errorProveedor(FUENTE),
      sanearParaMensaje(e instanceof Error ? e.message : String(e)),
      true,
    );
  }
}
