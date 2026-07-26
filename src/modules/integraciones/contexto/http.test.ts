/**
 * Pruebas del fetch con timeout y clasificación de errores.
 * =====================================================================
 */

import { describe, it, expect, vi } from 'vitest';
import { ErrorContextoProveedor, ErrorContextoRespuesta } from './errores';
import { obtenerJson, referenciaSegura, retryAfterAMs } from './http';

const URL_PRUEBA = new URL('https://api.open-meteo.com/v1/forecast?latitude=-33');

describe('referenciaSegura — nunca citar el query string', () => {
  it('devuelve solo host + path', () => {
    expect(referenciaSegura(URL_PRUEBA)).toBe('api.open-meteo.com/v1/forecast');
  });

  it('recorta un query con apikey', () => {
    const ref = referenciaSegura(
      'https://customer-api.open-meteo.com/v1/forecast?apikey=SECRETO',
    );
    expect(ref).not.toContain('SECRETO');
    expect(ref).not.toContain('apikey');
  });

  it('no lanza ante una URL ilegible', () => {
    expect(referenciaSegura('no-es-una-url')).toBe('(url ilegible)');
  });
});

describe('retryAfterAMs', () => {
  it('interpreta segundos', () => {
    expect(retryAfterAMs('7')).toBe(7000);
    expect(retryAfterAMs('0')).toBe(0);
  });

  it('interpreta una fecha HTTP futura', () => {
    const futuro = new Date(Date.now() + 5000).toUTCString();
    const ms = retryAfterAMs(futuro)!;
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(5000);
  });

  it('una fecha pasada da 0, no negativo', () => {
    expect(retryAfterAMs(new Date(Date.now() - 60_000).toUTCString())).toBe(0);
  });

  it('devuelve undefined si no está o no se entiende', () => {
    expect(retryAfterAMs(null)).toBeUndefined();
    expect(retryAfterAMs('mañana')).toBeUndefined();
  });
});

describe('obtenerJson — clasificación de errores', () => {
  function fetchQueDevuelve(respuesta: Response) {
    return vi.fn(async () => respuesta) as unknown as typeof fetch;
  }

  it('devuelve el JSON en el camino feliz', async () => {
    const datos = await obtenerJson<{ a: number }>(URL_PRUEBA, {
      fetchImpl: fetchQueDevuelve(
        new Response(JSON.stringify({ a: 1 }), { status: 200 }),
      ),
    });
    expect(datos).toEqual({ a: 1 });
  });

  it('un fallo de red es reintentable y no cita la URL completa', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;

    await expect(obtenerJson(URL_PRUEBA, { fetchImpl })).rejects.toMatchObject({
      name: 'ErrorContextoProveedor',
      reintentable: true,
    });

    try {
      await obtenerJson(URL_PRUEBA, { fetchImpl });
    } catch (e) {
      expect((e as Error).message).not.toContain('latitude');
      expect((e as Error).message).toContain('api.open-meteo.com/v1/forecast');
    }
  });

  it('429 es reintentable y transporta el Retry-After', async () => {
    const fetchImpl = fetchQueDevuelve(
      new Response('', { status: 429, headers: { 'retry-after': '12' } }),
    );
    try {
      await obtenerJson(URL_PRUEBA, { fetchImpl });
      throw new Error('debió lanzar');
    } catch (e) {
      const err = e as ErrorContextoProveedor;
      expect(err.reintentable).toBe(true);
      expect(err.codigoHttp).toBe(429);
      expect(err.retryAfterMs).toBe(12_000);
    }
  });

  it('5xx es reintentable', async () => {
    const fetchImpl = fetchQueDevuelve(new Response('', { status: 503 }));
    await expect(obtenerJson(URL_PRUEBA, { fetchImpl })).rejects.toMatchObject({
      reintentable: true,
      codigoHttp: 503,
    });
  });

  it('4xx distinto de 429 NO es reintentable', async () => {
    const fetchImpl = fetchQueDevuelve(new Response('', { status: 400 }));
    await expect(obtenerJson(URL_PRUEBA, { fetchImpl })).rejects.toMatchObject({
      reintentable: false,
      codigoHttp: 400,
    });
  });

  it('un cuerpo que no es JSON da ErrorContextoRespuesta (no reintentable)', async () => {
    const fetchImpl = fetchQueDevuelve(
      new Response('<html>oops</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );
    await expect(obtenerJson(URL_PRUEBA, { fetchImpl })).rejects.toBeInstanceOf(
      ErrorContextoRespuesta,
    );
  });

  it('pasa un AbortSignal con timeout a fetch — nada de esperas indefinidas', async () => {
    const fetchImpl = vi.fn(async (_u: unknown, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    await obtenerJson(URL_PRUEBA, { fetchImpl, timeoutMs: 1000 });
  });

  it('un timeout real degrada como reintentable', async () => {
    // `AbortSignal.timeout` dispara y `fetch` rechaza con AbortError.
    const fetchImpl = vi.fn(async (_u: unknown, init?: RequestInit) => {
      await new Promise((_r, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted.', 'AbortError')),
        );
      });
      return new Response('{}');
    }) as unknown as typeof fetch;

    await expect(
      obtenerJson(URL_PRUEBA, { fetchImpl, timeoutMs: 10 }),
    ).rejects.toMatchObject({ reintentable: true });
  });
});
