/**
 * Fetch con timeout explícito y clasificación de errores, para los tres puertos
 * de contexto.
 * =====================================================================
 *
 * "Timeouts explícitos en todo fetch. Nada de esperar indefinidamente." Un
 * `fetch` sin `AbortSignal` puede colgarse hasta el timeout del runtime (en
 * Vercel, hasta que muere la función), y un job de ingesta colgado es peor que
 * un job que degrada: la capa nunca se marca "sin datos" y la barra de frescura
 * miente.
 *
 * Mismo patrón que ya usa el repo (`notificaciones/email/adaptadores/resend.ts`,
 * `api-publica/jobs/entregar-webhook.ts`, `lib/observabilidad`):
 * `AbortSignal.timeout(ms)`.
 *
 * Clasificación (lo que decide si `reintentarConBackoff` reintenta):
 *   · red caída / DNS / TLS / timeout  → reintentable
 *   · HTTP 429                          → reintentable, respeta `Retry-After`
 *   · HTTP 5xx                          → reintentable
 *   · HTTP 4xx (≠429)                   → NO reintentable (la petición está mal)
 *   · JSON ilegible                     → NO reintentable
 *
 * SEGURIDAD: nunca se cita la URL completa en un mensaje de error. Si algún día
 * se contrata el tier comercial de Open-Meteo, la `apikey` viaja en el query
 * string; citar la URL la filtraría al log. Se cita solo el host + path.
 */

import { ErrorContextoProveedor, ErrorContextoRespuesta } from './errores';

/** Timeout por defecto. 52 comunas en una llamada tardan ~1,3 s medidos. */
export const TIMEOUT_CONTEXTO_MS = 15_000;

/**
 * Host + path de una URL, SIN query string. Es lo único seguro de citar en un
 * mensaje de error: el query puede llevar `apikey`.
 */
export function referenciaSegura(url: URL | string): string {
  try {
    const u = typeof url === 'string' ? new URL(url) : url;
    return `${u.host}${u.pathname}`;
  } catch {
    return '(url ilegible)';
  }
}

/**
 * Interpreta el header `Retry-After` (segundos o fecha HTTP) a milisegundos.
 * Devuelve `undefined` si no está o no se entiende — el backoff calculado toma
 * el relevo.
 */
export function retryAfterAMs(valor: string | null): number | undefined {
  if (!valor) return undefined;

  const segundos = Number(valor);
  if (Number.isFinite(segundos) && segundos >= 0) {
    return Math.round(segundos * 1000);
  }

  const fecha = Date.parse(valor);
  if (Number.isFinite(fecha)) {
    const delta = fecha - Date.now();
    return delta > 0 ? delta : 0;
  }

  return undefined;
}

/**
 * GET + JSON con timeout y errores clasificados.
 *
 * Lanza `ErrorContextoProveedor` (reintentable o no, según el caso) o
 * `ErrorContextoRespuesta`. NO devuelve `ResultadoContexto`: eso lo construye el
 * adaptador después de agotar los reintentos, porque solo él sabe cómo nombrar
 * la fuente de cara al usuario.
 *
 * `fetchImpl` se inyecta en pruebas — así los tests del adaptador corren con un
 * fixture y sin red, que es la condición para que sirvan en CI.
 */
export async function obtenerJson<T>(
  url: URL,
  opciones: {
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
    /** Cabeceras extra. Nunca poner credenciales aquí sin revisar el log. */
    headers?: Record<string, string>;
  } = {},
): Promise<T> {
  const timeoutMs = opciones.timeoutMs ?? TIMEOUT_CONTEXTO_MS;
  const hacerFetch = opciones.fetchImpl ?? fetch;
  const ref = referenciaSegura(url);

  let respuesta: Response;
  try {
    respuesta = await hacerFetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', ...opciones.headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    // Red, DNS, TLS o timeout. Transitorio por defecto.
    const causa = e instanceof Error ? e.name : 'desconocido';
    throw new ErrorContextoProveedor(`no se pudo contactar ${ref} (${causa})`, {
      reintentable: true,
    });
  }

  if (respuesta.status === 429) {
    throw new ErrorContextoProveedor(`${ref} aplicó límite de tasa`, {
      reintentable: true,
      codigoHttp: 429,
      retryAfterMs: retryAfterAMs(respuesta.headers.get('retry-after')),
    });
  }

  if (respuesta.status >= 500) {
    throw new ErrorContextoProveedor(`${ref} respondió ${respuesta.status}`, {
      reintentable: true,
      codigoHttp: respuesta.status,
    });
  }

  if (!respuesta.ok) {
    // 4xx: la petición está mal construida o el recurso no existe. Reintentar
    // no lo arregla y sí quema cuota.
    throw new ErrorContextoProveedor(`${ref} respondió ${respuesta.status}`, {
      reintentable: false,
      codigoHttp: respuesta.status,
    });
  }

  try {
    return (await respuesta.json()) as T;
  } catch {
    throw new ErrorContextoRespuesta(`${ref} devolvió un cuerpo que no es JSON`);
  }
}
