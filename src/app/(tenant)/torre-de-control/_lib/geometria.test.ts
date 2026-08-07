/**
 * Pruebas de la caja envolvente comunal.
 *
 * Lo que protege: que entrar en una comuna la ENCUADRE. Con un zoom fijo, de
 * Pudahuel (casi 200 km²) solo se ve un pedazo —sin un borde a la vista no hay
 * forma de saber en cuál comuna estás— e Independencia (7 km²) queda diminuta
 * entre sus vecinas.
 */

import { describe, expect, it } from 'vitest';
import { limitesDe, type GeometriaComuna } from './geometria';

function poligono(coords: [number, number][]): GeometriaComuna {
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [coords] },
    properties: { comuna: 'X', cut: '13101' },
  };
}

describe('limitesDe', () => {
  it('devuelve [[oeste,sur],[este,norte]], que es el orden que espera MapLibre', () => {
    const limites = limitesDe(
      poligono([
        [-70.7, -33.5],
        [-70.6, -33.5],
        [-70.6, -33.4],
        [-70.7, -33.4],
        [-70.7, -33.5],
      ]),
    );
    expect(limites).toEqual([
      [-70.7, -33.5],
      [-70.6, -33.4],
    ]);
  });

  it('cubre todas las partes de un MultiPolygon', () => {
    // Varias comunas de la RM son multipolígono. Quedarse con la primera parte
    // dejaría fuera un trozo del territorio y el encuadre lo cortaría.
    const multi: GeometriaComuna = {
      type: 'Feature',
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [-70.7, -33.5],
              [-70.65, -33.5],
              [-70.65, -33.45],
              [-70.7, -33.5],
            ],
          ],
          [
            [
              [-70.5, -33.3],
              [-70.4, -33.3],
              [-70.4, -33.2],
              [-70.5, -33.3],
            ],
          ],
        ],
      },
      properties: { comuna: 'X', cut: '13101' },
    };
    expect(limitesDe(multi)).toEqual([
      [-70.7, -33.5],
      [-70.4, -33.2],
    ]);
  });

  it('ignora los agujeros: están dentro del anillo exterior por definición', () => {
    const conAgujero: GeometriaComuna = {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-70.7, -33.5],
            [-70.6, -33.5],
            [-70.6, -33.4],
            [-70.7, -33.4],
            [-70.7, -33.5],
          ],
          [
            [-70.68, -33.48],
            [-70.62, -33.48],
            [-70.62, -33.42],
            [-70.68, -33.48],
          ],
        ],
      },
      properties: { comuna: 'X', cut: '13101' },
    };
    expect(limitesDe(conAgujero)).toEqual([
      [-70.7, -33.5],
      [-70.6, -33.4],
    ]);
  });

  it('una comuna grande y una chica producen cajas de tamaño MUY distinto', () => {
    // Es el invariante que hace falta: si las cajas fueran parecidas, encuadrar
    // no aportaría nada sobre el zoom fijo que reemplaza.
    const grande = limitesDe(
      poligono([
        [-70.9, -33.6],
        [-70.6, -33.6],
        [-70.6, -33.3],
        [-70.9, -33.3],
        [-70.9, -33.6],
      ]),
    );
    const chica = limitesDe(
      poligono([
        [-70.67, -33.42],
        [-70.64, -33.42],
        [-70.64, -33.4],
        [-70.67, -33.4],
        [-70.67, -33.42],
      ]),
    );
    const ancho = (l: ReturnType<typeof limitesDe>) => l[1][0] - l[0][0];
    expect(ancho(grande) / ancho(chica)).toBeGreaterThan(5);
  });
});
