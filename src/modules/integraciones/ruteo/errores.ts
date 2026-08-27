/**
 * Jerarquía de errores del puerto de ruteo.
 * =====================================================================
 *
 * Mismo criterio que `integraciones/geocoding/errores.ts`: config = NO
 * reintentable, proveedor (red/429/5xx) = reintentable.
 *
 * Ese "día que exista un adaptador con I/O" que anunciaba la versión anterior
 * de este comentario llegó el 2026-08-26 con el puerto de optimización
 * (`puerto-optimizacion.ts`, Google Route Optimization). `ErrorRuteoProveedor`
 * es la mitad reintentable que faltaba.
 *
 * ⚠️ **Ningún error de este módulo lleva coordenadas en su mensaje.** Un error
 * de ruteo termina en un log o en Sentry, y la entrada del solver incluye el
 * punto de término del conductor — canal 12 del §4.3 de
 * `docs/seguridad/punto-de-termino-conductor.md`. Los puntos se identifican por
 * NOMBRE ("origen", "destino"), nunca por valor.
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

/**
 * El proveedor externo de optimización falló: red caída, 429, 5xx, respuesta
 * ilegible.
 *
 * REINTENTABLE. Lo consume `operacion/ruta-manifiesto.ts`, que ante este error
 * **cae al motor local** en vez de dejar al coordinador sin ruta: una secuencia
 * en línea recta es peor que una por calle, pero infinitamente mejor que
 * ninguna a las 15:50.
 *
 * `detalle` NUNCA debe construirse con coordenadas ni con el cuerpo del
 * request. Estado HTTP y mensaje del proveedor, nada más.
 */
export class ErrorRuteoProveedor extends ErrorRuteo {
  /** `true` si reintentar tiene sentido (429, 5xx, red). */
  readonly reintentable: boolean;

  constructor(detalle: string, reintentable = true) {
    super(`El proveedor de ruteo falló: ${detalle}`);
    this.name = 'ErrorRuteoProveedor';
    this.reintentable = reintentable;
  }
}
