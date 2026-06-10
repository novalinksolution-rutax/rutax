/**
 * Cliente HTTP de bajo nivel para la API de Mercado Libre — encapsula
 * resiliencia (backoff ante 429/5xx, respeto de `Retry-After`) para que el
 * resto del adaptador no repita esta lógica en cada llamada.
 *
 * Nadie fuera de `integraciones/ml` debe importar esto — es deliberadamente
 * "privado" del puerto (no se reexporta desde `index.ts`).
 *
 * VERIFICACIÓN CONTRA DOCUMENTACIÓN OFICIAL (lo volátil — flex-ml lo exige):
 * - Host de la API: `https://api.mercadolibre.com` (compartido entre sitios
 *   incl. MLC — el host de "developers.mercadolibre.cl" es solo el portal de
 *   documentación en español, las llamadas van al host global).
 * - `expires_in` del token: 21600 segundos (6 horas) — confirmado en los
 *   ejemplos de la documentación oficial de autenticación/autorización.
 * - `refresh_token` de un solo uso: cada refresco devuelve un nuevo
 *   `refresh_token` y el anterior queda inválido — confirmado en la guía de
 *   "Authorization and Token Best Practices".
 * - Límite de tasa: ML no publica un número fijo único y estable por app/IP
 *   (varía por recurso y cambia); la guía oficial recomienda backoff y
 *   respetar el header `Retry-After`/cuerpo de error 429. Por eso este
 *   cliente NO hardcodea un número de "requests por minuto": confía en las
 *   señales que el propio proveedor manda en cada respuesta.
 *   → Antes de ir a producción, `devops`/`integraciones` deben re-confirmar
 *   contra developers.mercadolibre.com.ar/com vigente, ya que la guía
 *   advierte explícitamente que estos valores cambian.
 */

import {
  reintentarConBackoff,
  type ErrorReintentable,
  type OpcionesReintento,
} from "../resiliencia";

export const ML_API_BASE_URL = "https://api.mercadolibre.com";

/**
 * Host de la pantalla de AUTORIZACIÓN (consentimiento OAuth del seller).
 * Es ESPECÍFICO por país: para Chile es `auth.mercadolibre.cl`. No confundir
 * con `ML_API_BASE_URL` (`api.mercadolibre.com`, global), que se usa para el
 * intercambio/refresco de tokens (`/oauth/token`) y todas las llamadas a la
 * API. Redirigir el consentimiento al host global produce errores crípticos
 * (sitio incorrecto / invalid_client). Proyecto Chile-only (CLAUDE.md) → host
 * fijo, no configurable por ahora.
 */
export const ML_AUTH_BASE_URL = "https://auth.mercadolibre.cl";

export class ErrorHttpMl extends Error implements Partial<ErrorReintentable> {
  readonly status: number;
  readonly reintentable?: true;
  readonly retryAfterMs?: number;
  /** Cuerpo de error de ML — se asume YA saneado de tokens por el llamador. */
  readonly cuerpo: unknown;

  constructor(mensaje: string, status: number, cuerpo: unknown, retryAfterMs?: number) {
    super(mensaje);
    this.name = "ErrorHttpMl";
    this.status = status;
    this.cuerpo = cuerpo;

    // Reintentable: 429 (límite de tasa) y 5xx (error transitorio del
    // proveedor). Los 4xx restantes (400/401/403/404) son definitivos —
    // reintentarlos solo gastaría cuota sin cambiar el resultado.
    if (status === 429 || status >= 500) {
      this.reintentable = true;
      if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs;
    }
  }
}

function leerRetryAfterMs(headers: Headers): number | undefined {
  const valor = headers.get("retry-after");
  if (!valor) return undefined;

  // `Retry-After` puede ser segundos (entero) o una fecha HTTP — soportamos
  // ambos por robustez, aunque ML típicamente usa segundos.
  const segundos = Number(valor);
  if (!Number.isNaN(segundos)) return segundos * 1000;

  const fecha = Date.parse(valor);
  if (!Number.isNaN(fecha)) return Math.max(0, fecha - Date.now());

  return undefined;
}

export interface PeticionMl {
  metodo: "GET" | "POST" | "PUT";
  ruta: string;
  /** Se serializa como `application/x-www-form-urlencoded` (lo que usa /oauth/token). */
  cuerpoFormulario?: Record<string, string>;
  /** Token de acceso — NUNCA se loguea; solo se usa para construir el header. */
  accessToken?: string;
  encabezadosExtra?: Record<string, string>;
  opcionesReintento?: OpcionesReintento;
}

