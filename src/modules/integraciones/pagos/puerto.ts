/**
 * Puerto de conciliación de pagos — única puerta por la que el resto del sistema
 * lee movimientos bancarios y valida webhooks de cobranza (Fintoc).
 * =============================================================================
 *
 * Aplica la skill `pagos-chile`:
 * - El courier conecta SU banco (un `link_token` por tenant). Fintoc LEE la
 *   cuenta y detecta la transferencia entrante del seller; no mueve dinero en
 *   este flujo (flujo 1, cobranza).
 * - Los webhooks de Fintoc VAN FIRMADOS → la validación de firma es obligatoria
 *   (a diferencia de ML marketplace, que no firma — ver commit `68107e9`). NO
 *   copiar el HMAC de Mercado Pago: el esquema de Fintoc es propio (ver el
 *   adaptador).
 * - Secretos descifrados (el `link_token`, el secreto de webhook) NUNCA en logs,
 *   errores, URLs propagadas ni en el resultado.
 *
 * Patrón idéntico a `integraciones/dte/puerto.ts` y `integraciones/ml/puerto.ts`:
 * el núcleo de `dinero` depende de esta interfaz, nunca del adaptador concreto;
 * la fábrica (`fabrica.ts`) resuelve credenciales y devuelve el adaptador.
 */

import type { MovimientoPago } from "./tipos";

export interface ListarMovimientosArgs {
  /**
   * `link_token` de la cuenta conectada del courier, YA DESCIFRADO por la
   * fábrica/llamador. Identifica QUÉ cuenta consultar (va como query param a
   * Fintoc). NUNCA se loguea, no se incluye en errores ni se devuelve en el
   * resultado — vive solo dentro de la llamada.
   */
  linkToken: string;
  /**
   * Cota inferior de fecha: solo movimientos en/después de esta fecha. El
   * adaptador la traduce al parámetro de fecha que Fintoc soporta.
   */
  desde: Date;
}

export interface ValidarFirmaWebhookArgs {
  /**
   * Cuerpo CRUDO de la request (los bytes tal cual llegaron, como string UTF-8).
   * La firma de Fintoc se calcula sobre el raw body — NO sobre el JSON
   * re-serializado (re-serializar cambiaría espacios/orden y rompería la firma).
   */
  cuerpoCrudo: string;
  /** Valor del header `Fintoc-Signature` (formato `t=<ts>,v1=<hex>`). */
  firmaHeader: string;
  /** Secreto del Webhook Endpoint del tenant, YA DESCIFRADO. NUNCA se loguea. */
  secretoWebhook: string;
}

/**
 * Contrato que todo adaptador de conciliación de pagos concreto debe cumplir.
 */
export interface PuertoConciliacionPagos {
  /**
   * Lista los movimientos bancarios de la cuenta conectada del courier desde
   * `desde`, ya normalizados a `MovimientoPago` (el núcleo nunca ve el
   * `Movement` crudo de Fintoc). Resiliente: reintenta 429/5xx con backoff.
   *
   * El `linkToken` llega descifrado y JAMÁS se loguea ni se devuelve.
   */
  listarMovimientos(args: ListarMovimientosArgs): Promise<MovimientoPago[]>;

  /**
   * Valida la firma `Fintoc-Signature` del webhook contra el `cuerpoCrudo` y el
   * `secretoWebhook`. Devuelve `true` si la firma es válida y el timestamp está
   * dentro de la tolerancia anti-replay; `false` en cualquier otro caso.
   *
   * NUNCA lanza con el secreto en el mensaje. Implementación con comparación de
   * tiempo constante (no `===`) para no filtrar la firma esperada vía timing.
   */
  validarFirmaWebhook(args: ValidarFirmaWebhookArgs): boolean;

  /**
   * Normaliza el payload de un evento de webhook de transferencia entrante
   * (`transfer.inbound.succeeded`) al `MovimientoPago` del dominio. Quien llama
   * DEBE haber validado la firma antes (con `validarFirmaWebhook`); este método
   * NO valida firma — solo traduce forma.
   */
  normalizarEventoTransferencia(payloadWebhook: unknown): MovimientoPago;
}
