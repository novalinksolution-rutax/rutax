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

// Helper compartido de resolución de coordenadas con cache global (job de
// pedidos Y Server Actions de bodegas — ver `resolver-coordenada.ts`). Los
// hooks de inyección de puerto para tests (`setPuertoGeocoding`/
// `resetPuertoGeocoding`) NO se exponen aquí a propósito: son de uso
// exclusivo de pruebas y se importan directo desde `./resolver-coordenada`,
// igual que antes se importaban directo desde `./jobs/geocodificar-pedido`.
export {
  resolverCoordenadaConCache,
  TIMEOUT_GEOCODING_SINCRONO_MS,
} from './resolver-coordenada';
export type {
  ArgsResolverCoordenadaConCache,
  LoggerLigero,
} from './resolver-coordenada';
