/**
 * Pruebas de las paradas fijadas.
 *
 * La invariante dura, y la razón de que este archivo sea largo para una
 * función de veinte líneas: **el resultado nunca pierde ni duplica una
 * parada**. Perder una es un paquete que desaparece de la ruta del día.
 */

import { describe, expect, it } from 'vitest';

import { fusionarConFijas, separarFijas } from './paradas-fijas';

describe('separarFijas', () => {
  it('separa las que traen un orden usable', () => {
    const { fijas, libres } = separarFijas([
      { pedidoId: 'a' },
      { pedidoId: 'b', ordenFijo: 3 },
      { pedidoId: 'c', ordenFijo: null },
    ]);

    expect(fijas).toEqual([{ pedidoId: 'b', orden: 3 }]);
    expect(libres.map((l) => l.pedidoId)).toEqual(['a', 'c']);
  });

  it('un orden corrupto se trata como libre en vez de tumbar la ruta', () => {
    // Viene de una ruta HTTP: puede llegar cualquier cosa, y una posición
    // ilegible no puede impedir que se calcule la ruta del día.
    const { fijas, libres } = separarFijas([
      { pedidoId: 'a', ordenFijo: 0 },
      { pedidoId: 'b', ordenFijo: -2 },
      { pedidoId: 'c', ordenFijo: 1.5 },
      { pedidoId: 'd', ordenFijo: Number.NaN },
    ]);

    expect(fijas).toEqual([]);
    expect(libres).toHaveLength(4);
  });
});

describe('fusionarConFijas', () => {
  it('sin fijas devuelve la secuencia del motor tal cual', () => {
    expect(fusionarConFijas(['a', 'b', 'c'], [])).toEqual(['a', 'b', 'c']);
  });

  it('pone la fijada exactamente en su posición', () => {
    // El caso del diseño: el conductor manda una parada a la 2 y el resto se
    // acomoda alrededor.
    expect(fusionarConFijas(['a', 'b', 'c'], [{ pedidoId: 'z', orden: 2 }])).toEqual([
      'a',
      'z',
      'b',
      'c',
    ]);
  });

  it('respeta varias fijas a la vez, en orden', () => {
    expect(
      fusionarConFijas(['a', 'b', 'c', 'd'], [
        { pedidoId: 'y', orden: 1 },
        { pedidoId: 'z', orden: 4 },
      ]),
    ).toEqual(['y', 'a', 'b', 'z', 'c', 'd']);
  });

  it('un orden más allá del final se pega al final, sin dejar huecos', () => {
    // Una secuencia con agujeros no significa nada para un conductor.
    expect(fusionarConFijas(['a', 'b'], [{ pedidoId: 'z', orden: 99 }])).toEqual(['a', 'b', 'z']);
  });

  it('dos fijas con el mismo orden no se pierden: la segunda va a continuación', () => {
    const r = fusionarConFijas(['a'], [
      { pedidoId: 'y', orden: 1 },
      { pedidoId: 'z', orden: 1 },
    ]);
    expect(r).toHaveLength(3);
    expect(new Set(r)).toEqual(new Set(['a', 'y', 'z']));
  });

  it('una fija repetida no se duplica', () => {
    const r = fusionarConFijas(['a'], [
      { pedidoId: 'z', orden: 1 },
      { pedidoId: 'z', orden: 2 },
    ]);
    expect(r).toEqual(['z', 'a']);
  });

  it('INVARIANTE: nunca pierde ni duplica una parada, ni en el caso adversarial', () => {
    const libres = ['l1', 'l2', 'l3', 'l4', 'l5'];
    const fijas = [
      { pedidoId: 'f1', orden: 1 },
      { pedidoId: 'f2', orden: 1 }, // empate
      { pedidoId: 'f3', orden: 3 },
      { pedidoId: 'f4', orden: 999 }, // fuera de rango
      { pedidoId: 'f5', orden: 2 },
    ];

    const r = fusionarConFijas(libres, fijas);

    const esperados = [...libres, ...fijas.map((f) => f.pedidoId)];
    expect(r).toHaveLength(esperados.length);
    expect(new Set(r)).toEqual(new Set(esperados));
    // Sin duplicados.
    expect(new Set(r).size).toBe(r.length);
  });

  it('es determinista: la misma entrada da la misma salida', () => {
    const libres = ['a', 'b', 'c'];
    const fijas = [
      { pedidoId: 'z', orden: 2 },
      { pedidoId: 'y', orden: 2 },
    ];
    expect(fusionarConFijas(libres, fijas)).toEqual(fusionarConFijas(libres, fijas));
  });
});

