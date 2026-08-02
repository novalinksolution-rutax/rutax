/**
 * Tests del núcleo de observabilidad.
 *
 * Verifica el comportamiento DSN-gated: sin DSN → log estructurado y CERO red;
 * con DSN → envío a Sentry (envelope) con el contexto ya redactado; y que
 * capturar NUNCA propaga un fallo del transporte.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { capturarExcepcion, capturarMensaje } from './index';
import { MARCA_REDACTADO } from './redaccion';

const DSN = 'https://publicabc@o123.ingest.sentry.io/456';

describe('observabilidad — sin SENTRY_DSN (fallback a logs)', () => {
  beforeEach(() => {
    vi.stubEnv('SENTRY_DSN', '');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('capturarExcepcion registra en console.error y NO hace fetch', async () => {
    await capturarExcepcion(new Error('falló el cierre'), { origen: 'job:dinero/cerrarPeriodo' });
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('capturarMensaje warning registra en console.warn', async () => {
    await capturarMensaje('hay discrepancias', 'warning', { origen: 'job:dinero/conciliarTresFuentes' });
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});

describe('observabilidad — con SENTRY_DSN (envío a Sentry)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv('SENTRY_DSN', DSN);
    fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('envía un envelope al endpoint del proyecto con el sentry_key', async () => {
    await capturarExcepcion(new Error('boom'), { origen: 'request', tenantId: 't-1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opciones] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/456/envelope/');
    expect(url).toContain('sentry_key=publicabc');
    expect(opciones.method).toBe('POST');
  });

  it('redacta el contexto sensible antes de enviarlo', async () => {
    await capturarExcepcion(new Error('boom'), {
      origen: 'action:emitirFactura',
      extra: { access_token: 'super-secreto-999', pedidoId: 'p-1' },
    });
    const [, opciones] = fetchMock.mock.calls[0] as [string, RequestInit];
    const cuerpo = String(opciones.body);
    expect(cuerpo).not.toContain('super-secreto-999');
    expect(cuerpo).toContain(MARCA_REDACTADO);
    expect(cuerpo).toContain('p-1'); // el id de negocio sí viaja
  });

  it('no propaga si el transporte falla; cae a console.error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('red caída'));
    await expect(
      capturarExcepcion(new Error('boom'), { origen: 'job:x' }),
    ).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled(); // fallback a log
  });
});
