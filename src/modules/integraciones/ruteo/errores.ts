/**
 * Jerarquía de errores del puerto de ruteo.
 * =====================================================================
 *
 * Mismo criterio que `integraciones/geocoding/errores.ts`: hoy la única forma
 * de fallar es un `RUTEO_MATRIZ_PROVIDER` no reconocido — el único adaptador
 * (haversine) es matemática pura sobre `lib/geo/distancia.ts`, sin red y sin
 * I/O, así que no existe todavía un análogo de `ErrorGeocodingProveedor`
 * (reintentable). El día que exista un adaptador con I/O (una matriz por
 * calle de pago), sumar esa jerarquía aquí, calcada de la de geocoding:
 * config = NO reintentable, proveedor (red/429/5xx) = reintentable.
 */

/** Error base del módulo de ruteo. */
export class ErrorRuteo extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErrorRuteo';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Configuración de ruteo ausente o inválida (proveedor no reconocido en
 * `RUTEO_MATRIZ_PROVIDER`).
 *
 * NO REINTENTABLE: reintentar no arregla una variable de entorno mal puesta.
 */
export class ErrorRuteoConfig extends ErrorRuteo {
  constructor(detalle: string) {
    super(`Configuración de ruteo inválida: ${detalle}`);
    this.name = 'ErrorRuteoConfig';
  }
}
