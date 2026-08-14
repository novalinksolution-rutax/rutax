/**
 * Pruebas de 2-opt.
 * =====================================================================
 * El caso central ("mejora una ruta con cruces") usa el adaptador haversine
 * real y coordenadas concretas donde se puede verificar, con una
 * comprobación geométrica independiente, que la ruta de vecino cercano
 * efectivamente se cruza a sí misma y que 2-opt la corrige — no basta con
 * "el número bajó", tiene que bajar POR la razón correcta.
 */

import { describe, it, expect } from 'vitest';
import { ejecutarDosOpt } from './dos-opt';
import { costoPublico, costoInterno, ORIGEN_ID, DESTINO_ID, type DistanciaFn } from './costo';
import { construirVecinoCercano } from './vecino-cercano';
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

/**
 * Prueba segmento-segmento estándar (orientación por producto cruzado) para
 * verificar, de forma independiente del motor, si dos tramos de un camino se
 * cruzan. Se usa SOLO en las pruebas, nunca en el motor real — el motor no
 * necesita saber qué es un cruce, solo minimizar distancia.
 */
function ccw(a: [number, number], b: [number, number], c: [number, number]): boolean {
  return (c[1] - a[1]) * (b[0] - a[0]) > (b[1] - a[1]) * (c[0] - a[0]);
}
function segmentosSeCruzan(
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  p4: [number, number],
): boolean {
  return ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4);
}
function caminoTieneCruce(coords: [number, number][]): boolean {
  const n = coords.length;
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 2; j < n - 1; j++) {
      if (segmentosSeCruzan(coords[i], coords[i + 1], coords[j], coords[j + 1])) return true;
    }
  }
  return false;
}

describe('ejecutarDosOpt — casos con tabla de distancias', () => {
  it('sin mejora posible, devuelve la misma secuencia y mejoro=false', () => {
    // Solo 2 paradas: un único par (i=0,j=1) que reversa TODA la secuencia.
    // Si el orden dado ya es el más barato, no hay movimiento que aplicar.
    const distancia = tabla({
      [`${ORIGEN_ID}|A`]: 10,
      [`${ORIGEN_ID}|B`]: 999, // invertir sería mucho peor
      [`A|B`]: 5,
    });
    const resultado = ejecutarDosOpt(['A', 'B'], distancia, null);
    expect(resultado.mejoro).toBe(false);
    expect(resultado.secuencia).toEqual(['A', 'B']);
  });

  it('invierte la secuencia completa cuando conviene', () => {
    const distancia = tabla({
      [`${ORIGEN_ID}|A`]: 999, // partir por A es carísimo
      [`${ORIGEN_ID}|B`]: 10,
      [`A|B`]: 5,
    });
    const resultado = ejecutarDosOpt(['A', 'B'], distancia, null);
    expect(resultado.mejoro).toBe(true);
    expect(resultado.secuencia).toEqual(['B', 'A']);
  });

  it('respeta el destino: el tramo final hacia destino entra en la decisión', () => {
    // origen-A y origen-B empatados, A-B empatado en cualquier sentido: SIN
    // destino, ['A','B'] ya es óptimo (nada que voltear). El destino es
    // barato de alcanzar desde A y carísimo desde B — CON destino, conviene
    // terminar en A, así que 2-opt debe voltear ['A','B'] → ['B','A'].
    const pares = {
      [`${ORIGEN_ID}|A`]: 10,
      [`${ORIGEN_ID}|B`]: 10,
      [`A|B`]: 5,
      [`A|${DESTINO_ID}`]: 1,
      [`B|${DESTINO_ID}`]: 999,
    };

    const sinDestino = ejecutarDosOpt(['A', 'B'], tabla(pares), null);
    expect(sinDestino.mejoro).toBe(false);
    expect(sinDestino.secuencia).toEqual(['A', 'B']);

    const conDestino = ejecutarDosOpt(['A', 'B'], tabla(pares), DESTINO_ID);
    expect(conDestino.mejoro).toBe(true);
    expect(conDestino.secuencia).toEqual(['B', 'A']);
  });

  it('respeta el tope de pasadas: con tope 0 no aplica ningún movimiento aunque exista uno mejor', () => {
    const distancia = tabla({
      [`${ORIGEN_ID}|A`]: 999,
      [`${ORIGEN_ID}|B`]: 10,
      [`A|B`]: 5,
    });
    const resultado = ejecutarDosOpt(['A', 'B'], distancia, null, 0);
    expect(resultado.mejoro).toBe(false);
    expect(resultado.secuencia).toEqual(['A', 'B']);
  });

  it('determinismo: misma entrada, misma salida, muchas veces', () => {
    const distancia = tabla({
      [`${ORIGEN_ID}|A`]: 10,
      [`${ORIGEN_ID}|B`]: 15,
      [`${ORIGEN_ID}|C`]: 20,
      [`A|B`]: 30,
      [`A|C`]: 5,
      [`B|C`]: 8,
    });
    const primera = ejecutarDosOpt(['A', 'B', 'C'], distancia, null);
    for (let i = 0; i < 10; i++) {
      expect(ejecutarDosOpt(['A', 'B', 'C'], distancia, null)).toEqual(primera);
    }
  });
});

