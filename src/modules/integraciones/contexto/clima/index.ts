/**
 * Superficie pública del puerto de CLIMA.
 * =====================================================================
 *
 * Los consumidores (el job `contexto/clima.refrescar` de A4, los tests) trabajan
 * contra `PuertoClima`; los adaptadores concretos son detalle de implementación
 * y NO se exportan. Quien quiera un adaptador específico en una prueba lo importa
 * por ruta profunda, a propósito: así el import delata la intención.
 */

export { obtenerPuertoClima } from './puerto';
export type { PuertoClima } from './puerto';

export type {
  ParametrosClima,
  PronosticoClima,
  PronosticoHoraComuna,
  ProveedorClima,
} from './tipos';
