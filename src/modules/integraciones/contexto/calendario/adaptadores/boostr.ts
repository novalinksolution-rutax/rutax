/**
 * Adaptador real de FERIADOS — api.boostr.cl.
 * =====================================================================
 *
 * VERIFICADO EN VIVO (2026-07-26):
 *   · `GET https://api.boostr.cl/holidays.json`        → año en curso, HTTP 200.
 *   · `GET https://api.boostr.cl/holidays/{anio}.json` → año específico; probado
 *     con 2027 y respondió 200 con datos.
 *   · Sin API key. Sin autenticación. `access-control-allow-origin: *`.
 *   · Forma de la respuesta (literal):
 *       { "status": "success",
 *         "data": [ { "date": "2026-01-01",
 *                     "title": "Año Nuevo",
 *                     "type": "Civil",
 *                     "inalienable": true,
 *                     "extra": "Civil e Irrenunciable" }, … ] }
 *   · GOTCHA DE NOMBRE: la marca de irrenunciable se llama **`inalienable`**, no
 *     `irrenunciable`. Leer el campo equivocado daría `undefined` → `false` en
 *     silencio, y el courier programaría reparto un 18 de septiembre.
 *   · El servicio expone cabeceras de límite de tasa
 *     (`ratelimit-limit` / `ratelimit-remaining` / `ratelimit-reset`, listadas
 *     en `access-control-expose-headers`). No venían en la respuesta observada
 *     porque estaba servida desde caché de Cloudflare (`age: 290`). El adaptador
 *     respeta `Retry-After` ante un 429 igual que los demás — no se hardcodea
 *     ningún número de cuota, que es lo que exige la regla 4 del README de
 *     `integraciones`.
 *
 * ⚠️ **NO usar `apis.digital.gob.cl`.** El API oficial de feriados del Estado
 * está caído y su dominio ya no resuelve, pese a que medio internet lo sigue
 * citando. §4 del diseño lo advierte explícitamente.
 *
 * CADENCIA: el job es mensual (§6). Un calendario de feriados cambia una vez al
 * año por ley; consultarlo más seguido no aporta y sí consume la cuota de un
 * servicio gratuito de un tercero.
 *
 * IDEMPOTENCIA: lectura pura. Repetir la llamada devuelve el mismo conjunto, con
 * la misma clave `(fecha, nombre)` del PK de `contexto.calendario`.
 */

import {
  reintentarConBackoff,
  type OpcionesReintento,
} from '@/modules/integraciones/resiliencia';
import { ErrorContextoProveedor, ErrorContextoRespuesta } from '../../errores';
import { obtenerJson, TIMEOUT_CONTEXTO_MS } from '../../http';
import {
  exito,
  fallo,
  MOTIVOS_DEGRADACION,
  sanearParaMensaje,
  type ResultadoContexto,
} from '../../resultado';
import { anioActualEnSantiago } from '../anio';
import type { PuertoCalendario } from '../puerto';
import type {
  CalendarioFeriados,
  Feriado,
  ParametrosCalendario,
} from '../tipos';

const BASE_BOOSTR = 'https://api.boostr.cl';

const FUENTE = 'feriados';

/** Timeout más corto que el de Open-Meteo: la respuesta pesa ~2 KB. */
const TIMEOUT_MS = 10_000;

/** Forma parcial de la respuesta de boostr que consumimos. */
interface RespuestaBoostr {
  status?: string;
  data?: Array<{
    date?: unknown;
    title?: unknown;
    type?: unknown;
    /** Sí: `inalienable`, no `irrenunciable`. Ver el gotcha del encabezado. */
    inalienable?: unknown;
    extra?: unknown;
  }>;
}

export interface ConfigBoostr {
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  reintentos?: OpcionesReintento;
}

export class BoostrCalendarioAdapter implements PuertoCalendario {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl?: typeof fetch;
  private readonly reintentos: OpcionesReintento;

  constructor(config: ConfigBoostr = {}) {
    this.baseUrl = config.baseUrl ?? BASE_BOOSTR;
    this.timeoutMs = config.timeoutMs ?? Math.min(TIMEOUT_MS, TIMEOUT_CONTEXTO_MS);
    this.fetchImpl = config.fetchImpl;
    this.reintentos = config.reintentos ?? {};
  }

  async obtenerFeriados(
    args: ParametrosCalendario = {},
  ): Promise<ResultadoContexto<CalendarioFeriados>> {
    const anios = [...(args.anios ?? [anioActualEnSantiago()])];

    try {
      const feriados: Feriado[] = [];
      for (const anio of anios) {
        feriados.push(...(await this.consultarAnio(anio)));
      }
      return exito({ proveedor: 'boostr', feriados, aniosResueltos: anios });
    } catch (e) {
      return this.degradar(e);
    }
  }

  private async consultarAnio(anio: number): Promise<Feriado[]> {
    if (!Number.isInteger(anio) || anio < 1900 || anio > 2999) {
      throw new ErrorContextoRespuesta(`año fuera de rango: ${anio}`);
    }

    const url = new URL(`${this.baseUrl}/holidays/${anio}.json`);

    const cuerpo = await reintentarConBackoff(
      () =>
        obtenerJson<RespuestaBoostr>(url, {
          timeoutMs: this.timeoutMs,
          fetchImpl: this.fetchImpl,
        }),
      this.reintentos,
    );

    return this.normalizar(cuerpo, anio);
  }

  private normalizar(cuerpo: RespuestaBoostr, anio: number): Feriado[] {
    if (cuerpo.status !== undefined && cuerpo.status !== 'success') {
      throw new ErrorContextoRespuesta(
        `boostr respondió status='${String(cuerpo.status)}' para ${anio}`,
      );
    }
    if (!Array.isArray(cuerpo.data)) {
      throw new ErrorContextoRespuesta(`falta el arreglo 'data' para ${anio}`);
    }

    const feriados: Feriado[] = [];
    for (const bruto of cuerpo.data) {
      const fecha = typeof bruto.date === 'string' ? bruto.date.trim() : '';
      const nombre = typeof bruto.title === 'string' ? bruto.title.trim() : '';

      // Una entrada malformada NO tumba el lote: se descarta y las demás
      // entran. Un feriado perdido es un dato menos; una excepción aquí deja al
      // courier sin ningún calendario.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || nombre === '') continue;

      feriados.push({
        fecha,
        nombre,
        tipo: typeof bruto.type === 'string' && bruto.type.trim() !== ''
          ? bruto.type.trim()
          : 'Desconocido',
        irrenunciable: bruto.inalienable === true,
      });
    }

    if (feriados.length === 0) {
      throw new ErrorContextoRespuesta(
        `boostr no devolvió ningún feriado utilizable para ${anio}`,
      );
    }

    return feriados;
  }

  private degradar(e: unknown): ResultadoContexto<CalendarioFeriados> {
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