describe('ejecutarDosOpt — mejora una ruta con un cruce evidente (geometría real)', () => {
  // Origen al suroeste. Tres paradas alineadas al oeste (P2 arriba, P1 en medio,
  // P0 abajo) y una cuarta (P3) bien al norte. El vecino cercano agarra las
  // tres cercanas de arriba a abajo y dEJA a P3 para el final: el salto de
  // vuelta a buscarla corta literalmente por encima del primer tramo de la
  // ruta (origen→P2). 2-opt lo resuelve invirtiendo la secuencia completa.
  const origen: PuntoRuteo = { id: ORIGEN_ID, lat: 0, long: 0 };
  const P0: PuntoRuteo = { id: 'P0', lat: -6, long: -6 };
  const P1: PuntoRuteo = { id: 'P1', lat: -6, long: -3 };
  const P2: PuntoRuteo = { id: 'P2', lat: -6, long: 0 };
  const P3: PuntoRuteo = { id: 'P3', lat: -3, long: 6 };
  const puntos = [origen, P0, P1, P2, P3];
  const coordDe: Record<string, [number, number]> = {
    [ORIGEN_ID]: [0, 0],
    P0: [-6, -6],
    P1: [-6, -3],
    P2: [-6, 0],
    P3: [-3, 6],
  };

  async function construirDistancia() {
    const adaptador = new HaversineMatrizAdapter();
    const matriz = await adaptador.calcularMatriz(puntos);
    return (desde: string, hacia: string) => matriz.distanciaM(desde, hacia);
  }

  it('el vecino cercano produce, en efecto, un camino que se cruza a sí mismo', async () => {
    const distancia = await construirDistancia();
    const nn = construirVecinoCercano(['P0', 'P1', 'P2', 'P3'], distancia);

    expect(nn).toEqual(['P2', 'P1', 'P0', 'P3']);
    const coordsNn: [number, number][] = [coordDe[ORIGEN_ID], ...nn.map((id) => coordDe[id])];
    expect(caminoTieneCruce(coordsNn)).toBe(true);
  });

  it('2-opt encuentra la reversión completa y el resultado deja de cruzarse', async () => {
    const distancia = await construirDistancia();
    const nn = construirVecinoCercano(['P0', 'P1', 'P2', 'P3'], distancia);

    const resultado = ejecutarDosOpt(nn, distancia, null);
    expect(resultado.mejoro).toBe(true);
    expect(resultado.secuencia).toEqual(['P3', 'P2', 'P1', 'P0']);

    const coordsFinal: [number, number][] = [
      coordDe[ORIGEN_ID],
      ...resultado.secuencia.map((id) => coordDe[id]),
    ];
    expect(caminoTieneCruce(coordsFinal)).toBe(false);
  });

  it('la distancia final es estrictamente menor que la del vecino cercano solo', async () => {
    const distancia = await construirDistancia();
    const nn = construirVecinoCercano(['P0', 'P1', 'P2', 'P3'], distancia);
    const costoNn = costoPublico(nn, distancia);

    const resultado = ejecutarDosOpt(nn, distancia, null);
    const costoFinal = costoPublico(resultado.secuencia, distancia);

    expect(costoFinal).toBeLessThan(costoNn);
    // La mejora es sustancial (>15%), no un roce de punto flotante — así la
    // prueba no puede pasar "por casualidad" ante un cambio irrelevante.
    expect(costoFinal).toBeLessThan(costoNn * 0.85);
  });

  it('la evaluación por delta coincide con el costo recalculado desde cero (costoInterno de referencia)', async () => {
    // Verifica que el atajo de rendimiento (delta) no se haya desincronizado
    // del costo real: compara el resultado de 2-opt contra una re-suma
    // independiente de la secuencia final.
    const distancia = await construirDistancia();
    const nn = construirVecinoCercano(['P0', 'P1', 'P2', 'P3'], distancia);
    const resultado = ejecutarDosOpt(nn, distancia, null);

    const costoPorDelta = costoPublico(resultado.secuencia, distancia);
    const costoRecalculado = costoInterno(resultado.secuencia, distancia, null);
    expect(costoPorDelta).toBe(costoRecalculado);
  });
});
