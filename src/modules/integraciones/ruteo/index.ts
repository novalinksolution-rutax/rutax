/**
 * Superficie pública del módulo de ruteo (integración).
 * =====================================================================
 *
 * Dos puertos que NO son lo mismo:
 *
 * - `PuertoMatriz` — entrega distancias entre puntos. Su consumidor es el motor
 *   local (`operacion/ruteo/motor.ts`), que decide el orden.
 * - `PuertoOptimizacionRuta` — entrega el orden ya decidido por un proveedor
 *   externo, con la geometría real de la calle. Su consumidor es
 *   `operacion/ruta-manifiesto.ts`. **Devuelve `null` si no está configurado**,
 *   y ese es el estado por defecto.
 *
 * Los adaptadores concretos (haversine, Google) son detalle de implementación y
 * no se exportan aquí.
 */

export { obtenerPuertoMatriz } from './puerto';
export type { PuertoMatriz } from './puerto';

export { obtenerPuertoOptimizacion } from './puerto-optimizacion';
export type { PuertoOptimizacionRuta } from './puerto-optimizacion';

export type { PuntoRuteo, MatrizDistancias } from './tipos';
export type {
  ParadaAOptimizar,
  EntradaOptimizacion,
  RutaOptimizada,
  TramoRuta,
} from './tipos-optimizacion';

export { ErrorRuteo, ErrorRuteoConfig, ErrorRuteoProveedor } from './errores';
