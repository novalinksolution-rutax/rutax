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

/**
 * Mock del cliente enrutado POR TABLA. `obtenerPanelCouriers` dispara ahora tres
 * consultas distintas contra el mismo cliente (periodos_suscripcion,
 * areas_habilitadas y tenants), así que un `q` único que devuelve lo mismo para
 * todas ya no sirve: cada `from(tabla)` resuelve a su propia respuesta.
 *
 * `respuestas` mapea nombre de tabla → `{data, error}`. Lo que no esté mapeado
 * resuelve a `{data: [], error: null}`.
 */
function crearMockSupabase(respuestas: Record<string, { data: unknown; error: unknown }>) {
  const llamadas: Array<{ tabla: string; metodo: string; args: unknown[] }> = [];

  function cadena(tabla: string) {
    const respuesta = respuestas[tabla] ?? { data: [], error: null };
    const c: Record<string, unknown> = {
      select: vi.fn((...args: unknown[]) => {
        llamadas.push({ tabla, metodo: 'select', args });
        return c;
      }),
      in: vi.fn((...args: unknown[]) => {
        llamadas.push({ tabla, metodo: 'in', args });
        return c;
      }),
      eq: vi.fn((...args: unknown[]) => {
        llamadas.push({ tabla, metodo: 'eq', args });
        return c;
      }),
      order: vi.fn((...args: unknown[]) => {
        llamadas.push({ tabla, metodo: 'order', args });
        return c;
      }),
      then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
        Promise.resolve(respuesta).then(resolve, reject),
    };
    return c;
  }

  const q: Record<string, unknown> = {
    schema: vi.fn(() => q),
    from: vi.fn((tabla: string) => cadena(tabla)),
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

  it('sin suscripciones: couriers vacío y NO dispara la query de morosidad, pero sí lista los invitados', async () => {
    vi.mocked(obtenerTodasSuscripciones).mockResolvedValue([]);
    vi.mocked(obtenerSaludJobs).mockResolvedValue(SALUD_JOBS_VACIA);
    vi.mocked(obtenerBacklogSistema).mockResolvedValue(BACKLOG_VACIO);

    // El primer courier de Rutax: invitado por correo, sin suscripción y sin
    // haber completado su puesta en marcha (razón social/rut en null).
    const { q, llamadas } = crearMockSupabase({
      tenants: {
        data: [
          // Recién invitado, sin puesta en marcha: falta razón social/rut.
          { id: 'tenant-nuevo', nombre_fantasia: 'Courier de dueno@x.cl', razon_social: null, rut: null },
          // Ya completó sus datos; solo le falta que Rutax le ponga plan.
          { id: 'tenant-listo', nombre_fantasia: 'Courier Listo', razon_social: 'Listo SpA', rut: '76543210-3' },
        ],
        error: null,
      },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(q as unknown as ReturnType<typeof crearClienteServiceRole>);

    const resultado = await obtenerPanelCouriers();

    expect(resultado.couriers).toEqual([]);
    expect(resultado.saludSistema).toEqual({ jobs: [], backlog: BACKLOG_VACIO });
    // Los dos lados del flag: sin datos → pendiente; con datos → solo falta plan.
    expect(resultado.couriersSinSuscripcion).toEqual([
      { tenantId: 'tenant-nuevo', nombreFantasia: 'Courier de dueno@x.cl', datosPendientes: true },
      { tenantId: 'tenant-listo', nombreFantasia: 'Courier Listo', datosPendientes: false },
    ]);
    // Sin suscripciones no se consulta morosidad (no hay a quién contársela).
    expect(llamadas.some((l) => l.tabla === 'periodos_suscripcion')).toBe(false);
  });

  it('con suscripciones: arma un item por courier con su morosidad derivada del conteo agrupado', async () => {
    vi.mocked(obtenerTodasSuscripciones).mockResolvedValue([
      suscripcion({ tenantId: 'tenant-a', estado: 'activa', nombreFantasiaTenant: 'Courier A' }),
      suscripcion({ tenantId: 'tenant-b', estado: 'trial', nombreFantasiaTenant: 'Courier B', id: 'susc-2' }),
    ]);
    vi.mocked(obtenerSaludJobs).mockResolvedValue(SALUD_JOBS_VACIA);
    vi.mocked(obtenerBacklogSistema).mockResolvedValue(BACKLOG_VACIO);

    const { q, llamadas } = crearMockSupabase({
      periodos_suscripcion: {
        data: [{ tenant_id: 'tenant-a' }, { tenant_id: 'tenant-a' }], // 2 períodos vencidos de tenant-a
        error: null,
      },
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
    expect(llamadas).toContainEqual({
      tabla: 'periodos_suscripcion',
      metodo: 'in',
      args: ['tenant_id', ['tenant-a', 'tenant-b']],
    });
    expect(llamadas).toContainEqual({
      tabla: 'periodos_suscripcion',
      metodo: 'eq',
      args: ['estado', 'vencido'],
    });

    // Compone la salud del sistema tal cual la devuelven las funciones de salud.ts (sin reimplementar).
    expect(resultado.saludSistema).toEqual({ jobs: [], backlog: BACKLOG_VACIO });
    expect(obtenerSaludJobs).toHaveBeenCalledTimes(1);
    expect(obtenerBacklogSistema).toHaveBeenCalledTimes(1);
  });

  it('error al derivar morosidad → lanza', async () => {
    vi.mocked(obtenerTodasSuscripciones).mockResolvedValue([suscripcion()]);
    vi.mocked(obtenerSaludJobs).mockResolvedValue(SALUD_JOBS_VACIA);
    vi.mocked(obtenerBacklogSistema).mockResolvedValue(BACKLOG_VACIO);

    const { q } = crearMockSupabase({ periodos_suscripcion: { data: null, error: { message: 'boom' } } });
    vi.mocked(crearClienteServiceRole).mockReturnValue(q as unknown as ReturnType<typeof crearClienteServiceRole>);

    await expect(obtenerPanelCouriers()).rejects.toThrow(/error al derivar morosidad/i);
  });
});
