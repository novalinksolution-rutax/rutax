/**
 * Tests de `preflight-cancelacion.ts` (docs/arquitectura/edicion-y-cancelacion-
 * de-pedidos.md §7.2 / D-A3).
 *
 * Cubre:
 * - `anulacionAutomatica=true` y sin advertencias cuando no hay líneas vivas,
 *   o cuando el período está 'abierto' / la liquidación está 'borrador'.
 * - `anulacionAutomatica=false` + advertencia cuando el período NO está
 *   'abierto' (cerrado/facturado/anulado) o la liquidación NO está 'borrador'
 *   (emitida/pagada).
 * - NUNCA bloquea (D-A1): no hay ningún camino que devuelva `ok=false` o
 *   similar — el contrato ni siquiera tiene ese campo.
 * - 100% de lectura: el doble de Supabase no expone insert/update.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/service-role', () => ({
  crearClienteServiceRole: vi.fn(),
}));

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { preflightCancelacionPedido } from './preflight-cancelacion';

// =============================================================================
// Fake Supabase — mismo espíritu que preflight.test.ts: enruta por
// `${schema}.${tabla}`, soporta `.eq()` encadenado y `.maybeSingle()` terminal.
// Sin insert/update — cualquier intento de escritura falla con "no es función".
// =============================================================================

type Fila = Record<string, unknown>;
type Tablas = Record<string, Fila[]>;

function crearFakeSupabase(tablas: Tablas) {
  function construirBuilder(filas: Fila[], filtros: Array<(f: Fila) => boolean>) {
    return {
      eq(col: string, val: unknown) {
        return construirBuilder(filas, [...filtros, (f: Fila) => f[col] === val]);
      },
      maybeSingle() {
        const encontrada = filas.filter((f) => filtros.every((fn) => fn(f)))[0] ?? null;
        return Promise.resolve({ data: encontrada, error: null });
      },
    };
  }

  return {
    schema(s: string) {
      return {
        from(t: string) {
          const clave = `${s}.${t}`;
          return {
            select() {
              return construirBuilder(tablas[clave] ?? [], []);
            },
          };
        },
      };
    },
  };
}

const TENANT = 'tenant-a';
const PEDIDO_ID = 'pedido-1';
const PERIODO_ID = 'periodo-1';
const LIQUIDACION_ID = 'liq-1';

function mockearSupabase(tablas: Tablas) {
  (crearClienteServiceRole as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
    crearFakeSupabase(tablas),
  );
}

describe('preflightCancelacionPedido — sin líneas vivas', () => {
  it('anulacionAutomatica=true y sin advertencias cuando el pedido no tiene ninguna línea', async () => {
    mockearSupabase({});

    const r = await preflightCancelacionPedido({ tenantId: TENANT, pedidoId: PEDIDO_ID });

    expect(r.anulacionAutomatica).toBe(true);
    expect(r.advertencias).toHaveLength(0);
  });

  it('anulacionAutomatica=true cuando las líneas existentes ya están anuladas', async () => {
    mockearSupabase({
      'dinero.lineas_cobro': [
        { id: 'lc-1', pedido_id: PEDIDO_ID, tenant_id: TENANT, anulada: true, periodo_cobro_id: PERIODO_ID },
      ],
      'dinero.lineas_liquidacion': [
        { id: 'll-1', pedido_id: PEDIDO_ID, tenant_id: TENANT, anulada: true, liquidacion_id: LIQUIDACION_ID },
      ],
    });

    const r = await preflightCancelacionPedido({ tenantId: TENANT, pedidoId: PEDIDO_ID });

    expect(r.anulacionAutomatica).toBe(true);
    expect(r.advertencias).toHaveLength(0);
  });
});

describe('preflightCancelacionPedido — línea de cobro viva', () => {
  it('anulacionAutomatica=true, sin período asignado (se anula libremente)', async () => {
    mockearSupabase({
      'dinero.lineas_cobro': [
        { id: 'lc-1', pedido_id: PEDIDO_ID, tenant_id: TENANT, anulada: false, periodo_cobro_id: null },
      ],
    });

    const r = await preflightCancelacionPedido({ tenantId: TENANT, pedidoId: PEDIDO_ID });

    expect(r.anulacionAutomatica).toBe(true);
    expect(r.advertencias).toHaveLength(0);
  });

  it("anulacionAutomatica=true con período 'abierto'", async () => {
    mockearSupabase({
      'dinero.lineas_cobro': [
        { id: 'lc-1', pedido_id: PEDIDO_ID, tenant_id: TENANT, anulada: false, periodo_cobro_id: PERIODO_ID },
      ],
      'dinero.periodos_cobro': [{ id: PERIODO_ID, tenant_id: TENANT, estado: 'abierto' }],
    });

    const r = await preflightCancelacionPedido({ tenantId: TENANT, pedidoId: PEDIDO_ID });

    expect(r.anulacionAutomatica).toBe(true);
    expect(r.advertencias).toHaveLength(0);
  });

  it.each(['cerrado', 'facturado', 'anulado'])(
    "anulacionAutomatica=false + advertencia 'linea_cobro_no_anulable' cuando el período está '%s'",
    async (estadoPeriodo) => {
      mockearSupabase({
        'dinero.lineas_cobro': [
          { id: 'lc-1', pedido_id: PEDIDO_ID, tenant_id: TENANT, anulada: false, periodo_cobro_id: PERIODO_ID },
        ],
        'dinero.periodos_cobro': [{ id: PERIODO_ID, tenant_id: TENANT, estado: estadoPeriodo }],
      });

      const r = await preflightCancelacionPedido({ tenantId: TENANT, pedidoId: PEDIDO_ID });

      expect(r.anulacionAutomatica).toBe(false);
      const item = r.advertencias.find((a) => a.codigo === 'linea_cobro_no_anulable');
      expect(item).toBeDefined();
      // NUNCA bloquea (D-A1): la categoría es 'advierte', nunca 'bloquea'.
      expect(item!.categoria).toBe('advierte');
      expect(item!.meta?.estado_periodo).toBe(estadoPeriodo);
    },
  );
});

describe('preflightCancelacionPedido — línea de liquidación viva', () => {
  it("anulacionAutomatica=true con liquidación 'borrador'", async () => {
    mockearSupabase({
      'dinero.lineas_liquidacion': [
        { id: 'll-1', pedido_id: PEDIDO_ID, tenant_id: TENANT, anulada: false, liquidacion_id: LIQUIDACION_ID },
      ],
      'dinero.liquidaciones': [{ id: LIQUIDACION_ID, tenant_id: TENANT, estado: 'borrador' }],
    });

    const r = await preflightCancelacionPedido({ tenantId: TENANT, pedidoId: PEDIDO_ID });

    expect(r.anulacionAutomatica).toBe(true);
    expect(r.advertencias).toHaveLength(0);
  });

  it.each(['emitida', 'pagada'])(
    "anulacionAutomatica=false + advertencia 'linea_liquidacion_no_anulable' cuando la liquidación está '%s'",
    async (estadoLiquidacion) => {
      mockearSupabase({
        'dinero.lineas_liquidacion': [
          { id: 'll-1', pedido_id: PEDIDO_ID, tenant_id: TENANT, anulada: false, liquidacion_id: LIQUIDACION_ID },
        ],
        'dinero.liquidaciones': [{ id: LIQUIDACION_ID, tenant_id: TENANT, estado: estadoLiquidacion }],
      });

      const r = await preflightCancelacionPedido({ tenantId: TENANT, pedidoId: PEDIDO_ID });

      expect(r.anulacionAutomatica).toBe(false);
      const item = r.advertencias.find((a) => a.codigo === 'linea_liquidacion_no_anulable');
      expect(item).toBeDefined();
      expect(item!.categoria).toBe('advierte');
      expect(item!.meta?.estado_liquidacion).toBe(estadoLiquidacion);
    },
  );
});

describe('preflightCancelacionPedido — ambas líneas vivas y no anulables a la vez', () => {
  it('anulacionAutomatica=false y devuelve LAS DOS advertencias', async () => {
    mockearSupabase({
      'dinero.lineas_cobro': [
        { id: 'lc-1', pedido_id: PEDIDO_ID, tenant_id: TENANT, anulada: false, periodo_cobro_id: PERIODO_ID },
      ],
      'dinero.periodos_cobro': [{ id: PERIODO_ID, tenant_id: TENANT, estado: 'facturado' }],
      'dinero.lineas_liquidacion': [
        { id: 'll-1', pedido_id: PEDIDO_ID, tenant_id: TENANT, anulada: false, liquidacion_id: LIQUIDACION_ID },
      ],
      'dinero.liquidaciones': [{ id: LIQUIDACION_ID, tenant_id: TENANT, estado: 'pagada' }],
    });

    const r = await preflightCancelacionPedido({ tenantId: TENANT, pedidoId: PEDIDO_ID });

    expect(r.anulacionAutomatica).toBe(false);
    expect(r.advertencias.map((a) => a.codigo).sort()).toEqual(
      ['linea_cobro_no_anulable', 'linea_liquidacion_no_anulable'].sort(),
    );
  });
});
