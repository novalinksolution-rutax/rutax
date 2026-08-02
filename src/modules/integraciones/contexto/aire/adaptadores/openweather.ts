/**
 * Adaptador real de CALIDAD DEL AIRE — OpenWeather Air Pollution API.
 * =====================================================================
 *
 * VERIFICADO CONTRA LA DOCUMENTACIÓN OFICIAL (2026-07-27):
 *   · Pronóstico: /data/2.5/air_pollution/forecast — **horario, 4 días**.
 *   · Histórico:  /data/2.5/air_pollution/history?start&end (Unix s), con datos
 *     desde el 27-nov-2020 y sin restricción de plan documentada.
 *   · Campos: `dt` (Unix s UTC), `components.pm2_5` y `components.pm10` en
 *     µg/m³, `main.aqi` 1–5 (no se usa: el índice de OpenWeather no es la
 *     escala chilena de episodios).
 *   · UNA coordenada por llamada → grilla de 14 puntos (`../../grilla-rm.ts`).
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ ESTA FUENTE Y NO SINCA
 * -----------------------------------------------------------------------------
 * SINCA (MMA) es la red oficial y es quien sostiene la declaración de episodios,
 * pero **publica observaciones horarias por estación, no pronóstico** — se
 * verificó su JSON en vivo. La Torre es una consola de ANTICIPACIÓN a 24–72 h:
 * alimentar el factor aire con lo que ya pasó le quita su única razón de ser. Es
 * el mismo motivo por el que antes se descartó la DMC para clima.
 *
 * SINCA sigue siendo la fuente correcta para «qué está midiendo la ciudad ahora
 * mismo» y para contrastar el pronóstico contra la realidad. Cuando se quiera
 * eso, es un adaptador NUEVO detrás de este mismo puerto, no un reemplazo.
 *
 * -----------------------------------------------------------------------------
 * LA VENTANA DE 24 HORAS NO ES UN DETALLE
 * -----------------------------------------------------------------------------
 * El nivel de episodio se define sobre el **promedio móvil de 24 h** de PM2.5
 * (Plan Operacional GEC del MMA; ver `../niveles.ts`). Si la serie empieza
 * «ahora», la primera hora se promedia contra sí misma y las primeras horas
 * quedan con ventana corta — justo las horas que el coordinador mira hoy.
 *
 * Por eso se pide primero el histórico de las últimas 24 h y se antepone a la
 * serie. Las filas del pasado se clasifican igual pero **no se devuelven**: solo
 * existen para que la primera hora pronosticada llegue con la ventana llena.
 *
 * Si el histórico falla, el adaptador **sigue** con el pronóstico solo: es
 * preferible una media de arranque corta a quedarse sin capa de aire. Queda
 * dicho aquí porque en ese caso las primeras horas subestiman el nivel.
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
  numeroOpcional,
} from '../../openweather-comun';
import {
  exito,
  fallo,
  MOTIVOS_DEGRADACION,
  sanearParaMensaje,
  type ResultadoContexto,
} from '../../resultado';
import { clasificarSerie } from '../niveles';
import type { PuertoAire } from '../puerto';
import type { ParametrosAire, PronosticoAireHorario, PronosticoHoraAire } from '../tipos';

const RUTA_PRONOSTICO = '/data/2.5/air_pollution/forecast';
const RUTA_HISTORICO = '/data/2.5/air_pollution/history';
const FUENTE = 'aire';

const DIAS_POR_DEFECTO = 3;
const DIAS_MAXIMO = 4;

/** Horas de siembra para que la media móvil arranque con ventana llena. */
const HORAS_SIEMBRA = 24;

export interface ConfigOpenWeatherAire {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  reintentos?: OpcionesReintento;
  /** Reloj inyectable: la ventana histórica se calcula desde «ahora». */
  ahora?: () => Date;
}

/** Una lectura cruda, antes de clasificar. */
interface LecturaAire {
  hora: Date;
  pm25: number | null;
  pm10: number | null;
  esProyeccion: boolean;
}

export class OpenWeatherAireAdapter implements PuertoAire {
  private readonly apiKey: string;
  private readonly baseUrl?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl?: typeof fetch;
  private readonly reintentos: OpcionesReintento;
  private readonly ahora: () => Date;

  constructor(config: ConfigOpenWeatherAire = {}) {
    this.apiKey = config.apiKey ?? '';
    this.baseUrl = config.baseUrl;
    this.timeoutMs = config.timeoutMs ?? TIMEOUT_CONTEXTO_MS;
    this.fetchImpl = config.fetchImpl;
    this.reintentos = config.reintentos ?? {};
    this.ahora = config.ahora ?? (() => new Date());
  }