// =============================================================================
// De punta a punta: el motor completo respeta la fijación
// =============================================================================

import { calcularRuta } from './motor';
import { HaversineMatrizAdapter } from '@/modules/integraciones/ruteo/adaptadores/haversine';

/** Cuatro paradas en línea recta hacia el este, a ~1 km una de otra. */
const EN_FILA = [
  { pedidoId: 'p1', lat: 0, long: 0.01 },
  { pedidoId: 'p2', lat: 0, long: 0.02 },
  { pedidoId: 'p3', lat: 0, long: 0.03 },
  { pedidoId: 'p4', lat: 0, long: 0.04 },
];
const ORIGEN = { lat: 0, long: 0 };

describe('calcularRuta con paradas fijadas', () => {
  it('sin fijar, el motor las ordena por cercanía', async () => {
    const r = await calcularRuta(
      { origen: ORIGEN, destino: null, paradas: EN_FILA },
      new HaversineMatrizAdapter(),
    );
    expect(r.secuencia.map((s) => s.pedidoId)).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('la parada fijada queda donde el conductor la dejó, aunque sea peor ruta', async () => {
    // `p4` es la más lejana y el motor la pondría al final. El conductor la
    // manda a la 1 y ahí se queda: es exactamente la corrección manual que el
    // motor no puede deshacer.
    const r = await calcularRuta(
      {
        origen: ORIGEN,
        destino: null,
        paradas: EN_FILA.map((p) => (p.pedidoId === 'p4' ? { ...p, ordenFijo: 1 } : p)),
      },
      new HaversineMatrizAdapter(),
    );

    expect(r.secuencia[0]).toEqual({ pedidoId: 'p4', orden: 1 });
    // Y no se perdió ninguna.
    expect(r.secuencia).toHaveLength(4);
    expect(new Set(r.secuencia.map((s) => s.pedidoId))).toEqual(
      new Set(['p1', 'p2', 'p3', 'p4']),
    );
  });

  it('el kilometraje se mide sobre la ruta REAL, con la fijada incluida', async () => {
    const libre = await calcularRuta(
      { origen: ORIGEN, destino: null, paradas: EN_FILA },
      new HaversineMatrizAdapter(),
    );
    const fijada = await calcularRuta(
      {
        origen: ORIGEN,
        destino: null,
        paradas: EN_FILA.map((p) => (p.pedidoId === 'p4' ? { ...p, ordenFijo: 1 } : p)),
      },
      new HaversineMatrizAdapter(),
    );

    // Ir primero a la más lejana y devolverse es más largo. Si el total no
    // subiera, sería señal de que se calculó sobre la secuencia optimizada y
    // no sobre la que el conductor va a manejar.
    expect(fijada.distanciaTotalM).toBeGreaterThan(libre.distanciaTotalM);
  });

  it('una parada sin coordenada sigue yendo a sinUbicar aunque venga fijada', async () => {
    const r = await calcularRuta(
      {
        origen: ORIGEN,
        destino: null,
        paradas: [...EN_FILA, { pedidoId: 'pX', lat: null, long: null, ordenFijo: 2 }],
      },
      new HaversineMatrizAdapter(),
    );

    expect(r.sinUbicar).toEqual([{ pedidoId: 'pX', motivo: 'sin_coordenada' }]);
    expect(r.secuencia.map((s) => s.pedidoId)).not.toContain('pX');
  });
});
