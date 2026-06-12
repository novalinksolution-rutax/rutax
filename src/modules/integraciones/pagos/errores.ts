/**
 * Jerarquía de errores del puerto de conciliación de pagos (Fintoc).
 * =============================================================================
 *
 * Patrón idéntico a `dte/errores.ts`. NINGÚN error incluye el `link_token`, el
 * secreto de webhook, la secret key de la organización ni ningún valor de
 * secreto — regla dura del proyecto. Los mensajes son operativos y saneados.
 *
 * Jerarquía:
 *   ErrorPagos (base)
 *   ├── ErrorPagosProveedor    — respuesta HTTP de error de Fintoc (saneada)
 *   ├── ErrorFirmaWebhookInvalida — la firma `Fintoc-Signature` no valida
 *   └── ErrorConfigCobranzaAusente — falta config/secreto de cobranza del tenant
 */

/**
 * Error base del puerto de pagos. Usar las subclases concretas — esta clase
 * captura cualquier error de pagos sin discriminar la causa.
 */
export class ErrorPagos extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErrorPagos";
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * El proveedor de pagos (Fintoc) devolvió una respuesta HTTP de error.
 *
 * `codigoHttp` y `mensajeProveedor` deben venir YA saneados: jamás incluyen la
 * secret key de la organización (que viaja solo en el header `Authorization`),
 * el `link_token` (que viaja como query param y nunca debe propagarse a un
 * mensaje) ni el cuerpo crudo completo de la respuesta.
 */
export class ErrorPagosProveedor extends ErrorPagos {
  readonly codigoHttp: number;
  readonly mensajeProveedor: string;

  constructor(codigoHttp: number, mensajeProveedor: string) {
    super(`Proveedor de pagos respondió con HTTP ${codigoHttp}: ${mensajeProveedor}`);
    this.name = "ErrorPagosProveedor";
    this.codigoHttp = codigoHttp;
    this.mensajeProveedor = mensajeProveedor;
  }
}

/**
 * La firma `Fintoc-Signature` del webhook no validó (firma manipulada, secreto
 * incorrecto, payload alterado, o timestamp fuera de la tolerancia → posible
 * replay). NO reintentable: el endpoint de webhook debe responder 4xx y NO
 * procesar el evento.
 *
 * El mensaje es genérico A PROPÓSITO — nunca incluye el secreto de webhook, la
 * firma esperada ni la recibida (filtrar cualquiera de ellas ayudaría a un
 * atacante a forjar firmas válidas).
 */
export class ErrorFirmaWebhookInvalida extends ErrorPagos {
  constructor(motivo?: string) {
    super(
      "La firma del webhook de Fintoc no es válida" +
        // `motivo` describe la CATEGORÍA del fallo (formato del header,
        // timestamp fuera de tolerancia, firma no coincide) — nunca valores
        // sensibles. Lo fija este módulo, no entrada externa.
        (motivo ? ` (${motivo})` : "") +
        ". El evento no debe procesarse.",
    );
    this.name = "ErrorFirmaWebhookInvalida";
  }
}

/**
 * No existe configuración de cobranza para el tenant, o el secreto requerido
 * (`link_token` / secreto de webhook / secret key de la org) no está disponible
 * o no se pudo descifrar. No reintentable: requiere completar el onboarding de
 * cobranza del courier (conectar el banco vía el widget de Fintoc).
 *
 * `detalle` NUNCA incluye el valor de un secreto — solo describe qué falta.
 */
export class ErrorConfigCobranzaAusente extends ErrorPagos {
  readonly tenantId: string;

  constructor(tenantId: string, detalle?: string) {
    super(
      `Configuración de cobranza ausente o inválida para el tenant ${tenantId}` +
        (detalle ? `: ${detalle}` : "."),
    );
    this.name = "ErrorConfigCobranzaAusente";
    this.tenantId = tenantId;
  }
}
