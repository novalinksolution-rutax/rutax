/**
 * Construcción inicial: vecino más cercano (nearest neighbor).
 * =====================================================================
 * Heurística golosa: parte del origen y, en cada paso, salta al punto no
 * visitado más cercano a la posición actual. Es rápida (O(n²)) y da un
 * punto de partida razonable para que 2-opt/Or-opt (`dos-opt.ts`/`or-opt.ts`)
 * terminen de pulir.
 *
 * NO conoce `destino`: es deliberado. El destino solo entra a jugar en la
 * función de costo de la optimización local (ver `costo.ts` → `costoInterno`,
 * usado por `dos-opt.ts`/`or-opt.ts`), nunca en esta construcción — mantiene
 * esta función simple, autocontenida y fácil de probar en aislamiento.
 *
 * DETERMINISTA: ante una distancia empatada EXACTA, se queda con la parada
 * que apareció PRIMERO en `ids` (el arreglo de entrada, en el mismo orden en
 * que `motor.ts` recorrió `EntradaRuteo.paradas`). El desempate es explícito
 * por índice de arreglo — nunca por orden de iteración de un `Map`/`Set` ni
 * por `Math.random`.
 */

import type { DistanciaFn } from './costo';
import { ORIGEN_ID } from './costo';

/**
 * Devuelve el orden de visita de `ids` (los `pedidoId`, ya filtrados a los
 * que tienen coordenada — ver `sinUbicar` en `motor.ts`, esta función no
 * sabe nada de eso).
 */
export function construirVecinoCercano(ids: readonly string[], distancia: DistanciaFn): string[] {
  const n = ids.length;
  const visitado = new Array<boolean>(n).fill(false);
  const secuencia: string[] = [];
  let actualId = ORIGEN_ID;

  for (let paso = 0; paso < n; paso++) {
    let mejorIndice = -1;
    let mejorDistancia = Infinity;

    for (let i = 0; i < n; i++) {
      if (visitado[i]) continue;
      const d = distancia(actualId, ids[i]);
      // `<` estricto: ante un empate exacto el candidato ya elegido (de
      // índice más bajo) NO se reemplaza por uno con la misma distancia.
      if (d < mejorDistancia) {
        mejorDistancia = d;
        mejorIndice = i;
      }
    }

    visitado[mejorIndice] = true;
    actualId = ids[mejorIndice];
    secuencia.push(actualId);
  }

  return secuencia;
}