/**
 * Ejecuta una petición a la API de ML con reintentos/backoff ya aplicados.
 * Lanza `ErrorHttpMl` con `reintentable=true` para 429/5xx (y `retryAfterMs`
 * si el proveedor lo informó); para el resto, `reintentable` queda ausente y
 * `reintentarConBackoff` no reintenta.
 */
export async function peticionMl<T>(peticion: PeticionMl): Promise<T> {
  return reintentarConBackoff(async () => {
    const url = `${ML_API_BASE_URL}${peticion.ruta}`;
    const encabezados: Record<string, string> = {
      accept: "application/json",
      ...peticion.encabezadosExtra,
    };

    let cuerpo: BodyInit | undefined;
    if (peticion.cuerpoFormulario) {
      encabezados["content-type"] = "application/x-www-form-urlencoded";
      cuerpo = new URLSearchParams(peticion.cuerpoFormulario).toString();
    }

    if (peticion.accessToken) {
      // Construido en el último momento posible; nunca asignado a una
      // variable de mayor vida ni incluido en logs/objetos de error.
      encabezados.authorization = `Bearer ${peticion.accessToken}`;
    }

    const respuesta = await fetch(url, {
      method: peticion.metodo,
      headers: encabezados,
      body: cuerpo,
    });

    if (!respuesta.ok) {
      const cuerpoError = await leerCuerpoSeguro(respuesta);
      const retryAfterMs = leerRetryAfterMs(respuesta.headers);
      throw new ErrorHttpMl(
        `Mercado Libre respondió ${respuesta.status} para ${peticion.metodo} ${peticion.ruta}`,
        respuesta.status,
        cuerpoError,
        retryAfterMs,
      );
    }

    return (await respuesta.json()) as T;
  }, peticion.opcionesReintento);
}

export interface PeticionBinariaMl {
  metodo: "GET";
  ruta: string;
  /** Token de acceso — NUNCA se loguea; solo se usa para construir el header. */
  accessToken: string;
  /** Header `Accept` a enviar — p. ej. `application/pdf` para etiquetas. */
  accept?: string;
  opcionesReintento?: OpcionesReintento;
}

export interface RespuestaBinariaMl {
  contenido: ArrayBuffer;
  contentType: string;
}

/**
 * Variante de `peticionMl` para respuestas binarias (p. ej. PDF/ZIP de
 * `shipment_labels`) — conserva el mismo backoff/reintentos/clasificación de
 * `ErrorHttpMl` que `peticionMl`, pero no intenta parsear JSON.
 */
export async function peticionBinariaMl(peticion: PeticionBinariaMl): Promise<RespuestaBinariaMl> {
  return reintentarConBackoff(async () => {
    const url = `${ML_API_BASE_URL}${peticion.ruta}`;
    const encabezados: Record<string, string> = {
      accept: peticion.accept ?? "application/octet-stream",
      // Construido en el último momento posible; nunca asignado a una
      // variable de mayor vida ni incluido en logs/objetos de error.
      authorization: `Bearer ${peticion.accessToken}`,
    };

    const respuesta = await fetch(url, {
      method: peticion.metodo,
      headers: encabezados,
    });

    if (!respuesta.ok) {
      const cuerpoError = await leerCuerpoSeguro(respuesta);
      const retryAfterMs = leerRetryAfterMs(respuesta.headers);
      throw new ErrorHttpMl(
        `Mercado Libre respondió ${respuesta.status} para ${peticion.metodo} ${peticion.ruta}`,
        respuesta.status,
        cuerpoError,
        retryAfterMs,
      );
    }

    return {
      contenido: await respuesta.arrayBuffer(),
      contentType: respuesta.headers.get("content-type") ?? "application/octet-stream",
    };
  }, peticion.opcionesReintento);
}

/**
 * Lee el cuerpo de una respuesta de error sin arriesgar una segunda excepción
 * si el cuerpo no es JSON válido o ya fue consumido.
 */
async function leerCuerpoSeguro(respuesta: Response): Promise<unknown> {
  try {
    return await respuesta.clone().json();
  } catch {
    try {
      return await respuesta.text();
    } catch {
      return null;
    }
  }
}