  async obtenerPronostico(
    args: ParametrosAire = {},
  ): Promise<ResultadoContexto<PronosticoAireHorario>> {
    const dias = Math.min(Math.max(args.dias ?? DIAS_POR_DEFECTO, 1), DIAS_MAXIMO);
    const grupos = agruparComunasPorPunto(args.comunas);

    try {
      const horas: PronosticoHoraAire[] = [];
      const comunasResueltas: ComunaRM[] = [];

      for (const { punto, comunas } of grupos) {
        const clasificadas = await this.consultarPunto(punto, dias);
        for (const comuna of comunas) {
          for (const fila of clasificadas) horas.push({ ...fila, comuna });
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
  ): Promise<Omit<PronosticoHoraAire, 'comuna'>[]> {
    const siembra = await this.consultarSiembra(punto);
    const pronostico = await this.consultarPronostico(punto, dias);

    return clasificarConVentana(siembra, pronostico);
  }

  private async consultarPronostico(punto: PuntoGrilla, dias: number): Promise<LecturaAire[]> {
    const url = construirUrlOpenWeather({
      baseUrl: this.baseUrl,
      ruta: RUTA_PRONOSTICO,
      lat: punto.lat,
      long: punto.long,
      apiKey: this.apiKey,
    });

    const cuerpo = await reintentarConBackoff(
      () => obtenerJson<unknown>(url, { timeoutMs: this.timeoutMs, fetchImpl: this.fetchImpl }),
      this.reintentos,
    );

    const limite = new Date(this.ahora().getTime() + dias * 24 * 3_600_000);
    return leerLecturas(cuerpo, true).filter((l) => l.hora <= limite);
  }

  /**
   * Las 24 h previas. **Su fallo no es fatal**: sin siembra la serie sigue, solo
   * que las primeras horas quedan con ventana corta. Preferir eso a apagar la
   * capa entera es la misma regla de degradación que rige todo el módulo.
   */
  private async consultarSiembra(punto: PuntoGrilla): Promise<LecturaAire[]> {
    const fin = this.ahora();
    const inicio = new Date(fin.getTime() - HORAS_SIEMBRA * 3_600_000);

    try {
      const url = construirUrlOpenWeather({
        baseUrl: this.baseUrl,
        ruta: RUTA_HISTORICO,
        lat: punto.lat,
        long: punto.long,
        apiKey: this.apiKey,
        extra: {
          start: Math.floor(inicio.getTime() / 1000),
          end: Math.floor(fin.getTime() / 1000),
        },
      });

      const cuerpo = await reintentarConBackoff(
        () => obtenerJson<unknown>(url, { timeoutMs: this.timeoutMs, fetchImpl: this.fetchImpl }),
        this.reintentos,
      );

      return leerLecturas(cuerpo, false);
    } catch {
      // Silencio deliberado y acotado: la ausencia de siembra no cambia qué
      // filas se devuelven, solo el ancho de la ventana de las primeras. No se
      // propaga porque no es un fallo de la capa.
      return [];
    }
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
      false,
    );
  }
}

/** Respuesta cruda → lecturas ordenadas por hora. Exportada para probarla. */
export function leerLecturas(cuerpo: unknown, esProyeccion: boolean): LecturaAire[] {
  const lecturas: LecturaAire[] = [];

  for (const item of comoLista(cuerpo)) {
    const hora = instanteDesdeDt(item.dt);
    if (!hora) continue;
    const componentes = (item.components ?? {}) as Record<string, unknown>;
    lecturas.push({
      hora,
      pm25: numeroOpcional(componentes.pm2_5),
      pm10: numeroOpcional(componentes.pm10),
      esProyeccion,
    });
  }

  return lecturas.sort((a, b) => a.hora.getTime() - b.hora.getTime());
}

/**
 * Clasifica el pronóstico con la ventana móvil sembrada por el histórico.
 *
 * La siembra entra al cálculo y **sale del resultado**: son horas ya pasadas y
 * la Torre no las pinta. Escribirlas también sería inofensivo para la BD (el
 * upsert las absorbe) pero ensuciaría la respuesta del puerto con filas que
 * nadie pidió.
 */
export function clasificarConVentana(
  siembra: readonly LecturaAire[],
  pronostico: readonly LecturaAire[],
): Omit<PronosticoHoraAire, 'comuna'>[] {
  const serie = [...siembra, ...pronostico];
  const clasificada = clasificarSerie(serie.map((l) => l.pm25));

  return pronostico.map((lectura, i) => {
    const { media24h, nivel } = clasificada[siembra.length + i];
    return {
      hora: lectura.hora,
      pm25: lectura.pm25,
      pm10: lectura.pm10,
      media24hPm25: media24h,
      nivelEstimado: nivel,
      esProyeccion: lectura.esProyeccion,
    };
  });
}
