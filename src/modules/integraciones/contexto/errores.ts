/**
 * Jerarquía de errores de los puertos de CONTEXTO (Torre de control).
 * =====================================================================
 *
 * Comparte la disciplina de `integraciones/geocoding/errores.ts` — misma
 * distinción NO REINTENTABLE vs. REINTENTABLE — pero vive una sola vez para las
 * tres fuentes (clima, aire, calendario) porque las tres tienen exactamente el
 * mismo contrato de degradación (§6 del diseño: "todo puerto degrada, nunca
 * revienta"). Triplicar el archivo solo garantizaría que se desincronicen.
 *
 * IMPORTANTE — estos errores casi nunca salen del adaptador:
 *   · Un fallo del PROVEEDOR (red, timeout, 429, 5xx, JSON ilegible) se captura
 *     dentro del adaptador y se devuelve como `ResultadoContexto` con `ok:false`
 *     (ver `resultado.ts`). El job de A4 escribe entonces el estado degradado en
 *     `contexto.fuentes_estado` en vez de caerse.
 *   · Un fallo de CONFIGURACIÓN (variable de entorno con un valor no reconocido)
 *     SÍ se lanza, y lo lanza la fábrica del puerto — no el método. Es un bug de
 *     despliegue, no una caída de la fuente: reintentarlo no lo arregla. El
 *     llamador lo traduce a estado degradado con `degradarDesdeError()`.
 *
 * Ningún error incluye tokens, claves ni URLs con credenciales. Las tres fuentes
 * de este módulo son públicas y sin key; si alguna vez se contrata el tier
 * comercial de Open-Meteo, la `apikey` viaja en el query string y por eso
 * `sanearParaMensaje()` de `resultado.ts` existe: nunca se cita una URL cruda.
 */

/** Error base de los puertos de contexto. */
export class ErrorContexto extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErrorContexto';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Configuración ausente o inválida (proveedor no reconocido en la variable de
 * entorno, base URL malformada).
 *
 * NO REINTENTABLE. Lo lanza la fábrica `obtenerPuerto*()`, igual que
 * `ErrorGeocodingConfig`. El detalle NUNCA incluye el valor de una credencial.
 */
export class ErrorContextoConfig extends ErrorContexto {
  readonly reintentable = false;

  constructor(detalle: string) {
    super(`Configuración de contexto inválida: ${detalle}`);
    this.name = 'ErrorContextoConfig';
  }
}

/**
 * El proveedor externo falló.
 *
 * `reintentable` distingue lo transitorio (timeout, red caída, HTTP 429/5xx) de
 * lo que no se arregla reintentando (HTTP 4xx distinto de 429, cuerpo ilegible).
 * `reintentarConBackoff` de `integraciones/resiliencia.ts` respeta esta marca
 * vía `esErrorReintentable()`, y `retryAfterMs` transporta el `Retry-After` del
 * proveedor cuando lo manda, para respetarlo exactamente en vez de adivinar.
 *
 * Este error se lanza INTERNAMENTE dentro del adaptador (para que el backoff lo
 * vea) y se convierte en `{ ok: false }` antes de salir del puerto.
 */
export class ErrorContextoProveedor extends ErrorContexto {
  readonly reintentable: boolean;
  readonly codigoHttp: number | null;
  readonly retryAfterMs?: number;

  constructor(
    mensajeProveedor: string,
    opciones: {
      reintentable?: boolean;
      codigoHttp?: number | null;
      retryAfterMs?: number;
    } = {},
  ) {
    const codigoHttp = opciones.codigoHttp ?? null;
    super(
      `Proveedor de contexto falló` +
        (codigoHttp !== null ? ` (HTTP ${codigoHttp})` : '') +
        `: ${mensajeProveedor}`,
    );
    this.name = 'ErrorContextoProveedor';
    this.reintentable = opciones.reintentable ?? true;
    this.codigoHttp = codigoHttp;
    if (opciones.retryAfterMs !== undefined) {
      this.retryAfterMs = opciones.retryAfterMs;
    }
  }
}

/**
 * El proveedor respondió, pero el cuerpo no tiene la forma esperada (faltan
 * arreglos horarios, longitudes descuadradas, tipos distintos).
 *
 * NO REINTENTABLE: si el contrato de la API cambió, reintentar solo quema
 * cuota. Es la señal de "hay que ir a leer la doc oficial otra vez".
 */
export class ErrorContextoRespuesta extends ErrorContexto {
  readonly reintentable = false;

  constructor(detalle: string) {
    super(`Respuesta de contexto inesperada: ${detalle}`);
    this.name = 'ErrorContextoRespuesta';
  }
}
