/**
 * Puerto de CHECKOUT de suscripción — cobro de Rutax al courier vía un link de
 * pago hospedado de Fintoc (producto "Payment Links").
 * =============================================================================
 * Solo cubre la ACCIÓN con credenciales (crear el link), que es lo que exige el
 * gate sandbox/real. La validación de firma del webhook y la normalización del
 * evento son puras y viven aparte (`normalizar-evento.ts` + el helper de firma
 * compartido `firma-webhook-fintoc.ts`) — igual que en el flujo de payout.
 *
 * CONTRATO VERIFICADO CONTRA DOC OFICIAL (jul 2026):
 *  - Crear: POST https://api.fintoc.com/v1/payment_links
 *    (https://docs.fintoc.com/reference/payment-links-create)
 *  - Un payment link NO tiene estado "pagado": el pago se confirma SOLO por
 *    webhook (`checkout_session.finished` / `payment_intent.succeeded`), no por
 *    GET del link. Por eso el puerto no expone "consultar estado del link".
 */

/** Datos para crear un link de pago de un período de suscripción. */
export interface CrearLinkPagoArgs {
  /** Monto a cobrar en CLP (entero; Fintoc usa la unidad mínima y CLP no tiene decimales). */
  montoClp: number;
  /** Texto visible en la página de pago (`checkout.description`). */
  descripcion: string;
  /** Email del courier para notificaciones de Fintoc (opcional). */
  emailCliente?: string | null;
  /** Segundos hasta que el link expira; omitir = sin expiración. */
  expiraEnSegundos?: number | null;
  /**
   * Metadata que Fintoc conserva y devuelve en el webhook — clave para
   * correlacionar el pago con el período. Incluir `periodo_id` y `tenant_id`.
   */
  metadata: Record<string, string>;
}

/** Resultado de crear un link de pago. */
export interface ResultadoLinkPago {
  /** Id del payment link en Fintoc (se guarda como `pago_externo_id`). */
  linkExternoId: string;
  /** URL de la página donde el courier paga (`url` en la respuesta de Fintoc). */
  url: string;
  /** Modo del link: 'test' (sandbox) o 'live' (real). */
  modo: 'test' | 'live';
}

/**
 * Contrato del adaptador de checkout. Lo resuelve `fabrica-checkout.ts`
 * aplicando el gate sandbox/real; el núcleo (`plataforma`) nunca ve el adaptador
 * concreto.
 */
export interface PuertoCheckoutSuscripcion {
  /**
   * Crea un link de pago hospedado para cobrar `montoClp`. Resiliente a 429/5xx
   * (reintenta con backoff). La secret key JAMÁS se loguea ni se devuelve.
   */
  crearLinkPago(args: CrearLinkPagoArgs): Promise<ResultadoLinkPago>;
}
