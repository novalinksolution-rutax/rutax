/**
 * Tests de RBAC y guardas de estado para las acciones B2 de corrección manual:
 * `anularLineaCobroPedido` y `anularLineaLiquidacionPedido`.
 *
 * Cubre la palanca que faltaba para corregir el dinero de un fallido que el
 * motor cargó por defecto, sin depender del `tipo` de la incidencia. Se prueba
 * la capa de RBAC (rechazo de roles sin capacidad) y las guardas de estado
 * (período cerrado / liquidación emitida → no se anula).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorValidacion } from '@/modules/identidad/errores';
import type { UsuarioActual } from '@/modules/identidad/usuario-actual';

vi.mock('@/lib/supabase/service-role', () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock('@/modules/identidad/auditoria', () => ({
  registrarEnBitacora: vi.fn().mockResolvedValue(undefined),
}));

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { anularLineaCobroPedido, anularLineaLiquidacionPedido } from './acciones';

function usuario(rol: UsuarioActual['rol'], estado: UsuarioActual['estado'] = 'activo'): UsuarioActual {
  return {
    tenantId: 'tenant-a',
    tipoUsuario: rol === 'seller' ? 'seller' : rol === 'conductor' ? 'conductor' : 'interno',
    sellerId: rol === 'seller' ? 'seller-a' : null,
    driverId: rol === 'conductor' ? 'driver-a' : null,
    rol,
    estado,
  };
}

/**
 * Mock encadenable que resuelve `maybeSingle()` con valores en secuencia
 * (primera llamada: la línea; segunda: el período/liquidación) y un `update`
 * encadenable que resuelve sin error.
 */
function mockSupabaseSecuencia(valores: Array<{ data: unknown; error: unknown }>) {
  let i = 0;
  const q: Record<string, unknown> = {
    schema: vi.fn(() => q),
    from: vi.fn(() => q),
    select: vi.fn(() => q),
    eq: vi.fn(() => q),
    update: vi.fn(() => q),
    maybeSingle: vi.fn(() => Promise.resolve(valores[i++] ?? { data: null, error: null })),
  };
  return q;
}

describe('anularLineaCobroPedido — RBAC', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(['supervisor', 'coordinador', 'seller', 'conductor'] as const)(
    'rechaza al rol %s (sin capacidad ver_conciliacion)',
    async (rol) => {
      await expect(
        anularLineaCobroPedido('tenant-a', 'pedido-1', 'no corresponde', usuario(rol), 'u-1'),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    },
  );

  it('rechaza a administracion suspendida (fail-closed)', async () => {
    await expect(
      anularLineaCobroPedido('tenant-a', 'pedido-1', 'x', usuario('administracion', 'suspendido'), 'u-1'),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('exige motivo no vacío para dueño', async () => {
    await expect(
      anularLineaCobroPedido('tenant-a', 'pedido-1', '   ', usuario('dueno'), 'u-1'),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('no anula si el período ya está cerrado (usar nota de crédito)', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      mockSupabaseSecuencia([
        { data: { id: 'lc-1', anulada: false, periodo_cobro_id: 'per-1', monto_final_clp: 1000 }, error: null },
        { data: { estado: 'facturado' }, error: null },
      ]) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );
    await expect(
      anularLineaCobroPedido('tenant-a', 'pedido-1', 'no corresponde', usuario('administracion'), 'u-1'),
    ).rejects.toThrow(/nota de crédito|facturado/i);
  });

  it('dueño anula una línea de un período abierto (camino feliz)', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      mockSupabaseSecuencia([
        { data: { id: 'lc-1', anulada: false, periodo_cobro_id: 'per-1', monto_final_clp: 1000 }, error: null },
        { data: { estado: 'abierto' }, error: null },
      ]) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );
    await expect(
      anularLineaCobroPedido('tenant-a', 'pedido-1', 'no corresponde', usuario('dueno'), 'u-1'),
    ).resolves.toBeUndefined();
  });
});

describe('anularLineaLiquidacionPedido — RBAC', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(['supervisor', 'coordinador', 'seller', 'conductor'] as const)(
    'rechaza al rol %s (sin capacidad gestionar_liquidaciones_conductores)',
    async (rol) => {
      await expect(
        anularLineaLiquidacionPedido('tenant-a', 'pedido-1', 'no corresponde', usuario(rol), 'u-1'),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    },
  );

  it('no anula si la liquidación no está en borrador', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      mockSupabaseSecuencia([
        { data: { id: 'll-1', anulada: false, liquidacion_id: 'liq-1', monto_final_clp: 800 }, error: null },
        { data: { estado: 'emitida' }, error: null },
      ]) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );
    await expect(
      anularLineaLiquidacionPedido('tenant-a', 'pedido-1', 'x', usuario('administracion'), 'u-1'),
    ).rejects.toThrow(/borrador|emitida/i);
  });

  it('administración anula una línea de liquidación en borrador (camino feliz)', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      mockSupabaseSecuencia([
        { data: { id: 'll-1', anulada: false, liquidacion_id: 'liq-1', monto_final_clp: 800 }, error: null },
        { data: { estado: 'borrador' }, error: null },
      ]) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );
    await expect(
      anularLineaLiquidacionPedido('tenant-a', 'pedido-1', 'no corresponde', usuario('administracion'), 'u-1'),
    ).resolves.toBeUndefined();
  });
});
