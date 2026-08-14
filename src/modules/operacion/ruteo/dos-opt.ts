/**
 * 2-opt: revierte segmentos de la secuencia para deshacer cruces.
 * =====================================================================
 *
 * Adaptación de 2-opt a un CAMINO ABIERTO con extremos fijos: `ORIGEN_ID`
 * siempre antes de la primera parada, `destinoId` (si existe) siempre
 * después de la última. A diferencia del 2-opt de libro de texto (sobre un
 * tour CERRADO), acá no se excluye ningún par `(i,j)` por simetría del
 * ciclo — no hay ciclo: origen y destino son anclas distintas y fijas, y
 * invertir la secuencia completa (`i=0, j=n-1`) es un movimiento válido.
 *
 * EVALUACIÓN POR DELTA, no por recálculo completo. Revertir el segmento
 * `[i..j]` cambia, COMO MUCHO, dos aristas: la que entra a la posición `i` y
 * la que sale de la posición `j`. La suma de las aristas INTERNAS del
 * segmento no cambia al invertirlo, porque cada arista interna se recorre en
 * sentido contrario y la distancia es simétrica (`d(x,y) === d(y,x)`) — el
 * argumento estándar de 2-opt, sin nada propio de este proyecto. Medir el
 * delta de cada candidato es O(1); recalcular el costo completo de la ruta
 * por candidato sería O(n) y, sobre el barrido O(n²) de una sola pasada,
 * hace la diferencia entre milisegundos y segundos a 100-200 paradas (ver
 * `docs/arquitectura/retiro-y-ruteo.md` §Bloque 2, 2.5).
 *
 * ⚠️ ASUME DISTANCIAS SIMÉTRICAS. Cierto para el único adaptador de hoy
 * (`HaversineMatrizAdapter`). Si el día de mañana un `PuertoMatriz` de calles
 * de sentido único lo reemplaza, esta evaluación por delta deja de ser
 * válida sin más — revisar esta nota ANTES de enchufarlo (o recalcular el
 * costo completo del segmento revertido, más caro pero siempre correcto).
 *
 * TOPE DE PASADAS: cada movimiento aceptado reduce estrictamente el costo
 * interno (más allá del ruido de punto flotante — ver `EPS_MEJORA_M`), así
 * que el proceso converge solo cuando ya no hay mejora que hacer. El tope es
 * la red de seguridad explícita que pide el alcance de la etapa 7, no el
 * mecanismo de parada habitual.
 */

import { ORIGEN_ID, type DistanciaFn } from './costo';

/** Ignora "mejoras" menores a esto: ruido de punto flotante, no una mejora real (nada se mueve por menos de una micra). */
const EPS_MEJORA_M = 1e-6;

/**
 * Tope de pasadas (una pasada = un barrido completo de todos los pares
 * `(i,j)` seguido de, como mucho, UN movimiento: el de mayor mejora
 * encontrado en esa pasada). Con evaluación por delta una pasada es O(n²);
 * para el techo de volumen medido en el plan (200 paradas) eso es del orden
 * de 20.000 comparaciones O(1). 200 pasadas da margen generoso incluso para
 * una convergencia anormalmente lenta, sin arriesgar un tiempo de cómputo
 * perceptible — ver la prueba de rendimiento en `motor.test.ts`, que mide
 * contra este tope real.
 */
export const TOPE_PASADAS_DOS_OPT = 200;

export interface ResultadoOptimizacion {
  secuencia: string[];
  /** `true` si al menos un movimiento se aplicó. */
  mejoro: boolean;
}

/**
 * Mejora `secuenciaInicial` con 2-opt hasta un óptimo local (o hasta agotar
 * `topePasadas`). Descenso más pronunciado (steepest descent): en cada
 * pasada busca el MEJOR movimiento entre TODOS los pares `(i,j)` y aplica
 * solo ése. Determinista: ante empate EXACTO de delta se queda con el primer
 * par encontrado en el orden de barrido (`i` ascendente y, dentro de cada
 * `i`, `j` ascendente), porque solo se reemplaza el mejor candidato con un
 * delta ESTRICTAMENTE menor.
 */
export function ejecutarDosOpt(
  secuenciaInicial: readonly string[],
  distancia: DistanciaFn,
  destinoId: string | null,
  topePasadas: number = TOPE_PASADAS_DOS_OPT,
): ResultadoOptimizacion {
  const secuencia = [...secuenciaInicial];
  let mejoro = false;

  for (let pasada = 0; pasada < topePasadas; pasada++) {
    const n = secuencia.length;
    let mejorDelta = -EPS_MEJORA_M;
    let mejorI = -1;
    let mejorJ = -1;

    for (let i = 0; i < n - 1; i++) {
      const antesDeI = i === 0 ? ORIGEN_ID : secuencia[i - 1];

      for (let j = i + 1; j < n; j++) {
        const despuesDeJ = j === n - 1 ? destinoId : secuencia[j + 1];

        const costoViejo =
          distancia(antesDeI, secuencia[i]) +
          (despuesDeJ !== null ? distancia(secuencia[j], despuesDeJ) : 0);
        const costoNuevo =
          distancia(antesDeI, secuencia[j]) +
          (despuesDeJ !== null ? distancia(secuencia[i], despuesDeJ) : 0);

        const delta = costoNuevo - costoViejo;
        if (delta < mejorDelta) {
          mejorDelta = delta;
          mejorI = i;
          mejorJ = j;
        }
      }
    }

    if (mejorI === -1) break; // ninguna mejora por encima del ruido: óptimo local

    // Revertir [mejorI..mejorJ] en el sitio.
    let izquierda = mejorI;
    let derecha = mejorJ;
    while (izquierda < derecha) {
      const tmp = secuencia[izquierda];
      secuencia[izquierda] = secuencia[derecha];
      secuencia[derecha] = tmp;
      izquierda++;
      derecha--;
    }
    mejoro = true;
  }

  return { secuencia, mejoro };
}
