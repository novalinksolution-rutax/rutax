import { describe, expect, it } from 'vitest';

import { partirEnPedazos } from './google-compute-routes';

/** Puntos sintéticos: lo que importa acá es el troceado, no la geografía. */
const puntos = (n: number) => Array.from({ length: n }, (_, i) => ({ lat: -33 - i / 1000, long: -70 }));

/** Cuántos saltos cubre el troceado en total. Es la cifra que no puede fallar. */
const saltosCubiertos = (pedazos: { lat: number; long: number }[][]) =>
  pedazos.reduce((suma, p) => suma + p.length - 1, 0);

describe('partirEnPedazos', () => {
  it('una ruta que cabe entera va en un solo pedazo', () => {
    // 27 puntos = origen + 25 intermedios + destino: el máximo de una petición.
    const pedazos = partirEnPedazos(puntos(27));
    expect(pedazos).toHaveLength(1);
    expect(pedazos[0]).toHaveLength(27);
  });

  it('🔴 el punto de unión se REPITE: sin eso falta la pierna que los une', () => {
    const pedazos = partirEnPedazos(puntos(30));
    expect(pedazos.length).toBeGreaterThan(1);
    // El último de un pedazo es el primero del siguiente.
    for (let i = 1; i < pedazos.length; i++) {
      const anterior = pedazos[i - 1];
      expect(pedazos[i][0]).toEqual(anterior[anterior.length - 1]);
    }
  });

  it('🔴 los saltos cubiertos son EXACTAMENTE los de la ruta', () => {
    // Es la prueba que atrapa el error real: si el troceado se comiera una
    // pierna, el trazado tendría un hueco justo en el corte —donde nadie lo
    // busca— y la comprobación de «una pierna por salto» del adaptador
    // rechazaría la ruta entera sin decir por qué.
    for (const n of [2, 3, 26, 27, 28, 30, 52, 53, 100]) {
      expect(saltosCubiertos(partirEnPedazos(puntos(n)))).toBe(n - 1);
    }
  });

  it('ningún pedazo excede el tope de Google (25 intermedios = 27 puntos)', () => {
    for (const n of [28, 30, 52, 53, 100]) {
      for (const pedazo of partirEnPedazos(puntos(n))) {
        expect(pedazo.length).toBeLessThanOrEqual(27);
        // Y ninguno queda degenerado: un pedazo de un punto no es un salto.
        expect(pedazo.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('menos de dos puntos no es una ruta: no se pide nada', () => {
    expect(partirEnPedazos([])).toEqual([]);
    expect(partirEnPedazos(puntos(1))).toEqual([]);
  });

  it('dos puntos son un solo salto', () => {
    const pedazos = partirEnPedazos(puntos(2));
    expect(pedazos).toHaveLength(1);
    expect(saltosCubiertos(pedazos)).toBe(1);
  });
});
