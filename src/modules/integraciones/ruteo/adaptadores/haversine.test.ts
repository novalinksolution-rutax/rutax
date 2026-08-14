/**
 * Pruebas del adaptador haversine de la matriz de ruteo.
 * =====================================================================
 * No reprueba la geometría (eso ya lo cubren las 11 pruebas de
 * `lib/geo/distancia.test.ts`): prueba que el adaptador arma la matriz bien
 * — simétrica, con la diagonal en cero, y que falla fuerte (no en silencio)
 * ante un par fuera de los puntos calculados o un id duplicado.
 */

import { describe, it, expect } from 'vitest';
import { HaversineMatrizAdapter } from './haversine';
import { distanciaEnMetros } from '@/lib/geo/distancia';
import type { PuntoRuteo } from '../tipos';

const BODEGA: PuntoRuteo = { id: 'bodega', lat: -33.45, long: -70.66 };
const A: PuntoRuteo = { id: 'a', lat: -33.4, long: -70.6 };
const B: PuntoRuteo = { id: 'b', lat: -33.5, long: -70.7 };
const C: PuntoRuteo = { id: 'c', lat: -33.42, long: -70.55 };

describe('HaversineMatrizAdapter', () => {
  it('la distancia entre dos puntos coincide con distanciaEnMetros', async () => {
    const adaptador = new HaversineMatrizAdapter();
    const matriz = await adaptador.calcularMatriz([BODEGA, A]);

    expect(matriz.distanciaM('bodega', 'a')).toBeCloseTo(distanciaEnMetros(BODEGA, A), 6);
  });

  it('es simétrica: distanciaM(a,b) === distanciaM(b,a)', async () => {
    const adaptador = new HaversineMatrizAdapter();
    const matriz = await adaptador.calcularMatriz([BODEGA, A, B, C]);

    expect(matriz.distanciaM('bodega', 'c')).toBe(matriz.distanciaM('c', 'bodega'));
    expect(matriz.distanciaM('a', 'b')).toBe(matriz.distanciaM('b', 'a'));
  });

  it('la distancia de un punto consigo mismo es 0, sin pasar por el cálculo', async () => {
    const adaptador = new HaversineMatrizAdapter();
    const matriz = await adaptador.calcularMatriz([BODEGA]);

    expect(matriz.distanciaM('bodega', 'bodega')).toBe(0);
  });

  it('resuelve TODOS los pares de un conjunto de N puntos, no solo los consecutivos', async () => {
    const adaptador = new HaversineMatrizAdapter();
    const matriz = await adaptador.calcularMatriz([BODEGA, A, B, C]);

    // Los seis pares posibles entre 4 puntos, cruzados (no solo vecinos de la lista).
    expect(matriz.distanciaM('bodega', 'a')).toBeCloseTo(distanciaEnMetros(BODEGA, A), 6);
    expect(matriz.distanciaM('bodega', 'b')).toBeCloseTo(distanciaEnMetros(BODEGA, B), 6);
    expect(matriz.distanciaM('bodega', 'c')).toBeCloseTo(distanciaEnMetros(BODEGA, C), 6);
    expect(matriz.distanciaM('a', 'b')).toBeCloseTo(distanciaEnMetros(A, B), 6);
    expect(matriz.distanciaM('a', 'c')).toBeCloseTo(distanciaEnMetros(A, C), 6);
    expect(matriz.distanciaM('b', 'c')).toBeCloseTo(distanciaEnMetros(B, C), 6);
  });

  it('pedir un par que no estaba en los puntos calculados lanza, nunca devuelve NaN/Infinity', async () => {
    const adaptador = new HaversineMatrizAdapter();
    const matriz = await adaptador.calcularMatriz([BODEGA, A]);

    expect(() => matriz.distanciaM('bodega', 'fantasma')).toThrow(
      /no hay distancia calculada/,
    );
  });

  it('un id duplicado en los puntos de entrada falla fuerte, no pisa la fila en silencio', async () => {
    const adaptador = new HaversineMatrizAdapter();
    const duplicado: PuntoRuteo = { id: 'a', lat: -1, long: -1 };

    await expect(adaptador.calcularMatriz([BODEGA, A, duplicado])).rejects.toThrow(
      /id duplicado/,
    );
  });

  it('con un solo punto, la matriz igual se construye (0 pares, sin explotar)', async () => {
    const adaptador = new HaversineMatrizAdapter();
    const matriz = await adaptador.calcularMatriz([BODEGA]);

    expect(matriz.distanciaM('bodega', 'bodega')).toBe(0);
  });
});
