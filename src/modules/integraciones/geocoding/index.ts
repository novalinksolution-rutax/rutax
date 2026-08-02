/**
 * Superficie pública del módulo de geocoding.
 * =====================================================================
 *
 * Los consumidores (el job de geocoding, tests) trabajan contra el puerto
 * `PuertoGeocoding`; los adaptadores concretos (stub/google) son detalle de
 * implementación y no se exportan aquí.
 */

export { obtenerPuertoGeocoding } from './puerto';
export type { PuertoGeocoding } from './puerto';

export type {
  ParametrosGeocoding,
  ResultadoGeocoding,
  EstadoGeocoding,
  CoberturaEstado,
  ProveedorGeocoding,
} from './tipos';

export { calcularClaveHash, resolverComunaCanonica } from './normalizacion';

export {
  ErrorGeocoding,
  ErrorGeocodingConfig,
  ErrorGeocodingProveedor,
} from './errores';
