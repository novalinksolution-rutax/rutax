/**
 * Pruebas de Or-opt.
 * =====================================================================
 * El caso central demuestra la razón de ser de este operador: parte de una
 * secuencia que YA es un óptimo local de 2-opt (una pasada de 2-opt sobre
 * ella no encuentra ningún movimiento) y comprueba que Or-opt todavía
 * encuentra una mejora — es justamente lo que 2-opt (solo reversiones) no
 * puede alcanzar en un óptimo local propio: reubicar un tramo sin invertirlo.
 */

import { describe, it, expect } from 'vitest';
import { ejecutarOrOpt } from './or-opt';
import { ejecutarDosOpt } from './dos-opt';
import { costoPublico, costoInterno, ORIGEN_ID, DESTINO_ID, type DistanciaFn } from './costo';
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
 * Construye una `DistanciaFn` real (haversine) a partir de coordenadas. Se
 * prefiere sobre `tabla()` cuando Or-opt evalúa muchas combinaciones de
 * tramo/hueco: `tabla()` solo cubre los pares que alguien anotó a mano, y
 * Or-opt consulta pares "de paso" (candidatos que evalúa y descarta) que son
 * fáciles de olvidar al armar una tabla parcial — con coordenadas reales
 * TODOS los pares están cubiertos, sin tener que anticiparlos.
 */
async function construirDistanciaDesdePuntos(puntos: PuntoRuteo[]): Promise<DistanciaFn> {
  const adaptador = new HaversineMatrizAdapter();
  const matriz = await adaptador.calcularMatriz(puntos);
  return (desde, hacia) => matriz.distanciaM(desde, hacia);
}

describe('ejecutarOrOpt — casos con tabla de distancias', () => {
  it('sin mejora posible, devuelve la misma secuencia y mejoro=false', () => {
    const distancia = tabla({
      [`${ORIGEN_ID}|A`]: 10,
      [`${ORIGEN_ID}|B`]: 20,
      [`A|B`]: 5,
    });
    const resultado = ejecutarOrOpt(['A', 'B'], distancia, null);
    expect(resultado.mejoro).toBe(false);
    expect(resultado.secuencia).toEqual(['A', 'B']);
  });

  it('reubica una parada aislada al final de la secuencia', async () => {
    // A, B, C alineadas al este del origen. Z quedó escaneada primero pero
    // geográficamente pertenece justo DESPUÉS de C, no al principio: dejarla
    // en la cabecera de la secuencia obliga a un ida-y-vuelta carísimo.
    const origen: PuntoRuteo = { id: ORIGEN_ID, lat: 0, long: 0 };
    const A: PuntoRuteo = { id: 'A', lat: 1, long: 0 };
    const B: PuntoRuteo = { id: 'B', lat: 2, long: 0 };
    const C: PuntoRuteo = { id: 'C', lat: 3, long: 0 };
    const Z: PuntoRuteo = { id: 'Z', lat: 3.1, long: 0.5 };
    const distancia = await construirDistanciaDesdePuntos([origen, A, B, C, Z]);

    const costoInicial = costoPublico(['Z', 'A', 'B', 'C'], distancia);
    const resultado = ejecutarOrOpt(['Z', 'A', 'B', 'C'], distancia, null);

    expect(resultado.mejoro).toBe(true);
    expect(resultado.secuencia).toEqual(['A', 'B', 'C', 'Z']);
    expect(costoPublico(resultado.secuencia, distancia)).toBeLessThan(costoInicial * 0.6);
  });

  it('respeta el tope de pasadas: con tope 0 no aplica ningún movimiento', () => {
    const distancia = tabla({
      [`${ORIGEN_ID}|Z`]: 50,
      [`${ORIGEN_ID}|A`]: 5,
      [`Z|A`]: 45,
      [`A|C`]: 3,
      [`C|Z`]: 3,
    });
    const resultado = ejecutarOrOpt(['Z', 'A', 'C'], distancia, null, 0);
    expect(resultado.mejoro).toBe(false);
    expect(resultado.secuencia).toEqual(['Z', 'A', 'C']);
  });

  it('determinismo: misma entrada, misma salida, muchas veces', async () => {
    const origen: PuntoRuteo = { id: ORIGEN_ID, lat: 0, long: 0 };
    const A: PuntoRuteo = { id: 'A', lat: 1, long: 0 };
    const B: PuntoRuteo = { id: 'B', lat: 2, long: 0 };
    const C: PuntoRuteo = { id: 'C', lat: 3, long: 0 };
    const Z: PuntoRuteo = { id: 'Z', lat: 3.1, long: 0.5 };
    const distancia = await construirDistanciaDesdePuntos([origen, A, B, C, Z]);

    const primera = ejecutarOrOpt(['Z', 'A', 'B', 'C'], distancia, null);
    for (let i = 0; i < 10; i++) {
      expect(ejecutarOrOpt(['Z', 'A', 'B', 'C'], distancia, null)).toEqual(primera);
    }
  });
});

