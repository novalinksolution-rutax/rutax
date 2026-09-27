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
  leerSecretKeyOrg,
} from "./fintoc/fabrica";

// ---------------------------------------------------------------------------
// CONEXIÓN DEL BANCO DEL COURIER (producto "movements" de Fintoc).
//
// El `link_token` NO llega por `onSuccess` del widget ni se puede pedir después
// («can never be retrieved again», doc del Link object): llega UNA vez, por la
// notificación al `webhookUrl`, y SIN firma. Por eso la autorización de ese
// webhook es un nonce de un solo uso que abrimos antes de abrir el widget.
// ---------------------------------------------------------------------------

export {
  iniciarConexionPendienteCobranza,
  consumirConexionPendienteCobranza,
  devolverConexionPendienteCobranza,
  rutaWebhookCobranza,
  PARAM_NONCE_CONEXION,
} from "./fintoc/conexion-pendiente";

export type { ConexionPendienteIniciada } from "./fintoc/conexion-pendiente";

export {
  esPayloadLinkCreado,
  leerLinkCreado,
  TIPO_EVENTO_LINK_CREADO,
} from "./fintoc/link-creado";

export type { LinkCreadoLeido } from "./fintoc/link-creado";

export {
  registrarWebhookEndpointCobranza,
  borrarWebhookEndpointsDeUrl,
  EVENTOS_WEBHOOK_COBRANZA,
} from "./fintoc/webhook-endpoints";

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

// ---------------------------------------------------------------------------
// CHECKOUT DE SUSCRIPCIÓN — cobro Rutax→courier vía Fintoc Payment Links.
// La secret key es de ORG (misma que el payout). El gate sandbox/real vive en
// `checkout/fabrica-checkout.ts` (SUSCRIPCION_SANDBOX_MODE). El webhook de
// confirmación es org-level y usa el helper de firma compartido.
// ---------------------------------------------------------------------------

export {
  obtenerPuertoCheckout,
  suscripcionSandboxActivo,
  normalizarEventoPagoSuscripcion,
  ErrorCheckoutConfig,
  ErrorCheckoutOperativo,
} from "./checkout";

export type {
  PuertoCheckoutSuscripcion,
  CrearLinkPagoArgs,
  ResultadoLinkPago,
  EventoPagoSuscripcion,
  EstadoPagoSuscripcion,
} from "./checkout";
