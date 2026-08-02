/**
 * Pruebas del adaptador real de FERIADOS (api.boostr.cl).
 * =====================================================================
 *
 * El fixture es la respuesta LITERAL que devolvió api.boostr.cl el 2026-07-26
 * (recortada). Sirve sobre todo para blindar el gotcha del nombre del campo:
 * la marca de irrenunciable se llama `inalienable`.
 */

import { describe, it, expect, vi } from 'vitest';
import { BoostrCalendarioAdapter } from './boostr';

/** Recorte literal de la respuesta real. */
const FIXTURE = {
  status: 'success',
  data: [
    {
      date: '2026-01-01',
      title: 'Año Nuevo',
      type: 'Civil',
      inalienable: true,
      extra: 'Civil e Irrenunciable',
    },
    {
      date: '2026-04-03',
      title: 'Viernes Santo',
      type: 'Civil',
      inalienable: false,
      extra: 'Civil',
    },
    {
      date: '2026-09-18',
      title: 'Independencia Nacional',
      type: 'Civil',
      inalienable: true,
      extra: 'Civil e Irrenunciable',
    },
  ],
};

function respuestaOk(cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const REINTENTOS_RAPIDOS = { maxIntentos: 3, dormir: async () => {} };

describe('BoostrCalendarioAdapter — parseo', () => {
  it('mapea a la forma de contexto.calendario', async () => {
    const fetchImpl = vi.fn(async () => respuestaOk(FIXTURE));
    const adapter = new BoostrCalendarioAdapter({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      reintentos: REINTENTOS_RAPIDOS,
    });

    const res = await adapter.obtenerFeriados({ anios: [2026] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.datos.proveedor).toBe('boostr');
    expect(res.datos.aniosResueltos).toEqual([2026]);
    expect(res.datos.feriados[0]).toEqual({
      fecha: '2026-01-01',
      nombre: 'Año Nuevo',
      tipo: 'Civil',
      irrenunciable: true,
    });
  });

  it('lee la marca de irrenunciable del campo `inalienable`', async () => {
    // Si alguien "corrige" el nombre a `irrenunciable`, este test se pone rojo
    // en vez de dejar pasar en silencio un 18 de septiembre marcado como
    // renunciable.
    const fetchImpl = vi.fn(async () => respuestaOk(FIXTURE));
    const adapter = new BoostrCalendarioAdapter({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      reintentos: REINTENTOS_RAPIDOS,
    });

    const res = await adapter.obtenerFeriados({ anios: [2026] });
    if (!res.ok) throw new Error('esperaba éxito');

    const dieciocho = res.datos.feriados.find((f) => f.fecha === '2026-09-18')!;
    expect(dieciocho.irrenunciable).toBe(true);
    const santo = res.datos.feriados.find((f) => f.fecha === '2026-04-03')!;
    expect(santo.irrenunciable).toBe(false);
  });

  it('consulta el endpoint por año', async () => {
    const fetchImpl = vi.fn(async (_url: URL) => respuestaOk(FIXTURE));
    const adapter = new BoostrCalendarioAdapter({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      reintentos: REINTENTOS_RAPIDOS,
    });

    await adapter.obtenerFeriados({ anios: [2026, 2027] });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0].pathname).toBe('/holidays/2026.json');
    expect(fetchImpl.mock.calls[1][0].pathname).toBe('/holidays/2027.json');
  });

  it('descarta entradas malformadas sin tumbar el lote', async () => {
    const fetchImpl = vi.fn(async () =>
      respuestaOk({
        status: 'success',
        data: [
          { date: 'no-es-fecha', title: 'X', inalienable: true },
          { date: '2026-05-01', title: '', inalienable: true },
          { date: '2026-05-01', title: 'Día del Trabajo', inalienable: true },
        ],
      }),
    );
    const adapter = new BoostrCalendarioAdapter({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      reintentos: REINTENTOS_RAPIDOS,
    });

    const res = await adapter.obtenerFeriados({ anios: [2026] });
    if (!res.ok) throw new Error('esperaba éxito');
    expect(res.datos.feriados).toHaveLength(1);
    expect(res.datos.feriados[0].nombre).toBe('Día del Trabajo');
    // Sin `type` en el origen, no se inventa una etiqueta.
    expect(res.datos.feriados[0].tipo).toBe('Desconocido');
  });
});

describe('BoostrCalendarioAdapter — resiliencia y degradación', () => {
  it('reintenta un 503 y se recupera', async () => {
    let llamadas = 0;
    const fetchImpl = vi.fn(async () => {
      llamadas += 1;
      if (llamadas === 1) return new Response('', { status: 503 });
      return respuestaOk(FIXTURE);
    });
    const adapter = new BoostrCalendarioAdapter({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      reintentos: { maxIntentos: 3, dormir: async () => {} },
    });

    const res = await adapter.obtenerFeriados({ anios: [2026] });
    expect(res.ok).toBe(true);
    expect(llamadas).toBe(2);
  });

  it('fuente caída → "no pude" sin excepción', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND api.boostr.cl');
    });
    const adapter = new BoostrCalendarioAdapter({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      reintentos: { maxIntentos: 2, dormir: async () => {} },
    });

    const res = await adapter.obtenerFeriados({ anios: [2026] });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reintentable).toBe(true);
    expect(res.motivo).toContain('feriados');
    expect(res.motivo).not.toContain('ENOTFOUND');
  });

  it('un 404 degrada como NO reintentable', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 404 }));
    const adapter = new BoostrCalendarioAdapter({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      reintentos: { maxIntentos: 3, dormir: async () => {} },
    });

    const res = await adapter.obtenerFeriados({ anios: [2026] });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reintentable).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('status distinto de success degrada como no reintentable', async () => {
    const fetchImpl = vi.fn(async () => respuestaOk({ status: 'error', data: [] }));
    const adapter = new BoostrCalendarioAdapter({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      reintentos: REINTENTOS_RAPIDOS,
    });

    const res = await adapter.obtenerFeriados({ anios: [2026] });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reintentable).toBe(false);
  });

  it('un año fuera de rango degrada en vez de lanzar', async () => {
    const adapter = new BoostrCalendarioAdapter({
      fetchImpl: (async () => respuestaOk(FIXTURE)) as unknown as typeof fetch,
    });
    const res = await adapter.obtenerFeriados({ anios: [12345] });
    expect(res.ok).toBe(false);
  });
});

describe('BoostrCalendarioAdapter — idempotencia de lectura', () => {
  it('dos llamadas iguales dan el mismo conjunto, con claves (fecha, nombre) únicas', async () => {
    const fetchImpl = vi.fn(async () => respuestaOk(FIXTURE));
    const adapter = new BoostrCalendarioAdapter({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      reintentos: REINTENTOS_RAPIDOS,
    });

    const a = await adapter.obtenerFeriados({ anios: [2026] });
    const b = await adapter.obtenerFeriados({ anios: [2026] });
    if (!a.ok || !b.ok) throw new Error('esperaba éxito');

    expect(a.datos.feriados).toEqual(b.datos.feriados);
    const claves = a.datos.feriados.map((f) => `${f.fecha}|${f.nombre}`);
    expect(new Set(claves).size).toBe(claves.length);
  });
});
