import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./google-credenciales', () => ({
  leerProyectoGoogle: () => 'proyecto-x',
  obtenerTokenAcceso: async () => 'token-x',
}));

import { GoogleComputeRoutesAdapter, partirEnPedazos } from './google-compute-routes';

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

describe('trazarRuta · travelMode según el vehículo', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(cuerpos: unknown[]) {
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      cuerpos.push(JSON.parse(init.body));
      // Una pierna por salto: para 2 puntos, 1 pierna. Así el adaptador no
      // rechaza la ruta por desajuste tramo↔salto.
      // El adaptador lee `.text()` (para poder diagnosticar un 200 sin piernas o
      // un no-ok sin re-consumir el cuerpo) y luego hace `JSON.parse`.
      const cuerpo = JSON.stringify({
        routes: [{ legs: [{ distanceMeters: 100, duration: '60s', polyline: { encodedPolyline: 'abc' } }] }],
      });
      return {
        ok: true,
        text: async () => cuerpo,
        json: async () => JSON.parse(cuerpo),
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
  }

  const dosPuntos = [
    { lat: -33.45, long: -70.66 },
    { lat: -33.4, long: -70.6 },
  ];

  it('por defecto va en DRIVE (auto), y no cambia a quien no pasa el modo', async () => {
    const cuerpos: Record<string, unknown>[] = [];
    stubFetch(cuerpos);
    await new GoogleComputeRoutesAdapter().trazarRuta(dosPuntos);
    expect(cuerpos[0].travelMode).toBe('DRIVE');
  });

  it('moto → TWO_WHEELER llega tal cual al request de Google', async () => {
    const cuerpos: Record<string, unknown>[] = [];
    stubFetch(cuerpos);
    await new GoogleComputeRoutesAdapter().trazarRuta(dosPuntos, 'TWO_WHEELER');
    expect(cuerpos[0].travelMode).toBe('TWO_WHEELER');
  });
});
