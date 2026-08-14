/**
 * Puerto de ruteo — única puerta por la que el motor de ruteo obtiene
 * distancias entre puntos.
 * =====================================================================
 *
 * Patrón idéntico a `integraciones/geocoding/puerto.ts`: el consumidor real
 * (`operacion/ruteo/motor.ts`) depende de la interfaz `PuertoMatriz`, nunca
 * del adaptador concreto. La fábrica elige el adaptador.
 *
 * Decisión de producto cerrada, no se reabre (`docs/arquitectura/retiro-y-ruteo.md`
 * §4/§4.1): TypeScript puro — vecino cercano + 2-opt + Or-opt sobre
 * haversine, US$0/mes. Las alternativas de matriz por calle (Google Route
 * Matrix, Mapbox Matrix, Routific) van de US$600 a US$30.000/mes al volumen
 * del piloto, y las gratuitas (OSRM demo, Valhalla de FOSSGIS, GraphHopper
 * free) prohíben uso comercial — es la séptima vez que este proyecto se topa
 * con esa cláusula.
 *
 * Este puerto es lo que hace que ese cambio, el día que se justifique
 * (rutas reales por calle en vez de línea recta), sea UNA LÍNEA en
 * `obtenerPuertoMatriz` — no un refactor de todo lo que hoy vive en
 * `operacion/ruteo/`.
 *
 * DIFERENCIA con DTE/pagos (igual que geocoding): NO es por tenant. Si algún
 * día el adaptador real cobra por request, la clave la paga la plataforma —
 * no vive en `identidad.secretos_cifrados`. La fábrica elige por una variable
 * de entorno GLOBAL:
 *
 *   - `RUTEO_MATRIZ_PROVIDER=haversine` (o ausente) → `HaversineMatrizAdapter`,
 *     línea recta sobre la esfera, sin red, determinista.
 *   - Cualquier otro valor → `ErrorRuteoConfig`.
 */

import { ErrorRuteoConfig } from './errores';
import { HaversineMatrizAdapter } from './adaptadores/haversine';
import type { MatrizDistancias, PuntoRuteo } from './tipos';

/**
 * Contrato que todo adaptador de matriz de distancias concreto cumple.
 *
 * ASÍNCRONO DESDE EL DÍA UNO, aunque el único adaptador de hoy sea
 * matemática pura sin I/O: es la condición para que sumar una matriz por
 * calle real (una llamada HTTP) sea intercambiar el adaptador, no reescribir
 * cada llamador (`docs/arquitectura/retiro-y-ruteo.md` §Bloque 2, 2.5).
 */
export interface PuertoMatriz {
  /**
   * Calcula la matriz de distancias entre TODOS los puntos recibidos, en una
   * sola llamada — igual que pediría una API de matriz real (un solo request
   * con todos los orígenes/destinos, nunca N llamadas por par). El motor de
   * optimización consulta la matriz YA resuelta; nunca llama al puerto
   * directamente dentro de su bucle de mejora.
   */
  calcularMatriz(puntos: readonly PuntoRuteo[]): Promise<MatrizDistancias>;
}

/**
 * Devuelve el adaptador de ruteo según la configuración de la plataforma.
 *
 * - `RUTEO_MATRIZ_PROVIDER` ausente o `haversine` → `HaversineMatrizAdapter`.
 * - Cualquier otro valor → `ErrorRuteoConfig` (no reintentable).
 */
export function obtenerPuertoMatriz(): PuertoMatriz {
  const proveedor = (process.env.RUTEO_MATRIZ_PROVIDER ?? 'haversine').trim().toLowerCase();

  switch (proveedor) {
    case 'haversine':
    case '':
      return new HaversineMatrizAdapter();

    default:
      // `proveedor` viene de env — texto controlado por devops, se cita entre
      // comillas y sin valores sensibles (no hay credencial que filtrar hoy).
      throw new ErrorRuteoConfig(
        `RUTEO_MATRIZ_PROVIDER='${proveedor}' no es reconocido (usa 'haversine')`,
      );
  }
}
