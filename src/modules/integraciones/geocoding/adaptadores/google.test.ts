/**
 * Tests de `GoogleGeocodingAdapter`.
 * =====================================================================
 * Antes de esta extracción el adaptador no tenía cobertura propia. Se agrega
 * aquí, con foco en lo que cambió (el timeout opcional, requerido por el
 * camino síncrono de `resolverCoordenadaConCache`) más una verificación de
 * los dos casos base (OK / ZERO_RESULTS) para no dejar la clase a ciegas.
 *
 * `fetch` se mockea con `vi.stubGlobal` — mismo patrón que
 * `notificaciones/email/adaptadores/resend.test.ts` (el adaptador llama al
 * `fetch` global directo, no recibe uno inyectado).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { GoogleGeocodingAdapter } from './google';
import { ErrorGeocodingProveedor } from '../errores';

const ARGS_BASE = { direccion: 'Av. Providencia 1234', comuna: 'Providencia' };

function respuestaOk(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      status: 'OK',
      results: [
        {
          geometry: {
            location: { lat: -33.4314, lng: -70.6111 },
            location_type: 'ROOFTOP',
          },
          address_components: [{ long_name: 'Providencia', types: ['locality'] }],
        },
      ],
      ...overrides,
    }),
  };
}

describe('GoogleGeocodingAdapter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('OK con location_type ROOFTOP → resuelto, confianza 1.0, comuna canónica', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuestaOk());
    vi.stubGlobal('fetch', fetchMock);

    const adaptador = new GoogleGeocodingAdapter('api-key-secreta');
    const resultado = await adaptador.geocodificar(ARGS_BASE);

    expect(resultado).toEqual({
      resuelto: true,
      lat: -33.4314,
      long: -70.6111,
      confianza: 1.0,
      estado: 'resuelto',
      comunaResuelta: 'Providencia',
      proveedor: 'google',
    });
  });

  it('ZERO_RESULTS → no_resuelto, sin lanzar', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'ZERO_RESULTS' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const adaptador = new GoogleGeocodingAdapter('api-key-secreta');
    const resultado = await adaptador.geocodificar(ARGS_BASE);

    expect(resultado.resuelto).toBe(false);
    expect(resultado.estado).toBe('no_resuelto');
  });

  describe('timeout (args.timeoutMs)', () => {
    it('sin timeoutMs → fetch se llama SIN `signal` (comportamiento histórico del job, sin cambios)', async () => {
      const fetchMock = vi.fn().mockResolvedValue(respuestaOk());
      vi.stubGlobal('fetch', fetchMock);

      const adaptador = new GoogleGeocodingAdapter('api-key-secreta');
      await adaptador.geocodificar(ARGS_BASE);

      const [, init] = fetchMock.mock.calls[0] as [unknown, RequestInit | undefined];
      expect(init?.signal).toBeUndefined();
    });

    it('con timeoutMs → fetch se llama con un AbortSignal', async () => {
      const fetchMock = vi.fn().mockResolvedValue(respuestaOk());
      vi.stubGlobal('fetch', fetchMock);

      const adaptador = new GoogleGeocodingAdapter('api-key-secreta');
      await adaptador.geocodificar({ ...ARGS_BASE, timeoutMs: 5000 });

      const [, init] = fetchMock.mock.calls[0] as [unknown, RequestInit | undefined];
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    });

    it('un timeout real que dispara se propaga como ErrorGeocodingProveedor reintentable (mismo camino que un fallo de red)', async () => {
      const fetchMock = vi.fn(async (_u: unknown, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'TimeoutError')),
          );
        });
      });
      vi.stubGlobal('fetch', fetchMock);

      const adaptador = new GoogleGeocodingAdapter('api-key-secreta');

      await expect(
        adaptador.geocodificar({ ...ARGS_BASE, timeoutMs: 10 }),
      ).rejects.toBeInstanceOf(ErrorGeocodingProveedor);
    });

    it('el mensaje de error NUNCA incluye la api key, ni con timeout', async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error('conexión rechazada'));
      vi.stubGlobal('fetch', fetchMock);

      const adaptador = new GoogleGeocodingAdapter('api-key-secreta-nunca-debe-salir');

      await expect(
        adaptador.geocodificar({ ...ARGS_BASE, timeoutMs: 5000 }),
      ).rejects.toSatisfy((e: unknown) => {
        const mensaje = e instanceof Error ? e.message : String(e);
        return !mensaje.includes('api-key-secreta-nunca-debe-salir');
      });
    });
  });
});
