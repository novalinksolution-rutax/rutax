/**
 * Or-opt: reubica un tramo corto (1, 2 o 3 paradas consecutivas) en otro
 * punto de la secuencia, sin invertirlo.
 * =====================================================================
 *
 * Complementa a 2-opt: hay reordenamientos que 2-opt no alcanza a arreglar
 * con una sola reversión (el ejemplo clásico: una parada aislada que quedó
 * "de paso" en mitad de un tramo largo) y que sacar-e-insertar sí resuelve
 * en un solo movimiento.
 *
 * SIMPLIFICACIÓN A PROPÓSITO: el tramo se reinserta en el mismo sentido en
 * que estaba (nunca invertido). Es la variante más común de Or-opt en la
 * práctica y evita duplicar la lógica de "¿conviene invertirlo también?" —
 * 2-opt ya cubre las reversiones. Con `largo = 1` (el caso más frecuente) la
 * pregunta ni siquiera aplica: invertir un solo elemento no hace nada.
 *
 * EVALUACIÓN POR DELTA, mismo criterio que `dos-opt.ts`: quitar el tramo
 * cambia como mucho 2 aristas (las que lo rodeaban, que se cierran en una al
 * quitarlo); insertarlo en un hueco cambia como mucho 2 aristas más (el
 * hueco se abre en dos). Nunca se recalcula el costo completo de la ruta por
 * candidato.
 *
 * ⚠️ Misma asunción de simetría que `dos-opt.ts` — ver esa cabecera.
 */

import { ORIGEN_ID, type DistanciaFn } from './costo';

/** Ignora "mejoras" menores a esto: mismo umbral y mismo motivo que `dos-opt.ts`. */
const EPS_MEJORA_M = 1e-6;

/** Largos de tramo que se prueban a reubicar, en ese orden — Or-opt clásico. */
const LARGOS_TRAMO = [1, 2, 3] as const;

/**
 * Tope de pasadas — mismo criterio y mismo valor que `TOPE_PASADAS_DOS_OPT`
 * (ver esa constante): red de seguridad, no el mecanismo de parada habitual.
 * Una pasada evalúa, por cada uno de los 3 largos de tramo, O(n) posiciones
 * de origen por O(n) huecos de destino — O(n²) por largo, O(n²) en total.
 */
export const TOPE_PASADAS_OR_OPT = 200;

export interface ResultadoOptimizacion {
  secuencia: string[];
  mejoro: boolean;
}

/** Costo de la arista `[prevId, nextId]` — 0 si `nextId` no existe (fin de ruta sin destino, nada que cerrar). */
function costoBorde(distancia: DistanciaFn, prevId: string, nextId: string | null): number {
  return nextId !== null ? distancia(prevId, nextId) : 0;
}

interface Movimiento {
  inicio: number;
  largo: number;
  huecoTrasIndice: number;
}

/**
 * Mejora `secuenciaInicial` con Or-opt hasta un óptimo local (o hasta agotar
 * `topePasadas`). Mismo criterio determinista que `ejecutarDosOpt`: en cada
 * pasada aplica solo el MEJOR movimiento entre todos los candidatos, y ante
 * empate exacto de delta gana el primero encontrado en el orden de barrido
 * (largo ascendente, luego posición de inicio ascendente, luego hueco de
 * destino ascendente).
 */
export function ejecutarOrOpt(
  secuenciaInicial: readonly string[],
  distancia: DistanciaFn,
  destinoId: string | null,
  topePasadas: number = TOPE_PASADAS_OR_OPT,
): ResultadoOptimizacion {
  let secuencia = [...secuenciaInicial];
  let mejoro = false;

  for (let pasada = 0; pasada < topePasadas; pasada++) {
    const n = secuencia.length;
    let mejorDelta = -EPS_MEJORA_M;
    let mejorMovimiento: Movimiento | null = null;

    for (const largo of LARGOS_TRAMO) {
      if (largo >= n) continue; // no queda nada fuera del tramo para recibirlo

      for (let inicio = 0; inicio + largo <= n; inicio++) {
        const fin = inicio + largo - 1;
        const prevId = inicio === 0 ? ORIGEN_ID : secuencia[inicio - 1];
        const nextId = fin === n - 1 ? destinoId : secuencia[fin + 1];
        const primerDelTramo = secuencia[inicio];
        const ultimoDelTramo = secuencia[fin];

        // Costo de QUITAR el tramo: se cierran los dos bordes que lo rodeaban
        // en uno solo (prev→next).
        const costoAntes =
          distancia(prevId, primerDelTramo) + costoBorde(distancia, ultimoDelTramo, nextId);
        const costoCierre = costoBorde(distancia, prevId, nextId);
        const deltaQuitar = costoCierre - costoAntes;

        // La secuencia restante, sin el tramo — para enumerar huecos donde
        // reinsertarlo. `hueco` = índice DENTRO de `restante` antes del cual
        // se inserta (0 = al principio, `restante.length` = al final).
        const restante = [...secuencia.slice(0, inicio), ...secuencia.slice(fin + 1)];
        const m = restante.length;

        for (let hueco = 0; hueco <= m; hueco++) {
          const left = hueco === 0 ? ORIGEN_ID : restante[hueco - 1];
          const right = hueco === m ? destinoId : restante[hueco];

          const costoAbrir = costoBorde(distancia, left, right);
          const costoInsertar =
            distancia(left, primerDelTramo) + costoBorde(distancia, ultimoDelTramo, right);
          const deltaInsertar = costoInsertar - costoAbrir;

          // El hueco que reconstruye la posición original evalúa a
          // deltaInsertar = -deltaQuitar (delta total 0): no hace falta
          // excluirlo a propósito, nunca gana sobre una mejora real.
          const deltaTotal = deltaQuitar + deltaInsertar;
          if (deltaTotal < mejorDelta) {
            mejorDelta = deltaTotal;
            mejorMovimiento = { inicio, largo, huecoTrasIndice: hueco };
          }
        }
      }
    }

    if (!mejorMovimiento) break; // ninguna mejora por encima del ruido: óptimo local

    const { inicio, largo, huecoTrasIndice } = mejorMovimiento;
    const fin = inicio + largo - 1;
    const tramo = secuencia.slice(inicio, fin + 1);
    const restante = [...secuencia.slice(0, inicio), ...secuencia.slice(fin + 1)];
    secuencia = [
      ...restante.slice(0, huecoTrasIndice),
      ...tramo,
      ...restante.slice(huecoTrasIndice),
    ];
    mejoro = true;
  }

  return { secuencia, mejoro };
}
