/**
 * Puerto de optimización de ruta — el solver completo, cuando se compra.
 * =====================================================================
 *
 * Hermano de `puerto.ts` (`PuertoMatriz`) y hay que no confundirlos: aquel
 * entrega distancias para que el motor local decida el orden; éste entrega el
 * orden ya decidido, con la geometría de la calle.
 *
 * =============================================================================
 * APAGADO POR DEFECTO, Y ESO ES A PROPÓSITO
 * =============================================================================
 * `obtenerPuertoOptimizacion()` devuelve **`null`** cuando no hay proveedor
 * configurado, y el llamador cae al motor local (haversine, US$0, sin red).
 * No es un modo degradado: es el camino por defecto del producto.
 *
 * La razón es que este puerto **cuesta plata por uso** —se cobra por parada
 * optimizada, cada vez— así que encenderlo tiene que ser un acto deliberado de
 * quien paga la cuenta, nunca el efecto secundario de desplegar una rama. Mismo
 * criterio que `DTE_SANDBOX_MODE`: lo que cuesta o es irreversible se activa
 * explícitamente.
 *
 * =============================================================================
 * NO ES POR TENANT. LA CUENTA ES DE LA PLATAFORMA
 * =============================================================================
 * Igual que geocoding y a diferencia de DTE o pagos: la credencial la paga
 * Rutax y vive en variables de entorno GLOBALES, no en
 * `identidad.secretos_cifrados`.
 *
 * ⚠️ Consecuencia que conviene tener presente al mirar la factura: el tramo
 * gratis mensual de Google es **uno para toda la plataforma**, no uno por
 * courier. Diez couriers no traen diez cuotas gratis: traen diez veces el
 * consumo contra la misma cuota.
 */

import { ErrorRuteoConfig } from './errores';
import { GoogleRouteOptimizationAdapter } from './adaptadores/google-route-optimization';
import type { EntradaOptimizacion, RutaOptimizada } from './tipos-optimizacion';

/**
 * Contrato que cumple todo adaptador de optimización concreto.
 *
 * Recibe paradas **ya filtradas**: las que no tienen coordenada usable no
 * llegan hasta acá (ver `tipos-optimizacion.ts`). Devuelve la secuencia y los
 * tramos visibles, sin el trayecto final hacia el punto de término.
 */
export interface PuertoOptimizacionRuta {
  optimizarRuta(entrada: EntradaOptimizacion): Promise<RutaOptimizada>;
}

/**
 * Devuelve el adaptador de optimización configurado, o `null` si no hay ninguno.
 *
 * - `RUTEO_OPTIMIZADOR_PROVIDER` ausente, vacío o `local` → `null` (motor local).
 * - `google` → `GoogleRouteOptimizationAdapter`.
 * - Cualquier otro valor → `ErrorRuteoConfig`.
 *
 * ⚠️ **Un valor no reconocido lanza en vez de caer al motor local.** Es
 * deliberado: si alguien escribió `RUTEO_OPTIMIZADOR_PROVIDER=googel` esperando
 * rutas por calle, fallar ruidoso es mejor que servir en silencio líneas rectas
 * durante un mes y descubrirlo por la factura que nunca llegó.
 */
export function obtenerPuertoOptimizacion(): PuertoOptimizacionRuta | null {
  const proveedor = (process.env.RUTEO_OPTIMIZADOR_PROVIDER ?? '').trim().toLowerCase();

  switch (proveedor) {
    case '':
    case 'local':
      return null;

    case 'google':
      return new GoogleRouteOptimizationAdapter();

    default:
      // `proveedor` viene de env — texto de devops, sin credenciales dentro.
      throw new ErrorRuteoConfig(
        `RUTEO_OPTIMIZADOR_PROVIDER='${proveedor}' no es reconocido (usa 'google' o 'local')`,
      );
  }
}
