/**
 * Pruebas de las primitivas de costo — la pieza que sostiene la garantía de
 * privacidad del punto de término (ver la cabecera de `motor.ts` y
 * `docs/seguridad/punto-de-termino-conductor.md` §4).
 *
 * Se prueban con una `DistanciaFn` FALSA (una tabla en memoria), no con el
 * adaptador haversine real: estas funciones no saben de geometría, solo de
 * sumar — probarlas contra una tabla arbitraria deja más claro qué exigen de
 * su entrada.
 */

import { describe, it, expect } from 'vitest';
import { costoPublico, costoInterno, ORIGEN_ID, DESTINO_ID, type DistanciaFn } from './costo';

/** Tabla de distancias fija para las pruebas — completa entre {origen,A,B,C,destino}. */
function distanciaDePrueba(): DistanciaFn {
  const tabla: Record<string, number> = {
    [`${ORIGEN_ID}|A`]: 10,
    [`${ORIGEN_ID}|B`]: 40,
    [`${ORIGEN_ID}|C`]: 999, // deliberadamente cara: nunca debería usarse si A es la primera parada
    [`A|B`]: 20,
    [`A|C`]: 15,
    [`B|C`]: 30,
    [`A|${DESTINO_ID}`]: 50,
    [`B|${DESTINO_ID}`]: 5,
    [`C|${DESTINO_ID}`]: 100,
  };
  return (desde, hacia) => {
    const directa = tabla[`${desde}|${hacia}`];
    if (directa !== undefined) return directa;
    const inversa = tabla[`${hacia}|${desde}`];
    if (inversa !== undefined) return inversa;
    throw new Error(`sin distancia de prueba para ${desde}->${hacia}`);
  };
}

describe('costoPublico', () => {
  it('secuencia vacía → 0', () => {
    expect(costoPublico([], distanciaDePrueba())).toBe(0);
  });

  it('una sola parada → distancia origen→parada', () => {
    expect(costoPublico(['A'], distanciaDePrueba())).toBe(10);
  });

  it('varias paradas → suma de los tramos consecutivos, origen incluido', () => {
    // origen->A (10) + A->B (20) + B->C (30) = 60
    expect(costoPublico(['A', 'B', 'C'], distanciaDePrueba())).toBe(60);
  });

  it('su firma NO recibe destino: estructuralmente no puede sumarlo', () => {
    // No es una prueba en runtime (eso lo verifica el compilador), sino la
    // documentación de la garantía: `costoPublico` toma (secuencia, distancia)
    // y nada más. Se deja como comentario ejecutable de la firma real.
    expect(costoPublico.length).toBe(2);
  });
});

describe('costoInterno', () => {
  it('sin destino, es idéntico a costoPublico', () => {
    const distancia = distanciaDePrueba();
    expect(costoInterno(['A', 'B', 'C'], distancia, null)).toBe(costoPublico(['A', 'B', 'C'], distancia));
  });

  it('con destino, suma el tramo final hacia él — y SOLO ese tramo', () => {
    const distancia = distanciaDePrueba();
    // costoPublico(['A','B','C']) = 60; + B... espera, el tramo final es
    // desde la ÚLTIMA parada (C) hacia destino: 60 + d(C,destino)=60+100=160.
    expect(costoInterno(['A', 'B', 'C'], distancia, DESTINO_ID)).toBe(160);
  });

  it('el destino sesga distinto según cuál quede al final: A último es más barato que C último', () => {
    const distancia = distanciaDePrueba();
    // ['B','C'] termina en C: público 10... construido para variar el final.
    const terminaEnC = costoInterno(['A', 'B', 'C'], distancia, DESTINO_ID); // termina en C: +100
    const terminaEnB = costoInterno(['A', 'C', 'B'], distancia, DESTINO_ID); // termina en B: +5 (más barato)
    expect(terminaEnB).toBeLessThan(terminaEnC);
  });

  it('secuencia vacía con destino → 0 (no hay última parada de la cual salir)', () => {
    expect(costoInterno([], distanciaDePrueba(), DESTINO_ID)).toBe(0);
  });
});