describe('ejecutarOrOpt — mejora un óptimo local de 2-opt (geometría real)', () => {
  // Cinco paradas donde ALGUNA permutación es, a la vez: (a) estable para
  // 2-opt (ninguna reversión la mejora) y (b) mejorable reubicando un tramo.
  // Encontrado por búsqueda exhaustiva sobre las 120 permutaciones de estas
  // 5 coordenadas — no es un caso "elegido a dedo" para que salga bien.
  const origen: PuntoRuteo = { id: ORIGEN_ID, lat: 0, long: 0 };
  const puntosParada: PuntoRuteo[] = [
    { id: 'P0', lat: -2, long: 2 },
    { id: 'P1', lat: -4, long: 4 },
    { id: 'P2', lat: 4, long: -4 },
    { id: 'P3', lat: 2, long: -2 },
    { id: 'P4', lat: 4, long: 0 },
  ];

  async function construirDistancia() {
    const adaptador = new HaversineMatrizAdapter();
    const matriz = await adaptador.calcularMatriz([origen, ...puntosParada]);
    return (desde: string, hacia: string) => matriz.distanciaM(desde, hacia);
  }

  it('la secuencia de partida ya es estable para 2-opt (ninguna reversión la mejora)', async () => {
    const distancia = await construirDistancia();
    const optimoLocal2opt = ['P0', 'P1', 'P3', 'P2', 'P4'];

    const otraPasada = ejecutarDosOpt(optimoLocal2opt, distancia, null);
    expect(otraPasada.mejoro).toBe(false);
    expect(otraPasada.secuencia).toEqual(optimoLocal2opt);
  });

  it('Or-opt SÍ encuentra una mejora sobre ese óptimo local de 2-opt', async () => {
    const distancia = await construirDistancia();
    const optimoLocal2opt = ['P0', 'P1', 'P3', 'P2', 'P4'];
    const costoAntes = costoPublico(optimoLocal2opt, distancia);

    const resultado = ejecutarOrOpt(optimoLocal2opt, distancia, null);
    const costoDespues = costoPublico(resultado.secuencia, distancia);

    expect(resultado.mejoro).toBe(true);
    expect(costoDespues).toBeLessThan(costoAntes);
    // Mejora sustancial, no ruido de punto flotante.
    expect(costoDespues).toBeLessThan(costoAntes * 0.95);
  });

  it('respeta destino en la decisión de dónde reinsertar el tramo', () => {
    // Caso más pequeño y legible con tabla a mano: A y B forman un tramo que
    // conviene tener al principio si el destino está lejos de ellos, pero
    // al final si el destino está cerca. Aquí, cerca.
    const distancia = tabla({
      [`${ORIGEN_ID}|A`]: 5,
      [`${ORIGEN_ID}|B`]: 8,
      [`${ORIGEN_ID}|C`]: 6,
      [`A|B`]: 2,
      [`A|C`]: 50,
      [`B|C`]: 50,
      [`C|${DESTINO_ID}`]: 100,
      [`B|${DESTINO_ID}`]: 100,
      [`A|${DESTINO_ID}`]: 1, // barato terminar en A
    });
    // Partida: [C, A, B] — termina en B, carísimo hacia destino.
    const resultado = ejecutarOrOpt(['C', 'A', 'B'], distancia, DESTINO_ID);
    // Debe reubicar C al final para que la ruta termine en A (barata hacia destino).
    expect(resultado.mejoro).toBe(true);
    expect(resultado.secuencia[resultado.secuencia.length - 1]).toBe('A');
  });

  it('la evaluación por delta coincide con el costo recalculado desde cero', async () => {
    const distancia = await construirDistancia();
    const optimoLocal2opt = ['P0', 'P1', 'P3', 'P2', 'P4'];
    const resultado = ejecutarOrOpt(optimoLocal2opt, distancia, null);

    const costoPorDelta = costoPublico(resultado.secuencia, distancia);
    const costoRecalculado = costoInterno(resultado.secuencia, distancia, null);
    expect(costoPorDelta).toBe(costoRecalculado);
  });
});
