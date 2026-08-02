/**
 * Adaptador real de CLIMA — OpenWeather «5 day / 3 hour forecast».
 * =====================================================================
 *
 * VERIFICADO CONTRA LA DOCUMENTACIÓN OFICIAL (2026-07-27):
 *   · Endpoint: https://api.openweathermap.org/data/2.5/forecast
 *   · Paso de 3 horas, 5 días, hasta 40 puntos por llamada (`cnt` los recorta).
 *   · UNA coordenada por llamada — no admite multicoordenada. De ahí la grilla
 *     de 14 puntos (`../../grilla-rm.ts`): 14 llamadas por ciclo, no 52.
 *   · Campos usados: `dt` (Unix s UTC), `main.temp` (°C con `units=metric`),
 *     `wind.speed` (**m/s**, ver trampa 1 del común), `rain.3h` (mm acumulados
 *     en el paso), `pop` (probabilidad 0–1).
 *   · Tier gratuito: sin tarjeta, uso comercial permitido, atribución visible
 *     obligatoria. Cuota 60/min y 1.000.000/mes.
 *
 * -----------------------------------------------------------------------------
 * QUÉ FILA SE ESCRIBE Y POR QUÉ NO SE INVENTAN LAS HORAS INTERMEDIAS
 * -----------------------------------------------------------------------------
 * El pronóstico gratuito trae un punto cada 3 horas. Se emite **una fila por
 * punto**, en su propio instante, y NO se rellenan las dos horas intermedias.
 *
 * Rellenarlas sería fácil y sería peor: tres filas idénticas parecen tres
 * mediciones y son una sola, y cualquiera que después cuente filas o promedie
 * estaría ponderando un dato inventado. Los huecos no molestan al motor de
 * riesgo, que agrega por franja de 4–5 horas tomando el MÁXIMO: cada franja
 * contiene al menos un punto real.
 *
 * Lo que sí se transforma es la unidad: `rain.3h` es un acumulado de tres horas
 * y la columna guarda mm por hora, así que se divide. Escribirlo crudo
 * triplicaría la lluvia que ve el motor.
 *
 * RESILIENCIA · IDEMPOTENCIA: igual que el resto del módulo — reintentos con
 * backoff solo para lo reintentable, y ante fallo definitivo DEGRADA con
 * `{ ok: false, motivo }` en vez de lanzar. Es una lectura pura: dos llamadas
 * con los mismos parámetros producen las mismas filas con la misma clave
 * `(comuna, hora)`.
 */

import {
  reintentarConBackoff,
  type OpcionesReintento,
} from '@/modules/integraciones/resiliencia';
import type { ComunaRM } from '@/lib/ui/comunas-rm';
import { ErrorContextoProveedor, ErrorContextoRespuesta } from '../../errores';
import { obtenerJson, TIMEOUT_CONTEXTO_MS } from '../../http';
import { agruparComunasPorPunto, type PuntoGrilla } from '../../grilla-rm';
import {
  comoLista,
  construirUrlOpenWeather,
  instanteDesdeDt,
  intensidadPorHora,
  numeroOpcional,
  vientoAKmh,
} from '../../openweather-comun';
import {
  exito,
  fallo,
  MOTIVOS_DEGRADACION,
  sanearParaMensaje,
  type ResultadoContexto,
} from '../../resultado';
import type { PuertoClima } from '../puerto';
import type { ParametrosClima, PronosticoClima, PronosticoHoraComuna } from '../tipos';

const RUTA = '/data/2.5/forecast';
const FUENTE = 'clima';

/** Horizonte por defecto: Hoy / Mañana / 72 h. */
const DIAS_POR_DEFECTO = 3;
const DIAS_MAXIMO = 5;

/** Puntos por día del paso de 3 h. */
const PUNTOS_POR_DIA = 8;

export interface ConfigOpenWeatherClima {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  /** Inyectable en pruebas para correr sin red. */
  fetchImpl?: typeof fetch;
  /** Inyectable en pruebas para no dormir de verdad. */
  reintentos?: OpcionesReintento;
}

