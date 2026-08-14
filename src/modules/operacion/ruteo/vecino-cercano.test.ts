/**
 * Pruebas de la construcción por vecino cercano.
 * =====================================================================
 * Con una `DistanciaFn` FALSA (tabla en memoria) para los casos de orden
 * puro, y con el adaptador haversine real para el caso de empate exacto —
 * porque un empate exacto de punto flotante es justamente lo que una tabla
 * a mano no puede demostrar de forma creíble (podría estar "haciendo trampa"
 * con el mismo número escrito dos veces).
 */

import { describe, it, expect } from 'vitest';
import { construirVecinoCercano } from './vecino-cercano';
import { ORIGEN_ID, type DistanciaFn } from './costo';
import { HaversineMatrizAdapter } from '@/modules/integraciones/ruteo/adaptadores/haversine';
import type { PuntoRuteo } from '@/modules/integraciones/ruteo/tipos';

function tabla(pares: Record<string, number>): DistanciaFn {
  return (desde, hacia) => {
    const directa = pares[`${desde}|${hacia}`];
    if (directa !== undefined) return directa;
    const inversa = pares[`${hacia}|${desde}`];
    if (inversa !== undefined) return inversa;
    throw new Error(`sin distancia de prueba para ${desde}->${hacia}`);
  };
}

describe('construirVecinoCercano', () => {
  it('sin paradas, devuelve secuencia vacía', () => {
    expect(construirVecinoCercano([], tabla({}))).toEqual([]);
  });

  it('una sola parada, la visita', () => {
    const distancia = tabla({ [`${ORIGEN_ID}|A`]: 5 });
    expect(construirVecinoCercano(['A'], distancia)).toEqual(['A']);
  });

  it('elige, en cada paso, al no visitado más cercano a la posición actual', () => {
    // origen -> C (la más cercana, 5) -> A (desde C, 3) -> B (lo único que queda).
    const distancia = tabla({
      [`${ORIGEN_ID}|A`]: 50,
      [`${ORIGEN_ID}|B`]: 100,
      [`${ORIGEN_ID}|C`]: 5,
      [`A|B`]: 40,
      [`A|C`]: 3,
      [`B|C`]: 60,
    });
    expect(construirVecinoCercano(['A', 'B', 'C'], distancia)).toEqual(['C', 'A', 'B']);
  });

  it('ante un empate EXACTO, se queda con la parada de índice más bajo en el arreglo de entrada', () => {
    const distancia = tabla({
      [`${ORIGEN_ID}|A`]: 10,
      [`${ORIGEN_ID}|B`]: 10, // empate exacto con A
      [`A|B`]: 999,
    });

    // 'A' aparece primero en el arreglo de entrada → debe ganar el empate.
    expect(construirVecinoCercano(['A', 'B'], distancia)).toEqual(['A', 'B']);
    // Invertido: ahora 'B' aparece primero → 'B' gana el mismo empate.
    expect(construirVecinoCercano(['B', 'A'], distancia)).toEqual(['B', 'A']);
  });

  it('el empate exacto también ocurre con geometría real (haversine), no solo en una tabla armada a mano', async () => {
    // A y B son reflejo exacto uno del otro respecto de la longitud del
    // origen (misma latitud, longitud opuesta): la fórmula de haversine da
    // el mismo resultado en punto flotante, bit a bit — verificado en
    // `docs`/análisis previo, no es una coincidencia frágil.
    const origen: PuntoRuteo = { id: ORIGEN_ID, lat: -33.45, long: -70.66 };
    const A: PuntoRuteo = { id: 'A', lat: -33.4, long: -70.6 };
    const B: PuntoRuteo = { id: 'B', lat: -33.4, long: -70.72 };

    const adaptador = new HaversineMatrizAdapter();
    const matriz = await adaptador.calcularMatriz([origen, A, B]);
    const distancia: DistanciaFn = (a, b) => matriz.distanciaM(a, b);

    // Confirma la premisa del caso: el empate es EXACTO, no aproximado.
    expect(matriz.distanciaM(ORIGEN_ID, 'A')).toBe(matriz.distanciaM(ORIGEN_ID, 'B'));

    expect(construirVecinoCercano(['A', 'B'], distancia)).toEqual(['A', 'B']);
    expect(construirVecinoCercano(['B', 'A'], distancia)).toEqual(['B', 'A']);
  });

  it('determinismo: la misma entrada produce siempre la misma salida', () => {
    const distancia = tabla({
      [`${ORIGEN_ID}|A`]: 10,
      [`${ORIGEN_ID}|B`]: 10,
      [`${ORIGEN_ID}|C`]: 20,
      [`A|B`]: 5,
      [`A|C`]: 8,
      [`B|C`]: 12,
    });

    const primera = construirVecinoCercano(['A', 'B', 'C'], distancia);
    for (let i = 0; i < 20; i++) {
      expect(construirVecinoCercano(['A', 'B', 'C'], distancia)).toEqual(primera);
    }
  });
});
