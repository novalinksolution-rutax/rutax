/**
 * Tests del helper de rate limiting (ventana fija vía RPC Postgres).
 *
 * Foco: la semántica permitido/bloqueado/restante y — crítico — el FAIL-OPEN:
 * un fallo del limitador JAMÁS bloquea tráfico (webhooks legítimos no se caen
 * porque Postgres tosió).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcMock = vi.fn();
vi.mock('@/lib/supabase/service-role', () => ({
  crearClienteServiceRole: () => ({ rpc: rpcMock }),
}));

import { consumirRateLimit } from './index';

beforeEach(() => {
  rpcMock.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('consumirRateLimit', () => {
  it('permite cuando el contador está dentro del límite', async () => {
    rpcMock.mockResolvedValue({ data: 3, error: null });
    const r = await consumirRateLimit('ml:123', 10, 60);
    expect(r.permitido).toBe(true);
    expect(r.restante).toBe(7);
    expect(r.reintentarEnSegundos).toBe(0);
    expect(rpcMock).toHaveBeenCalledWith('rate_limit_consumir', {
      p_llave: 'ml:123',
      p_ventana_segundos: 60,
    });
  });

  it('permite exactamente en el límite (contador == limite)', async () => {
    rpcMock.mockResolvedValue({ data: 10, error: null });
    const r = await consumirRateLimit('ml:123', 10, 60);
    expect(r.permitido).toBe(true);
    expect(r.restante).toBe(0);
  });

  it('bloquea cuando el contador excede el límite, con Retry-After de la ventana', async () => {
    rpcMock.mockResolvedValue({ data: 11, error: null });
    const r = await consumirRateLimit('ml:123', 10, 60);
    expect(r.permitido).toBe(false);
    expect(r.restante).toBe(0);
    expect(r.reintentarEnSegundos).toBe(60);
  });

  it('FAIL-OPEN: error de la RPC → permitido', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    const r = await consumirRateLimit('fintoc:t1', 30, 60);
    expect(r.permitido).toBe(true);
  });

  it('FAIL-OPEN: respuesta no numérica → permitido', async () => {
    rpcMock.mockResolvedValue({ data: 'basura', error: null });
    const r = await consumirRateLimit('fintoc:t1', 30, 60);
    expect(r.permitido).toBe(true);
  });

  it('FAIL-OPEN: excepción del cliente → permitido', async () => {
    rpcMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const r = await consumirRateLimit('fintoc:t1', 30, 60);
    expect(r.permitido).toBe(true);
  });
});
