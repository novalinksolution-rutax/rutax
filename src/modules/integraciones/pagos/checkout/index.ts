/**
 * Superficie pública del submódulo de CHECKOUT de suscripción (cobro Rutax→courier).
 * Los consumidores (acción de `plataforma`, webhook de `backend`, tests) trabajan
 * contra el puerto y las funciones puras; el adaptador Fintoc es interno.
 */

export { obtenerPuertoCheckout, suscripcionSandboxActivo } from './fabrica-checkout';
export type { ResolverCheckoutOpts } from './fabrica-checkout';

export { normalizarEventoPagoSuscripcion } from './normalizar-evento';
export type { EventoPagoSuscripcion, EstadoPagoSuscripcion } from './normalizar-evento';

export type {
  PuertoCheckoutSuscripcion,
  CrearLinkPagoArgs,
  ResultadoLinkPago,
} from './puerto-checkout';

export { ErrorCheckoutConfig, ErrorCheckoutOperativo } from './errores';
