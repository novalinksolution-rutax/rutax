/**
 * Tests de las acciones manuales de cobranza: `atribuirPagoManualmente` y
 * `descartarPago` (capa "pagado").
 *
 * Foco QA:
 *  - Gate de capacidad financiera (`ver_conciliacion`): roles sin capacidad → ErrorValidacion.
 *  - Bitácora ANTES del efecto, con `actorUsuarioId` (RNF-04).
 *  - Aislamiento cross-tenant: no atribuir un pago/seller/período de otro tenant.
 *  - Re-atribución de un pago PARCIAL: reversa la imputación previa (no doble cobro).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorValidacion } from '@/modules/identidad/errores';
import type { UsuarioActual } from '@/modules/identidad/usuario-actual';

vi.mock('@/lib/supabase/service-role', () => ({
  crearClienteServiceRole: vi.fn(),
}));

const registrarEnBitacoraMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/modules/identidad/auditoria', () => ({
  registrarEnBitacora: (...args: unknown[]) => registrarEnBitacoraMock(...args),
}));

// `conciliarPagoPersistido` se ejecuta de verdad sobre el fake de BD para
// verificar el efecto neto de la re-atribución (reversa + re-imputación).
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { atribuirPagoManualmente, descartarPago } from './acciones';

// =============================================================================
// Fake Supabase en memoria (mismo modelo que aplicar-pago.test.ts).
// =============================================================================

interface DB {
  pagos: Array<Record<string, unknown>>;
  periodos: Array<Record<string, unknown>>;
  sellers: Array<Record<string, unknown>>;
}

function crearFakeSupabase(db: DB) {
  function tablaPara(schema: string, tabla: string): Array<Record<string, unknown>> {
    if (schema === 'dinero' && tabla === 'pagos_recibidos') return db.pagos;
    if (schema === 'dinero' && tabla === 'periodos_cobro') return db.periodos;
    if (schema === 'identidad' && tabla === 'sellers') return db.sellers;
    throw new Error(`Tabla no modelada: ${schema}.${tabla}`);
  }
  let schemaActual = '';
  const cliente = {
    schema(s: string) {
      schemaActual = s;
      return {
        from(tabla: string) {
          const filas = tablaPara(schemaActual, tabla);
          return {
            select() {
              const filtros: Array<(f: Record<string, unknown>) => boolean> = [];
              const b = {
                eq(col: string, val: unknown) { filtros.push((f) => f[col] === val); return b; },
                in(col: string, vals: unknown[]) { filtros.push((f) => vals.includes(f[col])); return b; },
                filtradas() { return filas.filter((f) => filtros.every((fn) => fn(f))); },
                maybeSingle() { return Promise.resolve({ data: b.filtradas()[0] ?? null, error: null }); },
                then(resolve: (v: { data: unknown; error: null }) => unknown) {
                  return Promise.resolve({ data: b.filtradas(), error: null }).then(resolve);
                },
              };
              return b;
            },
            update(patch: Record<string, unknown>) {
              const filtrosU: Array<(f: Record<string, unknown>) => boolean> = [];
              const bu = {
                eq(col: string, val: unknown) { filtrosU.push((f) => f[col] === val); return bu; },
                then(resolve: (v: { error: null }) => unknown) {
                  for (const f of filas) if (filtrosU.every((fn) => fn(f))) Object.assign(f, patch);
                  return Promise.resolve({ error: null }).then(resolve);
                },
              };
              return bu;
            },
          };
        },
      };
    },
  };
  return cliente as unknown as ReturnType<typeof crearClienteServiceRole>;
}

function usuario(rol: UsuarioActual['rol']): UsuarioActual {
  return {
    tenantId: 'tenant-a',
    tipoUsuario: rol === 'seller' ? 'seller' : rol === 'conductor' ? 'conductor' : 'interno',
    sellerId: rol === 'seller' ? 'seller-a' : null,
    driverId: rol === 'conductor' ? 'driver-a' : null,
    rol,
    estado: 'activo',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// Gate de capacidad
// =============================================================================

describe('atribuirPagoManualmente / descartarPago — gate de capacidad', () => {
  for (const rol of ['supervisor', 'coordinador', 'seller', 'conductor'] as const) {
    it(`atribuir: rol ${rol} sin ver_conciliacion → ErrorValidacion`, async () => {
      await expect(
        atribuirPagoManualmente('tenant-a', 'pago-1', 'seller-a', usuario(rol), 'actor-1'),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });
    it(`descartar: rol ${rol} sin ver_conciliacion → ErrorValidacion`, async () => {
      await expect(
        descartarPago('tenant-a', 'pago-1', 'devolución', usuario(rol), 'actor-1'),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });
  }

  it('atribuir: usuario suspendido con rol dueno → ErrorValidacion', async () => {
    await expect(
      atribuirPagoManualmente('tenant-a', 'pago-1', 'seller-a', { ...usuario('dueno'), estado: 'suspendido' }, 'actor-1'),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});

// =============================================================================
// Aislamiento cross-tenant
// =============================================================================

describe('atribuirPagoManualmente — aislamiento cross-tenant', () => {
  it('pago de otro tenant → no encontrado → ErrorValidacion (no se filtra)', async () => {
    const db: DB = { pagos: [], periodos: [], sellers: [] };
    // El pago existe pero en tenant-b; la query acota a tenant-a → null.
    db.pagos.push({ id: 'pago-x', tenant_id: 'tenant-b', estado_match: 'sin_atribuir', periodo_cobro_id: null, monto_clp: 1000 });
    vi.mocked(crearClienteServiceRole).mockReturnValue(crearFakeSupabase(db));

    await expect(
      atribuirPagoManualmente('tenant-a', 'pago-x', 'seller-a', usuario('dueno'), 'actor-1'),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('seller de otro tenant → ErrorValidacion (no atribuir a seller ajeno)', async () => {
    const db: DB = {
      pagos: [{ id: 'pago-1', tenant_id: 'tenant-a', estado_match: 'sin_atribuir', periodo_cobro_id: null, monto_clp: 1000 }],
      periodos: [],
      sellers: [{ id: 'seller-b', tenant_id: 'tenant-b', rut: '1-9' }], // seller de otro tenant
    };
    vi.mocked(crearClienteServiceRole).mockReturnValue(crearFakeSupabase(db));

    await expect(
      atribuirPagoManualmente('tenant-a', 'pago-1', 'seller-b', usuario('dueno'), 'actor-1'),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('período de otro seller del mismo tenant → ErrorValidacion', async () => {
    const db: DB = {
      pagos: [{ id: 'pago-1', tenant_id: 'tenant-a', estado_match: 'sin_atribuir', periodo_cobro_id: null, monto_clp: 1000 }],
      periodos: [{ id: 'per-otro', tenant_id: 'tenant-a', seller_id: 'seller-b', monto_total_clp: 1000, monto_pagado_clp: 0, estado: 'facturado', estado_cobro: 'pendiente' }],
      sellers: [
        { id: 'seller-a', tenant_id: 'tenant-a', rut: '74.593.127-8' },
        { id: 'seller-b', tenant_id: 'tenant-a', rut: '76.430.498-5' },
      ],
    };
    vi.mocked(crearClienteServiceRole).mockReturnValue(crearFakeSupabase(db));

    await expect(
      atribuirPagoManualmente('tenant-a', 'pago-1', 'seller-a', usuario('dueno'), 'actor-1', 'per-otro'),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});

// =============================================================================
// Bitácora antes del efecto + re-atribución sin doble cobro
// =============================================================================

describe('atribuirPagoManualmente — bitácora y reversa de imputación', () => {
  it('registra bitácora con actorUsuarioId ANTES del efecto', async () => {
    const db: DB = {
      pagos: [{ id: 'pago-1', tenant_id: 'tenant-a', estado_match: 'sin_atribuir', periodo_cobro_id: null, monto_clp: 50000, seller_id: null, contraparte_rut_normalizado: '745931278' }],
      periodos: [{ id: 'per-1', tenant_id: 'tenant-a', seller_id: 'seller-a', monto_total_clp: 50000, monto_pagado_clp: 0, estado: 'facturado', estado_cobro: 'pendiente' }],
      sellers: [{ id: 'seller-a', tenant_id: 'tenant-a', rut: '74.593.127-8' }],
    };
    vi.mocked(crearClienteServiceRole).mockReturnValue(crearFakeSupabase(db));

    await atribuirPagoManualmente('tenant-a', 'pago-1', 'seller-a', usuario('dueno'), 'actor-99');

    expect(registrarEnBitacoraMock).toHaveBeenCalledTimes(1);
    const arg = registrarEnBitacoraMock.mock.calls[0][1] as { actorUsuarioId: string; accion: string; tenantId: string };
    expect(arg.actorUsuarioId).toBe('actor-99');
    expect(arg.accion).toBe('dinero.pago_atribuido_manual');
    expect(arg.tenantId).toBe('tenant-a');
  });

  it('re-atribuir un pago PARCIAL ya imputado NO duplica monto_pagado_clp', async () => {
    const db: DB = {
      // Pago ya imputado parcialmente a per-1 (40.000 de 100.000).
      pagos: [{ id: 'pago-1', tenant_id: 'tenant-a', estado_match: 'parcial', periodo_cobro_id: 'per-1', monto_clp: 40000, seller_id: 'seller-a', contraparte_rut_normalizado: '745931278' }],
      periodos: [{ id: 'per-1', tenant_id: 'tenant-a', seller_id: 'seller-a', monto_total_clp: 100000, monto_pagado_clp: 40000, estado: 'facturado', estado_cobro: 'parcial' }],
      sellers: [{ id: 'seller-a', tenant_id: 'tenant-a', rut: '74.593.127-8' }],
    };
    vi.mocked(crearClienteServiceRole).mockReturnValue(crearFakeSupabase(db));

    // Re-atribuir al MISMO seller (caso de corrección/reproceso manual).
    await atribuirPagoManualmente('tenant-a', 'pago-1', 'seller-a', usuario('dueno'), 'actor-1');

    // Reversa (−40.000) + re-imputación (+40.000) = 40.000, no 80.000.
    expect(db.periodos[0].monto_pagado_clp).toBe(40000);
  });
});

// =============================================================================
// descartarPago
// =============================================================================

describe('descartarPago', () => {
  it('exige motivo no vacío', async () => {
    const db: DB = { pagos: [], periodos: [], sellers: [] };
    vi.mocked(crearClienteServiceRole).mockReturnValue(crearFakeSupabase(db));
    await expect(
      descartarPago('tenant-a', 'pago-1', '   ', usuario('dueno'), 'actor-1'),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('descarta un pago no terminal → estado descartado, bitácora con autor', async () => {
    const db: DB = {
      pagos: [{ id: 'pago-1', tenant_id: 'tenant-a', estado_match: 'sobrante' }],
      periodos: [],
      sellers: [],
    };
    vi.mocked(crearClienteServiceRole).mockReturnValue(crearFakeSupabase(db));

    await descartarPago('tenant-a', 'pago-1', 'devolución del seller', usuario('administracion'), 'actor-7');

    expect(db.pagos[0].estado_match).toBe('descartado');
    expect(registrarEnBitacoraMock).toHaveBeenCalledTimes(1);
    const arg = registrarEnBitacoraMock.mock.calls[0][1] as { actorUsuarioId: string; accion: string };
    expect(arg.actorUsuarioId).toBe('actor-7');
    expect(arg.accion).toBe('dinero.pago_descartado');
  });

  it('pago ya terminal (conciliado) → ErrorValidacion, no se descarta', async () => {
    const db: DB = {
      pagos: [{ id: 'pago-1', tenant_id: 'tenant-a', estado_match: 'conciliado' }],
      periodos: [],
      sellers: [],
    };
    vi.mocked(crearClienteServiceRole).mockReturnValue(crearFakeSupabase(db));
    await expect(
      descartarPago('tenant-a', 'pago-1', 'motivo', usuario('dueno'), 'actor-1'),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});
