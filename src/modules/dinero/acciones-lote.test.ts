/**
 * Tests del núcleo de emisión por LOTES (§1.4 P1).
 * Verifica el AISLAMIENTO de fallos (un elemento que falla no cancela los demás),
 * la agregación de conteos, el orden y el tope de tamaño — inyectando una acción
 * simulada, sin BD.
 */

import { describe, it, expect } from 'vitest';
import { ejecutarLoteConAislamiento } from './acciones-lote';
import { MAX_ELEMENTOS_LOTE } from './preflight-lote';

describe('ejecutarLoteConAislamiento', () => {
  it('todos exitosos → exitosos=N, fallidos=0, en orden', async () => {
    const vistos: string[] = [];
    const r = await ejecutarLoteConAislamiento(['a', 'b', 'c'], async (id) => {
      vistos.push(id);
    });
    expect(r.exitosos).toBe(3);
    expect(r.fallidos).toBe(0);
    expect(r.resultados.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(r.resultados.every((x) => x.ok)).toBe(true);
    // Secuencial y en orden.
    expect(vistos).toEqual(['a', 'b', 'c']);
  });

  it('un elemento que falla NO cancela los demás (aislamiento)', async () => {
    const r = await ejecutarLoteConAislamiento(['ok1', 'malo', 'ok2'], async (id) => {
      if (id === 'malo') throw new Error('no se pudo emitir');
    });
    expect(r.exitosos).toBe(2);
    expect(r.fallidos).toBe(1);
    const malo = r.resultados.find((x) => x.id === 'malo')!;
    expect(malo.ok).toBe(false);
    expect(malo.mensaje).toBe('no se pudo emitir');
    // Los OK conservan su éxito y su mensaje null.
    expect(r.resultados.find((x) => x.id === 'ok1')!.ok).toBe(true);
    expect(r.resultados.find((x) => x.id === 'ok2')!.ok).toBe(true);
  });

  it('lote vacío → 0 y 0', async () => {
    const r = await ejecutarLoteConAislamiento([], async () => {});
    expect(r.exitosos).toBe(0);
    expect(r.fallidos).toBe(0);
    expect(r.resultados).toEqual([]);
  });

  it('supera el tope de elementos → lanza', async () => {
    const ids = Array.from({ length: MAX_ELEMENTOS_LOTE + 1 }, (_, i) => String(i));
    await expect(ejecutarLoteConAislamiento(ids, async () => {})).rejects.toThrow(
      /máximo de/,
    );
  });

  it('error no-Error se reporta con mensaje genérico', async () => {
    const r = await ejecutarLoteConAislamiento(['x'], async () => {
      throw 'string suelto';
    });
    expect(r.resultados[0].ok).toBe(false);
    expect(r.resultados[0].mensaje).toBe('Error desconocido.');
  });
});
