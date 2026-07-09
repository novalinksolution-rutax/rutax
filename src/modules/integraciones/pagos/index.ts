/**
 * Superficie pública del módulo de pagos (cobranza Fintoc).
 * =============================================================================
 *
 * Solo se exporta lo que los consumidores externos (jobs de `dinero`, endpoint
 * de webhook de `backend`, tests) necesitan. El adaptador concreto
 * (`FintocAdapter`) es un detalle de implementación — el llamador trabaja contra
 * `PuertoConciliacionPagos`.
 */

export {
  crearPuertoConciliacionPagos,
  resolverLinkTokenTenant,
  resolverSecretoWebhookTenant,
  canjearExchangeToken,
} from "./fintoc/fabrica";

export type { CanjeExchangeTokenResultado } from "./fintoc/fabrica";

export type {
  PuertoConciliacionPagos,
  ListarMovimientosArgs,
  ValidarFirmaWebhookArgs,
} from "./puerto";

export type {
  MovimientoPago,
  TipoMovimientoPago,
} from "./tipos";

export { normalizarRut } from "./tipos";

export {
  ErrorPagos,
  ErrorPagosProveedor,
  ErrorFirmaWebhookInvalida,
  ErrorConfigCobranzaAusente,
} from "./errores";

// ---------------------------------------------------------------------------
// PAYOUTS SALIENTES — webhook de confirmación instantánea (Fintoc
// `transfer.outbound.*`). Standalone: el backend (fase 3) valida la firma y
// normaliza el evento SIN una instancia de tenant/config (el secreto del webhook
// de payout es de ORG y la validación ocurre ANTES de resolver el tenant).
// ---------------------------------------------------------------------------

export {
  validarFirmaWebhookPayout,
  normalizarEventoWebhookPayoutFintoc,
  sanitizarPayloadEventoPayout,
  mapearStatusFintocPayout,
} from "./payout/adaptadores/fintoc-webhook";

export type { ValidarFirmaWebhookPayoutInput } from "./payout/adaptadores/fintoc-webhook";

export type {
  PuertoPayout,
  EventoWebhookPayout,
  EstadoExternoEventoPayout,
} from "./payout/puerto-payout";