export class OpenWeatherClimaAdapter implements PuertoClima {
  private readonly apiKey: string;
  private readonly baseUrl?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl?: typeof fetch;
  private readonly reintentos: OpcionesReintento;

  constructor(config: ConfigOpenWeatherClima = {}) {
    this.apiKey = config.apiKey ?? '';
    this.baseUrl = config.baseUrl;
    this.timeoutMs = config.timeoutMs ?? TIMEOUT_CONTEXTO_MS;
    this.fetchImpl = config.fetchImpl;
    this.reintentos = config.reintentos ?? {};
  }

  async obtenerPronostico(
    args: ParametrosClima = {},
  ): Promise<ResultadoContexto<PronosticoClima>> {
    const dias = Math.min(Math.max(args.dias ?? DIAS_POR_DEFECTO, 1), DIAS_MAXIMO);
    const grupos = agruparComunasPorPunto(args.comunas);

    try {
      const horas: PronosticoHoraComuna[] = [];
      const comunasResueltas: ComunaRM[] = [];

      for (const { punto, comunas } of grupos) {
        const puntosDelPronostico = await this.consultarPunto(punto, dias);
        // El mismo pronóstico se replica a todas las comunas que comparten el
        // punto: la fila es por comuna porque la tabla lo es, pero el dato es
        // uno solo y la grilla lo declara así (ver `grilla-rm.ts`).
        for (const comuna of comunas) {
          for (const p of puntosDelPronostico) horas.push({ ...p, comuna });
          comunasResueltas.push(comuna);
        }
      }

      return exito({ proveedor: 'openweather', horas, comunasResueltas });
    } catch (e) {
      return this.degradar(e);
    }
  }

  private async consultarPunto(
    punto: PuntoGrilla,
    dias: number,
  ): Promise<Omit<PronosticoHoraComuna, 'comuna'>[]> {
    const url = construirUrlOpenWeather({
      baseUrl: this.baseUrl,
      ruta: RUTA,
      lat: punto.lat,
      long: punto.long,
      apiKey: this.apiKey,
      extra: { units: 'metric', cnt: dias * PUNTOS_POR_DIA },
    });

    const cuerpo = await reintentarConBackoff(
      () =>
        obtenerJson<unknown>(url, {
          timeoutMs: this.timeoutMs,
          fetchImpl: this.fetchImpl,
        }),
      this.reintentos,
    );

    return normalizarPronostico(cuerpo);
  }

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
      // Una configuración mala (clave ausente) no se arregla reintentando.
      false,
    );
  }
}

/**
 * Respuesta cruda → filas sin comuna. Exportada para probarla contra un fixture
 * sin montar el adaptador entero.
 */
export function normalizarPronostico(
  cuerpo: unknown,
): Omit<PronosticoHoraComuna, 'comuna'>[] {
  const filas: Omit<PronosticoHoraComuna, 'comuna'>[] = [];

  for (const item of comoLista(cuerpo)) {
    const hora = instanteDesdeDt(item.dt);
    if (!hora) continue; // sin instante no hay fila que escribir

    const main = (item.main ?? {}) as Record<string, unknown>;
    const wind = (item.wind ?? {}) as Record<string, unknown>;
    const rain = (item.rain ?? {}) as Record<string, unknown>;

    // `pop` viene 0–1; la columna es smallint 0–100. Sin `pop` NO se pone 0:
    // «no sé» y «no va a llover» no son lo mismo.
    const pop = numeroOpcional(item.pop);

    filas.push({
      hora,
      // Sin bloque `rain` la API está diciendo que no llueve en ese paso: ahí
      // el 0 SÍ es el dato, no una suposición.
      precipitacionMm:
        item.rain === undefined ? 0 : intensidadPorHora(numeroOpcional(rain['3h'])),
      probPrecipitacion: pop === null ? null : Math.round(pop * 100),
      vientoKmh: vientoAKmh(numeroOpcional(wind.speed)),
      tempC: numeroOpcional(main.temp),
    });
  }

  return filas;
}
