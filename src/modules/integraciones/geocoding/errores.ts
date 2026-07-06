/**
 * Jerarquía de errores del puerto de geocoding.
 * =====================================================================
 *
 * Distinción clave para el job: NO REINTENTABLE vs. REINTENTABLE.
 *   - `ErrorGeocodingConfig` (config faltante/inválida, API key ausente) →
 *     NO reintentable. Reintentar no arregla una variable de entorno mal
 *     puesta; el job debe fallar y dejar que devops lo corrija.
 *   - `ErrorGeocodingProveedor` (red, 429, 5xx, cuota agotada) →
 *     REINTENTABLE. Es transitorio; Inngest reintenta con backoff.
 *
 * Ningún error incluye la API key de plataforma ni fragmentos de URL con la
 * key — regla dura del proyecto (secretos jamás en logs/errores/URLs).
 */

/** Error base del módulo de geocoding. */
export class ErrorGeocoding extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErrorGeocoding';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Configuración de geocoding ausente o inválida (proveedor no reconocido,
 * `GOOGLE_MAPS_API_KEY` faltante con `GEOCODING_PROVIDER=google`).
 *
 * NO REINTENTABLE: el job no debe reintentar. Requiere intervención de devops
 * (corregir variables de entorno). El detalle NUNCA incluye la API key.
 */
export class ErrorGeocodingConfig extends ErrorGeocoding {
  constructor(detalle: string) {
    super(`Configuración de geocoding inválida: ${detalle}`);
    this.name = 'ErrorGeocodingConfig';
  }
}

/**
 * El proveedor de geocoding devolvió un error transitorio (red caída, timeout,
 * HTTP 429 / 5xx, `OVER_QUERY_LIMIT`, `UNKNOWN_ERROR`).
 *
 * REINTENTABLE: el job propaga este error para que Inngest reintente con
 * backoff. `mensajeProveedor` debe estar SANITIZADO (sin la API key).
 */
export class ErrorGeocodingProveedor extends ErrorGeocoding {
  readonly codigoHttp: number | null;
  readonly mensajeProveedor: string;

  constructor(mensajeProveedor: string, codigoHttp: number | null = null) {
    super(
      `Proveedor de geocoding falló` +
        (codigoHttp !== null ? ` (HTTP ${codigoHttp})` : '') +
        `: ${mensajeProveedor}`,
    );
    this.name = 'ErrorGeocodingProveedor';
    this.codigoHttp = codigoHttp;
    this.mensajeProveedor = mensajeProveedor;
  }
}
