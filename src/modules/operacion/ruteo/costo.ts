/**
 * Primitivas de costo compartidas por el motor de ruteo: la construcción
 * (`vecino-cercano.ts`) y la optimización local (`dos-opt.ts`, `or-opt.ts`).
 * =====================================================================
 *
 * Este archivo concentra la ÚNICA definición de "cuánto cuesta una
 * secuencia", en sus dos variantes (pública y con destino). Que sea una sola
 * función por variante, importada por todo lo demás, es lo que evita que
 * `motor.ts` calcule `distanciaTotalM` de una forma y el optimizador juzgue
 * sus movimientos con otra ligeramente distinta — exactamente el tipo de
 * desincronización que ya mordió a este proyecto en otras partes (ver
 * CLAUDE.md, el CHECK de `tipo_diferencia_conciliacion`).
 */

/** Id reservado para el origen (bodega del courier) dentro de la matriz de distancias. */
export const ORIGEN_ID = '__ruteo_origen__';

/** Id reservado para el destino (punto de término del conductor), cuando existe. */
export const DESTINO_ID = '__ruteo_destino__';

/**
 * Firma mínima para consultar la matriz ya resuelta (`MatrizDistancias.distanciaM`
 * de `integraciones/ruteo`, parcialmente aplicada). SIEMPRE síncrona: el
 * bucle de optimización la llama miles de veces por corrida y no puede
 * pagar un `await` por consulta — ver `docs/arquitectura/retiro-y-ruteo.md`
 * §Bloque 2, 2.5 (medido: evaluación por delta vs. recálculo completo).
 */
export type DistanciaFn = (desdeId: string, haciaId: string) => number;

/**
 * Costo PÚBLICO de una secuencia: de `ORIGEN_ID` a la última parada, sin
 * ningún tramo final hacia el destino aunque exista. Es, literalmente,
 * `distanciaTotalM` (ver `tipos.ts`) — la única función que lo calcula, para
 * que nunca haya dos lugares que puedan desincronizarse sobre qué cuenta y
 * qué no.
 */
export function costoPublico(secuencia: readonly string[], distancia: DistanciaFn): number {
  if (secuencia.length === 0) return 0;

  let total = distancia(ORIGEN_ID, secuencia[0]);
  for (let i = 1; i < secuencia.length; i++) {
    total += distancia(secuencia[i - 1], secuencia[i]);
  }
  return total;
}

/**
 * Costo INTERNO de una secuencia: igual que `costoPublico`, pero SUMA el
 * tramo final hacia `destinoId` cuando existe. Es el criterio que usan
 * 2-opt/Or-opt para decidir qué orden conviene — así el destino sesga qué
 * parada queda al final (el valor real de tener un punto de término: la
 * ruta tiende a terminar cerca de casa), sin que ese sesgo se filtre jamás
 * al número público que ve el coordinador.
 *
 * Nunca se expone fuera de este módulo: es un valor de trabajo del
 * optimizador, no algo que `RutaCalculada` deba conocer.
 */
export function costoInterno(
  secuencia: readonly string[],
  distancia: DistanciaFn,
  destinoId: string | null,
): number {
  const base = costoPublico(secuencia, distancia);
  if (destinoId === null || secuencia.length === 0) return base;
  return base + distancia(secuencia[secuencia.length - 1], destinoId);
}
