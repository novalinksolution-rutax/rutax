/**
 * Jerarquía de errores del adaptador DTE.
 * =====================================================================
 *
 * Todos los errores del módulo DTE extienden `ErrorDte` para permitir
 * catches específicos. Ningún error incluye credenciales, tokens,
 * certificados ni valores de secretos — regla dura del proyecto.
 *
 * Jerarquía (§5.2 del documento de arquitectura):
 *   ErrorDte (base)
 *   ├── ErrorDteProveedor   — respuesta HTTP de error del proveedor
 *   ├── ErrorFolioAgotado   — todos los folios del CAF consumidos
 *   └── ErrorConfigDteInvalida — falta config DTE para el tenant
 */

/**
 * Error base del adaptador DTE. Usar las subclases concretas — esta
 * clase captura cualquier error DTE sin discriminar la causa.
 */
export class ErrorDte extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErrorDte';
    // Mantener el stack trace correcto en V8.
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * El proveedor DTE devolvió una respuesta HTTP de error.
 *
 * `codigoHttp` y `mensajeProveedor` deben ser SANITIZADOS antes de
 * construir este error: no incluir credenciales, tokens ni datos del
 * certificado del courier — solo el mensaje de error operativo que el
 * proveedor devuelve en el cuerpo de la respuesta.
 */
export class ErrorDteProveedor extends ErrorDte {
  readonly codigoHttp: number;
  readonly mensajeProveedor: string;

  constructor(codigoHttp: number, mensajeProveedor: string) {
    super(
      `Proveedor DTE respondió con HTTP ${codigoHttp}: ${mensajeProveedor}`,
    );
    this.name = 'ErrorDteProveedor';
    this.codigoHttp = codigoHttp;
    // `mensajeProveedor` es el texto operativo del proveedor — quien construye
    // este error es responsable de no incluir secretos en él.
    this.mensajeProveedor = mensajeProveedor;
  }
}

/**
 * El rango de folios CAF del tenant está agotado. No es reintentable:
 * requiere solicitar un nuevo CAF al SII (o al proveedor si gestiona
 * folios). El job C3 no debe reintentar; debe alertar (job C7).
 */
export class ErrorFolioAgotado extends ErrorDte {
  readonly tenantId: string;

  constructor(tenantId: string) {
    super(
      `Folios CAF agotados para el tenant ${tenantId}. ` +
      'Solicita un nuevo CAF al proveedor DTE antes de emitir más documentos.',
    );
    this.name = 'ErrorFolioAgotado';
    this.tenantId = tenantId;
  }
}

/**
 * No existe configuración DTE para el tenant, o la configuración es
 * inválida (credenciales no descifrable, proveedor no reconocido).
 * No es reintentable: requiere completar el onboarding del courier.
 */
export class ErrorConfigDteInvalida extends ErrorDte {
  readonly tenantId: string;

  constructor(tenantId: string, detalle?: string) {
    super(
      `Configuración DTE inválida o ausente para el tenant ${tenantId}` +
      (detalle ? `: ${detalle}` : '.'),
    );
    this.name = 'ErrorConfigDteInvalida';
    this.tenantId = tenantId;
    // `detalle` NO debe incluir credenciales ni secretos — solo descripción
    // operativa de qué falta o está mal configurado.
  }
}
