/**
 * Tipos del puerto de ruteo — la matriz de distancias entre puntos.
 * =====================================================================
 *
 * Mismo espíritu que `integraciones/geocoding/tipos.ts`: describe el contrato
 * del puerto y el resultado normalizado que todo adaptador (haversine hoy,
 * una matriz por calle mañana) devuelve. El motor de ruteo real —vecino
 * cercano + 2-opt + Or-opt, en `src/modules/operacion/ruteo/`— NO conoce el
 * detalle de ningún adaptador concreto: solo depende de
 * `MatrizDistancias.distanciaM`.
 */

import type { Punto } from '@/lib/geo/distancia';

/**
 * Un punto a incluir en la matriz, con un id estable. El motor de ruteo usa
 * el `pedidoId` para las paradas y dos ids reservados (`ORIGEN_ID`/
 * `DESTINO_ID` de `operacion/ruteo/costo.ts`) para la bodega y el punto de
 * término.
 */
export interface PuntoRuteo extends Punto {
  id: string;
}

/**
 * Matriz de distancias ya resuelta: acceso O(1) por par de ids, sin volver a
 * tocar el adaptador ni hacer I/O. El motor de optimización (2-opt/Or-opt)
 * hace miles de consultas por corrida — resolverlas todas por adelantado, en
 * UNA sola llamada al puerto, es lo que permite que el bucle de mejora sea
 * 100% síncrono y rápido (nunca un `await` por par evaluado).
 *
 * NO se garantiza simétrica en general: el adaptador de hoy (haversine) sí lo
 * es, pero una futura matriz por calle podría no serlo (calles de sentido
 * único). El motor de HOY asume simetría a propósito — ver la nota en
 * `operacion/ruteo/dos-opt.ts` y `or-opt.ts`.
 */
export interface MatrizDistancias {
  /** Distancia en METROS entre dos puntos por su id. */
  distanciaM(desdeId: string, haciaId: string): number;
}
