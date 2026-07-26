/**
 * Adaptador real de CALIDAD DEL AIRE — Open-Meteo Air Quality API.
 * =====================================================================
 *
 * VERIFICADO CONTRA LA DOC OFICIAL Y CONTRA LA API EN VIVO (2026-07-26):
 *   · Endpoint: https://air-quality-api.open-meteo.com/v1/air-quality
 *   · Variables horarias: `pm2_5` y `pm10`, ambas en µg/m³ (confirmado en
 *     `hourly_units`: "μg/m³").
 *   · `forecast_days` 0–7 (default 5) · `past_days` 0–92 (default 0).
 *   · Multicoordenada igual que el endpoint de clima → arreglo, mismo orden.
 *   · `forecast_days=3` devolvió exactamente 72 horas, como anticipa §4.
 *   · Medición real de Santiago ese día: pm2_5 arrancando en 97,3 µg/m³.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ SE PIDE `past_days=1` AUNQUE SOLO INTERESE EL FUTURO
 * -----------------------------------------------------------------------------
 * El nivel de episodio se define sobre el PROMEDIO MÓVIL DE 24 HORAS de PM2.5
 * (ver `../niveles.ts` y su cita del Cuadro 1 del Plan Operacional GEC 2026).
 * Sin las 24 h previas, la primera hora del horizonte tendría una ventana de un
 * solo dato y su "promedio de 24 h" sería en realidad una lectura horaria — que
 * en Santiago en invierno pasa de 90 µg/m³ con toda normalidad. El resultado
 * sería una preemergencia fantasma en la primera hora de cada ciclo, cada hora,
 * todos los días. `past_days=1` cierra ese agujero por 24 filas extra de
 * respuesta.
 *
 * Las horas pasadas se devuelven marcadas `esProyeccion: false` y el job puede
 * descartarlas o guardarlas; lo que NO puede es clasificar sin ellas.
 *
 * RESILIENCIA e IDEMPOTENCIA: idénticas a las del adaptador de clima —
 * timeout explícito, `reintentarConBackoff` solo para lo transitorio, y
 * degradación a `{ ok: false, motivo }` en vez de excepción. Lectura pura (GET);
 * la idempotencia de escritura la da el PK `(comuna, hora)` de
 * `contexto.aire_horario`.
 */

import {
  reintentarConBackoff,
  type OpcionesReintento,
} from '@/modules/integraciones/resiliencia';
import { ErrorContextoProveedor, ErrorContextoRespuesta } from '../../errores';
import { obtenerJson, TIMEOUT_CONTEXTO_MS } from '../../http';
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
import { clasificarSerie } from '../niveles';
import type { PuertoAire } from '../puerto';
import type {
  ParametrosAire,
  PronosticoAireHorario,
  PronosticoHoraAire,
} from '../tipos';

const URL_AIRE_LIBRE = 'https://air-quality-api.open-meteo.com/v1/air-quality';

const FUENTE = 'calidad del aire';

/** 72 h, el horizonte que §4 documenta para esta fuente. */
const DIAS_POR_DEFECTO = 3;
/** Tope del endpoint de calidad del aire (distinto al de clima, que es 16). */
const DIAS_MAXIMO = 7;

/** Historia necesaria para que la media móvil de 24 h tenga ventana completa. */
const DIAS_PASADOS = 1;

const VARIABLES = ['pm2_5', 'pm10'] as const;

export interface ConfigOpenMeteoAire {
  baseUrl?: string;
  /** Solo tier comercial. SECRETO: nunca se loguea. */
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  reintentos?: OpcionesReintento;
}

export class OpenMeteoAireAdapter implements PuertoAire {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl?: typeof fetch;
  private readonly reintentos: OpcionesReintento;

  constructor(config: ConfigOpenMeteoAire = {}) {
    this.baseUrl = config.baseUrl ?? URL_AIRE_LIBRE;
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? TIMEOUT_CONTEXTO_MS;
    this.fetchImpl = config.fetchImpl;
    this.reintentos = config.reintentos ?? {};
  }

  async obtenerPronostico(
    args: ParametrosAire = {},
  ): Promise<ResultadoContexto<PronosticoAireHorario>> {
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
      const horas: PronosticoHoraAire[] = [];
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

  private async consultarLote(
    lote: readonly PuntoComuna[],
    dias: number,
  ): Promise<PronosticoHoraAire[]> {
    const url = construirUrlOpenMeteo({
      baseUrl: this.baseUrl,
      puntos: lote,
      variablesHorarias: VARIABLES,
      forecastDays: dias,
      pastDays: DIAS_PASADOS,
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

  private normalizar(
    lote: readonly PuntoComuna[],
    cuerpo: unknown,
  ): PronosticoHoraAire[] {
    const pares = emparejarPorIndice(lote, comoArreglo(cuerpo));
    const filas: PronosticoHoraAire[] = [];
    const ahora = Date.now();

    for (const { punto, resultado } of pares) {
      const bloque = bloqueHorario(resultado, punto.comuna);
      const marcas = bloque.time;

      const pm25 = extraerVariable(bloque, 'pm2_5', marcas.length);
      const pm10 = extraerVariable(bloque, 'pm10', marcas.length);

      // La clasificación se hace sobre la SERIE COMPLETA (incluidas las horas
      // pasadas que trajimos con `past_days`), porque la media móvil de cada
      // hora necesita mirar hacia atrás. Clasificar hora por hora aislada sería
      // el bug que este módulo no puede permitirse.
      const clasificada = clasificarSerie(pm25);

      for (let i = 0; i < marcas.length; i += 1) {
        const hora = horaSantiagoAInstante(marcas[i]);
        filas.push({
          comuna: punto.comuna,
          hora,
          pm25: pm25[i],
          pm10: pm10[i],
          media24hPm25: clasificada[i].media24h,
          nivelEstimado: clasificada[i].nivel,
          esProyeccion: hora.getTime() > ahora,
        });
      }
    }

    return filas;
  }

  private degradar(e: unknown): ResultadoContexto<PronosticoAireHorario> {
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
