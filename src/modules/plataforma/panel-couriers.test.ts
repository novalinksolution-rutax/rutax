/**
 * Tests de `obtenerPanelCouriers` (gap 1 — panel de couriers, solo datos).
 * Cubre:
 * - `derivarSaludCourier` (función pura): reglas del semáforo.
 * - Composición: reusa `obtenerTodasSuscripciones` (consultas.ts) y
 *   `obtenerSaludJobs`/`obtenerBacklogSistema` (salud.ts) SIN reimplementarlas
 *   (se verifica que se llaman, no se duplica su lógica).
 * - Morosidad derivada barata: cuenta períodos 'vencido' por tenant en una
 *   sola query agrupada.
 * - Camino vacío: sin suscripciones, no dispara la query de morosidad.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/service-role', () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock('./consultas', () => ({
  obtenerTodasSuscripciones: vi.fn(),
}));

vi.mock('./salud', () => ({
  obtenerSaludJobs: vi.fn(),
  obtenerBacklogSistema: vi.fn(),
}));

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { obtenerTodasSuscripciones } from './consultas';
import { obtenerSaludJobs, obtenerBacklogSistema } from './salud';
import { obtenerPanelCouriers, derivarSaludCourier } from './panel-couriers';
import type { SuscripcionConPlan } from './tipos';

function suscripcion(overrides: Partial<SuscripcionConPlan> = {}): SuscripcionConPlan {
  return {
    id: 'susc-1',
    tenantId: 'tenant-a',
    planId: 'plan-starter',
    estado: 'activa',
    trialHasta: null,
    activaDesde: '2026-01-01',
    canceladaEn: null,
    notas: null,
    periodicidad: 'mensual',
    autoCobroHabilitado: false,
    mandatoEstado: 'sin_mandato',
    mandatoRef: null,
    planAnteriorId: null,
    cambioEfectivoDesde: null,
    caracteristicasOverride: {},
    creadaEn: '2026-01-01T00:00:00.000Z',
    actualizadoEn: '2026-01-01T00:00:00.000Z',
    plan: {
      id: 'plan-starter',
      nombre: 'Starter',
      descripcion: null,
      precioPorPedidoClp: 40,
      minimoMensualClp: null,
      precioMensualClp: 19990,
      precioAnualClp: 199900,
      limitePedidosMes: 500,
      caracteristicas: {},
      activo: true,
    },
    nombreFantasiaTenant: 'Despachos del Centro',
    ...overrides,
  };
}

function crearMockSupabaseMorosidad(respuesta: { data: unknown; error: unknown }) {
  const llamadas: Array<{ metodo: string; args: unknown[] }> = [];
  const q: Record<string, unknown> = {
    schema: vi.fn(() => q),
    from: vi.fn(() => q),
    select: vi.fn((...args: unknown[]) => {
      llamadas.push({ metodo: 'select', args });
      return q;
    }),
    in: vi.fn((...args: unknown[]) => {
      llamadas.push({ metodo: 'in', args });
      return q;
    }),
    eq: vi.fn((...args: unknown[]) => {
      llamadas.push({ metodo: 'eq', args });
      return q;
    }),
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(respuesta).then(resolve, reject),
  };
  return { q, llamadas };
}

const SALUD_JOBS_VACIA: Awaited<ReturnType<typeof obtenerSaludJobs>> = [];
const BACKLOG_VACIO: Awaited<ReturnType<typeof obtenerBacklogSistema>> = {
  periodosAbiertosVencidos: 0,
  conciliacionesPendientes: 0,
  conciliacionesVencidas: 0,
  lineasHuerfanasPendientes: 0,
};

describe('derivarSaludCourier — regla pura', () => {
  it('suspendida → rojo', () => {
    expect(derivarSaludCourier('suspendida', 0)).toBe('rojo');
  });

  it('cancelada → rojo', () => {
    expect(derivarSaludCourier('cancelada', 0)).toBe('rojo');
  });

  it('con períodos vencidos (morosidad) → rojo, aunque la suscripción esté activa', () => {
    expect(derivarSaludCourier('activa', 1)).toBe('rojo');
  });

  it('trial sin morosidad → amarillo', () => {
    expect(derivarSaludCourier('trial', 0)).toBe('amarillo');
  });

  it('activa sin morosidad → verde', () => {
    expect(derivarSaludCourier('activa', 0)).toBe('verde');
  });
});

describe('obtenerPanelCouriers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sin suscripciones: couriers vacío, NO dispara la query de morosidad, igual compone la salud del sistema', async () => {
    vi.mocked(obtenerTodasSuscripciones).mockResolvedValue([]);
    vi.mocked(obtenerSaludJobs).mockResolvedValue(SALUD_JOBS_VACIA);
    vi.mocked(obtenerBacklogSistema).mockResolvedValue(BACKLOG_VACIO);

    const resultado = await obtenerPanelCouriers();

    expect(resultado).toEqual({ couriers: [], saludSistema: { jobs: [], backlog: BACKLOG_VACIO } });
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });

  it('con suscripciones: arma un item por courier con su morosidad derivada del conteo agrupado', async () => {
    vi.mocked(obtenerTodasSuscripciones).mockResolvedValue([
      suscripcion({ tenantId: 'tenant-a', estado: 'activa', nombreFantasiaTenant: 'Courier A' }),
      suscripcion({ tenantId: 'tenant-b', estado: 'trial', nombreFantasiaTenant: 'Courier B', id: 'susc-2' }),
    ]);
    vi.mocked(obtenerSaludJobs).mockResolvedValue(SALUD_JOBS_VACIA);
    vi.mocked(obtenerBacklogSistema).mockResolvedValue(BACKLOG_VACIO);

    const { q, llamadas } = crearMockSupabaseMorosidad({
      data: [{ tenant_id: 'tenant-a' }, { tenant_id: 'tenant-a' }], // 2 períodos vencidos de tenant-a
      error: null,
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(q as unknown as ReturnType<typeof crearClienteServiceRole>);

    const resultado = await obtenerPanelCouriers();

    expect(resultado.couriers).toHaveLength(2);

    const courierA = resultado.couriers.find((c) => c.tenantId === 'tenant-a')!;
    expect(courierA).toMatchObject({
      nombreFantasia: 'Courier A',
      estadoSuscripcion: 'activa',
      planNombre: 'Starter',
      periodicidad: 'mensual',
      periodosVencidos: 2,
      salud: 'rojo', // morosidad → rojo aunque esté 'activa'
    });

    const courierB = resultado.couriers.find((c) => c.tenantId === 'tenant-b')!;
    expect(courierB).toMatchObject({
      nombreFantasia: 'Courier B',
      estadoSuscripcion: 'trial',
      periodosVencidos: 0,
      salud: 'amarillo',
    });

    // La query de morosidad se acota a los tenants de las suscripciones y al estado 'vencido'.
    expect(llamadas).toContainEqual({ metodo: 'in', args: ['tenant_id', ['tenant-a', 'tenant-b']] });
    expect(llamadas).toContainEqual({ metodo: 'eq', args: ['estado', 'vencido'] });

    // Compone la salud del sistema tal cual la devuelven las funciones de salud.ts (sin reimplementar).
    expect(resultado.saludSistema).toEqual({ jobs: [], backlog: BACKLOG_VACIO });
    expect(obtenerSaludJobs).toHaveBeenCalledTimes(1);
    expect(obtenerBacklogSistema).toHaveBeenCalledTimes(1);
  });

  it('error al derivar morosidad → lanza', async () => {
    vi.mocked(obtenerTodasSuscripciones).mockResolvedValue([suscripcion()]);
    vi.mocked(obtenerSaludJobs).mockResolvedValue(SALUD_JOBS_VACIA);
    vi.mocked(obtenerBacklogSistema).mockResolvedValue(BACKLOG_VACIO);

    const { q } = crearMockSupabaseMorosidad({ data: null, error: { message: 'boom' } });
    vi.mocked(crearClienteServiceRole).mockReturnValue(q as unknown as ReturnType<typeof crearClienteServiceRole>);

    await expect(obtenerPanelCouriers()).rejects.toThrow(/error al derivar morosidad/i);
  });
});
