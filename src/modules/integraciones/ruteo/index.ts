/**
 * Superficie pública del módulo de ruteo (integración).
 * =====================================================================
 *
 * El consumidor real es `operacion/ruteo/motor.ts`. El adaptador concreto
 * (hoy: haversine) es detalle de implementación y no se exporta aquí.
 */

export { obtenerPuertoMatriz } from './puerto';
export type { PuertoMatriz } from './puerto';

export type { PuntoRuteo, MatrizDistancias } from './tipos';

export { ErrorRuteo, ErrorRuteoConfig } from './errores';
