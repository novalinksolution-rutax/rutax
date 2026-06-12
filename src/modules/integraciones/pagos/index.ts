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
