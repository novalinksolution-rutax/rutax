/**
 * Tests unitarios: proyectarWebhook.
 *
 * Qué se prueba:
 * - Sin endpoints suscritos → no inserta nada.
 * - Con endpoints suscritos → inserta una fila por endpoint.
 * - Silencioso ante errores (no propaga excepciones).
 * - Usa `contains` para filtrar por tipo de evento.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks -----------------------------------------------------------------
let mockEndpoints: Array<{ id: string }> = [];
let mockEndpointError: { message: string } | null = null;
let insertCalls: Array<Record<string, unknown>> = [];
let insertError: { message: string } | null = null;

const mockInsert = vi.fn((data: Record<string, unknown>) => {
  insertCalls.push(data);
  return Promise.resolve({ error: insertError });
});

// Builder de cadena de llamadas para webhook_endpoints.
const endpointQueryChain = {
  select: vi.fn(() => endpointQueryChain),
  eq: vi.fn(() => endpointQueryChain),
  contains: vi.fn(() => Promise.resolve({ data: mockEndpoints, error: mockEndpointError })),
};

// Builder de cadena de llamadas para webhook_outbox.
const outboxQueryChain = {
  insert: mockInsert,
};

const mockFrom = vi.fn((table: string) => {
  if (table === 'webhook_endpoints') return endpointQueryChain;
  if (table === 'webhook_outbox') return outboxQueryChain;
  return {};
});

const mockSchema = vi.fn(() => ({ from: mockFrom }));

vi.mock('@/lib/supabase/service-role', () => ({
  crearClienteServiceRole: () => ({ schema: mockSchema }),
}));
// ---------------------------------------------------------------------------

import { proyectarWebhook } from './proyectar-webhook';

describe('proyectarWebhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEndpoints = [];
    mockEndpointError = null;
    insertCalls = [];
    insertError = null;
  });

  it('no inserta nada si no hay endpoints activos suscritos', async () => {
    mockEndpoints = [];
    await proyectarWebhook('tenant-1', 'pedido.entregado', { pedidoId: 'p1' });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('inserta una fila por cada endpoint suscrito', async () => {
    mockEndpoints = [{ id: 'ep-1' }, { id: 'ep-2' }];

    await proyectarWebhook('tenant-1', 'pedido.entregado', { pedidoId: 'p1' });

    expect(mockInsert).toHaveBeenCalledTimes(2);

    const calls = mockInsert.mock.calls.map((c) => c[0] as Record<string, unknown>);
    expect(calls[0].endpoint_id).toBe('ep-1');
    expect(calls[1].endpoint_id).toBe('ep-2');
    expect(calls[0].evento_tipo).toBe('pedido.entregado');
    expect(calls[0].estado).toBe('pendiente');
    expect(calls[0].tenant_id).toBe('tenant-1');
    expect((calls[0].payload as Record<string, unknown>).pedidoId).toBe('p1');
  });

  it('filtra por tipo de evento usando contains', async () => {
    mockEndpoints = [];
    await proyectarWebhook('tenant-1', 'liquidacion.emitida', {});

    expect(endpointQueryChain.contains).toHaveBeenCalledWith('eventos', ['liquidacion.emitida']);
  });

  it('es silencioso si la query de endpoints falla', async () => {
    mockEndpointError = { message: 'Error de BD simulado' };
    // No debe lanzar excepción.
    await expect(
      proyectarWebhook('tenant-1', 'pedido.entregado', {}),
    ).resolves.toBeUndefined();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('es silencioso si un insert de outbox falla', async () => {
    mockEndpoints = [{ id: 'ep-1' }];
    insertError = { message: 'Error de insert' };

    // No debe lanzar excepción.
    await expect(
      proyectarWebhook('tenant-1', 'pedido.entregado', {}),
    ).resolves.toBeUndefined();
  });

  it('es silencioso si se lanza una excepción inesperada', async () => {
    // Forzar un error en el schema.
    mockSchema.mockImplementationOnce(() => {
      throw new Error('Error catastrófico');
    });

    await expect(
      proyectarWebhook('tenant-1', 'pedido.entregado', {}),
    ).resolves.toBeUndefined();
  });
});
