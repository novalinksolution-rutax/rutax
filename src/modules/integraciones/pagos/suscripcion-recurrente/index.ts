/**
 * Superficie pública del submódulo de AUTO-COBRO RECURRENTE de la suscripción
 * (Rutax → courier vía mandato Fintoc). El backend importa SOLO desde aquí:
 *   `@/modules/integraciones/pagos/suscripcion-recurrente`
 *
 * Los consumidores (job y webhook de `backend`, tests) trabajan contra el puerto
 * y las funciones puras; los adaptadores Fintoc/stub son internos.
 */

export {
  obtenerPuertoSuscripcionRecurrente,
  suscripcionRecurrenteSandboxActivo,
} from './fabrica-suscripcion-recurrente';
export type { ResolverSuscripcionRecurrenteOpts } from './fabrica-suscripcion-recurrente';

export { normalizarEventoRecurrente } from './normalizar-evento-recurrente';
export type { EventoRecurrenteNormalizado } from './normalizar-evento-recurrente';

export type {
  PuertoSuscripcionRecurrente,
  RegistrarMandatoArgs,
  ResultadoRegistrarMandato,
  CobrarPeriodoArgs,
  ResultadoCobrarPeriodo,
  EstadoCobroPeriodo,
  CancelarMandatoArgs,
  ResultadoCancelarMandato,
} from './puerto-suscripcion-recurrente';

export { ErrorSuscripcionConfig, ErrorSuscripcionOperativo } from './errores';
