/**
 * Tests unitarios: autenticarApiKey y verificarPermiso.
 *
 * Qué se prueba:
 * - Ausencia de header → null.
 * - Header malformado (sin "Bearer ") → null.
 * - Clave válida → contexto correcto.
 * - Clave revocada (no la devuelve la query) → null.
 * - `verificarPermiso`: permiso presente → true; ausente → false.
 *
 * Las llamadas a Supabase se mockean con vi.mock para no necesitar BD real.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';

// --- Mock de @/lib/supabase/service-role -----------------------------------
const mockUpdate = vi.fn().mockResolvedValue({ error: null });
const mockEqUpdate = vi.fn(() => ({ eq: vi.fn(() => mockUpdate()) }));

let mockMaybeSingleResult: { data: Record<string, unknown> | null; error: null } = {
  data: null,
  error: null,
};

const mockMaybeSingle = vi.fn(() => Promise.resolve(mockMaybeSingleResult));
const mockEqEstado = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockEqHashClave = vi.fn(() => ({ eq: mockEqEstado }));
const mockSelect = vi.fn(() => ({ eq: mockEqHashClave }));
const mockFrom = vi.fn(() => ({ select: mockSelect, update: vi.fn(() => ({ eq: mockEqUpdate })) }));
const mockSchema = vi.fn(() => ({ from: mockFrom }));

vi.mock('@/lib/supabase/service-role', () => ({
  crearClienteServiceRole: () => ({ schema: mockSchema }),
}));
// ---------------------------------------------------------------------------

import { autenticarApiKey } from './autenticar-api-key';
import { verificarPermiso } from './verificar-permiso';
import type { ContextoApiKey } from './autenticar-api-key';

function buildRequest(authHeader?: string): Request {
  return new Request('https://example.com/api/v1/pedidos', {
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

describe('autenticarApiKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMaybeSingleResult = { data: null, error: null };
  });

  it('devuelve null si no hay header Authorization', async () => {
    const result = await autenticarApiKey(buildRequest());
    expect(result).toBeNull();
    expect(mockSchema).not.toHaveBeenCalled();
  });

  it('devuelve null si el header no empieza con "Bearer "', async () => {
    const result = await autenticarApiKey(buildRequest('Basic abc123'));
    expect(result).toBeNull();
    expect(mockSchema).not.toHaveBeenCalled();
  });

  it('devuelve null si la clave no se encuentra en BD (revocada/inexistente)', async () => {
    mockMaybeSingleResult = { data: null, error: null };
    const result = await autenticarApiKey(buildRequest('Bearer ak_abc123'));
    expect(result).toBeNull();
  });

  it('devuelve el contexto correcto cuando la clave es válida', async () => {
    const fakeClave = 'ak_' + 'a'.repeat(64);
    const expectedHash = crypto.createHash('sha256').update(fakeClave).digest('hex');

    mockMaybeSingleResult = {
      data: {
        id: 'key-uuid',
        tenant_id: 'tenant-uuid',
        permisos: ['pedidos:leer', 'liquidaciones:leer'],
      },
      error: null,
    };

    const result = await autenticarApiKey(buildRequest(`Bearer ${fakeClave}`));

    expect(result).not.toBeNull();
    expect(result!.tenantId).toBe('tenant-uuid');
    expect(result!.apiKeyId).toBe('key-uuid');
    expect(result!.permisos).toEqual(['pedidos:leer', 'liquidaciones:leer']);

    // Verificar que se buscó por el hash correcto.
    expect(mockEqHashClave).toHaveBeenCalledWith('hash_clave', expectedHash);
    // Verificar que se filtró por estado 'activa'.
    expect(mockEqEstado).toHaveBeenCalledWith('estado', 'activa');
  });

  it('no loguea la clave en claro (control: mockSchema no recibe la clave)', async () => {
    const fakeClave = 'ak_supersecreta';
    mockMaybeSingleResult = {
      data: { id: 'kid', tenant_id: 'tid', permisos: [] },
      error: null,
    };

    await autenticarApiKey(buildRequest(`Bearer ${fakeClave}`));

    // La clave NO debe aparecer en ningún argumento de mockEqHashClave.
    const callArgs = JSON.stringify(mockEqHashClave.mock.calls);
    expect(callArgs).not.toContain(fakeClave);
  });
});

describe('verificarPermiso', () => {
  const ctx: ContextoApiKey = {
    tenantId: 'tenant-uuid',
    apiKeyId: 'key-uuid',
    permisos: ['pedidos:leer', 'liquidaciones:leer'],
  };

  it('devuelve true para un permiso que está en la lista', () => {
    expect(verificarPermiso(ctx, 'pedidos:leer')).toBe(true);
    expect(verificarPermiso(ctx, 'liquidaciones:leer')).toBe(true);
  });

  it('devuelve false para un permiso que no está en la lista', () => {
    expect(verificarPermiso(ctx, 'webhooks:gestionar')).toBe(false);
    expect(verificarPermiso(ctx, 'desconocido:accion')).toBe(false);
  });

  it('devuelve false para contexto sin permisos', () => {
    const ctxVacio: ContextoApiKey = { ...ctx, permisos: [] };
    expect(verificarPermiso(ctxVacio, 'pedidos:leer')).toBe(false);
  });
});
