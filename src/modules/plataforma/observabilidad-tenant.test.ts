/**
 * Tests de `obtenerObservabilidadTenant` (gap 9 — drill-down por-tenant del
 * backstage). Cubre:
 * - Composición: reusa `obtenerSuscripcionPorTenant` (consultas.ts),
 *   `obtenerResumenSaludMlPorTenant` (integraciones/ml) y `derivarSaludCourier`
 *   (panel-couriers.ts) SIN reimplementarlas.
 * - Backlog operativo: pedidos pendientes (fuera de `ESTADOS_TERMINALES_PEDIDO`)
 *   e incidencias sin gestión (`abierta`/`en_gestion`), acotados por tenant.
 * - Alertas recientes: filtra `bitacora_auditoria` por tenant + la lista curada
 *   de `accion`, ordenada desc, limitada.
 * - Camino sin suscripción: `suscripcion: null`, NO dispara la query de
 *   morosidad, resuelve el nombre del tenant por separado.
 * - Camino con suscripción: morosidad + semáforo derivado con la MISMA función
 *   pura que el panel multi-courier.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/service-role', () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock('./consultas', () => ({
  obtenerSuscripcionPorTenant: vi.fn(),
}));

vi.mock('@/modules/integraciones/ml', () => ({
  obtenerResumenSaludMlPorTenant: vi.fn(),
}));

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { obtenerSuscripcionPorTenant } from './consultas';
import { obtenerResumenSaludMlPorTenant } from '@/modules/integraciones/ml';
import { obtenerObservabilidadTenant } from './observabilidad-tenant';
import type { SuscripcionConPlan } from './tipos';
import type { ResumenSaludMlTenant } from '@/modules/integraciones/ml';

const TENANT_A = 'tenant-a';

function suscripcion(overrides: Partial<SuscripcionConPlan> = {}): SuscripcionConPlan {
  return {
    id: 'susc-1',
    tenantId: TENANT_A,
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

const CONEXIONES_ML_VACIA: ResumenSaludMlTenant = {
  sanas: 0,
  atencion: 0,
  desvinculadas: 0,
  pendientes: 0,
  total: 0,
};

/**
 * Cliente falso multi-tabla: enruta por nombre de tabla, filtra `filas` por
 * los `.eq()`/`.in()`/`.not()` encadenados y resuelve al `await` (thenable),
 * igual patrón que `operacion/metricas.test.ts`. `.maybeSingle()` toma la
 * primera fila filtrada. `erroresPorTabla` fuerza que CUALQUIER resolución
 * sobre esa tabla devuelva `{ data: null, error: {message} }` (para probar
 * propagación de errores sin un mock ad-hoc por caso).
 */
function crearClienteMultiTabla(
  tablas: Record<string, Array<Record<string, unknown>>>,
  erroresPorTabla: Record<string, string> = {},
) {
  const llamadas: Record<string, Array<{ metodo: string; args: unknown[] }>> = {};

  function fromImpl(tabla: string) {
    const filas = tablas[tabla] ?? [];
    const errorForzado = erroresPorTabla[tabla];

    return {
      select: (_cols: string, opts?: { count?: 'exact'; head?: boolean }) => {
        const filtros: Array<(f: Record<string, unknown>) => boolean> = [];
        const registrar = (metodo: string, args: unknown[]) => {
          llamadas[tabla] = llamadas[tabla] ?? [];
          llamadas[tabla]!.push({ metodo, args });
        };

        const chain: Record<string, unknown> = {
          eq: (campo: string, valor: unknown) => {
            registrar('eq', [campo, valor]);
            filtros.push((f) => f[campo] === valor);
            return chain;
          },
          in: (campo: string, valores: unknown[]) => {
            registrar('in', [campo, valores]);
            filtros.push((f) => valores.includes(f[campo]));
            return chain;
          },
          not: (campo: string, _op: string, valor: string) => {
            registrar('not', [campo, _op, valor]);
            const lista = valor.replace(/^\(|\)$/g, '').split(',');
            filtros.push((f) => !lista.includes(String(f[campo])));
            return chain;
          },
          order: (...args: unknown[]) => {
            registrar('order', args);
            return chain;
          },
          limit: (...args: unknown[]) => {
            registrar('limit', args);
            return chain;
          },
          maybeSingle: () => {
            if (errorForzado) return Promise.resolve({ data: null, error: { message: errorForzado } });
            const filtradas = filas.filter((f) => filtros.every((fn) => fn(f)));
            return Promise.resolve({ data: filtradas[0] ?? null, error: null });
          },
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
            if (errorForzado) {
              return Promise.resolve({ data: null, count: null, error: { message: errorForzado } }).then(
                resolve,
                reject,
              );
            }
            const filtradas = filas.filter((f) => filtros.every((fn) => fn(f)));
            const respuesta = opts?.head
              ? { data: null, count: filtradas.length, error: null }
              : { data: filtradas, count: filtradas.length, error: null };
            return Promise.resolve(respuesta).then(resolve, reject);
          },
        };
        return chain;
      },
    };
  }

  const cliente = {
    schema: vi.fn(() => ({ from: fromImpl })),
    from: fromImpl,
  };

  return { cliente, llamadas };
}

describe('obtenerObservabilidadTenant', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sin suscripción: suscripcion=null, NO dispara la query de morosidad, resuelve el nombre por separado', async () => {
    vi.mocked(obtenerSuscripcionPorTenant).mockResolvedValue(null);
    vi.mocked(obtenerResumenSaludMlPorTenant).mockResolvedValue(CONEXIONES_ML_VACIA);

    const { cliente, llamadas } = crearClienteMultiTabla({
      pedidos: [],
      incidencias: [],
      bitacora_auditoria: [],
      tenants: [{ id: TENANT_A, nombre_fantasia: 'Courier Sin Plan' }],
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const resultado = await obtenerObservabilidadTenant(TENANT_A);

    expect(resultado.suscripcion).toBeNull();
    expect(resultado.nombreFantasia).toBe('Courier Sin Plan');
    expect(llamadas.periodos_suscripcion).toBeUndefined();
    expect(resultado.conexionesMl).toEqual(CONEXIONES_ML_VACIA);
    expect(resultado.backlogOperativo).toEqual({ pedidosPendientes: 0, incidenciasSinGestion: 0 });
    expect(resultado.alertasRecientes).toEqual([]);
  });

  it('con suscripción: cuenta morosidad y deriva el semáforo con la misma función pura del panel multi-courier', async () => {
    vi.mocked(obtenerSuscripcionPorTenant).mockResolvedValue(
      suscripcion({ estado: 'activa', nombreFantasiaTenant: 'Despachos del Centro' }),
    );
    vi.mocked(obtenerResumenSaludMlPorTenant).mockResolvedValue({
      sanas: 2,
      atencion: 1,
      desvinculadas: 1,
      pendientes: 0,
      total: 4,
    });

    const { cliente } = crearClienteMultiTabla({
      pedidos: [],
      incidencias: [],
      bitacora_auditoria: [],
      periodos_suscripcion: [
        { id: 'p1', tenant_id: TENANT_A, estado: 'vencido' },
        { id: 'p2', tenant_id: TENANT_A, estado: 'vencido' },
        { id: 'p3', tenant_id: TENANT_A, estado: 'pagado' },
        { id: 'p4', tenant_id: 'otro-tenant', estado: 'vencido' },
      ],
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const resultado = await obtenerObservabilidadTenant(TENANT_A);

    expect(resultado.nombreFantasia).toBe('Despachos del Centro');
    expect(resultado.suscripcion).toMatchObject({
      suscripcionId: 'susc-1',
      estado: 'activa',
      planNombre: 'Starter',
      periodicidad: 'mensual',
      periodosVencidos: 2,
      salud: 'rojo', // morosidad → rojo, mismo criterio que derivarSaludCourier
    });
    expect(resultado.conexionesMl.total).toBe(4);
  });

  it('backlog operativo: cuenta pedidos fuera de ESTADOS_TERMINALES_PEDIDO e incidencias abierta/en_gestion del tenant', async () => {
    vi.mocked(obtenerSuscripcionPorTenant).mockResolvedValue(null);
    vi.mocked(obtenerResumenSaludMlPorTenant).mockResolvedValue(CONEXIONES_ML_VACIA);

    const { cliente } = crearClienteMultiTabla({
      pedidos: [
        { id: 'ped-1', tenant_id: TENANT_A, estado: 'pendiente_asignacion' },
        { id: 'ped-2', tenant_id: TENANT_A, estado: 'asignado' },
        { id: 'ped-3', tenant_id: TENANT_A, estado: 'en_ruta' },
        { id: 'ped-4', tenant_id: TENANT_A, estado: 'entregado' }, // terminal, no cuenta
        { id: 'ped-5', tenant_id: TENANT_A, estado: 'cancelado' }, // terminal, no cuenta
        { id: 'ped-6', tenant_id: 'otro-tenant', estado: 'asignado' }, // otro tenant, no cuenta
      ],
      incidencias: [
        { id: 'inc-1', tenant_id: TENANT_A, estado: 'abierta' },
        { id: 'inc-2', tenant_id: TENANT_A, estado: 'en_gestion' },
        { id: 'inc-3', tenant_id: TENANT_A, estado: 'resuelta' }, // no cuenta
        { id: 'inc-4', tenant_id: 'otro-tenant', estado: 'abierta' }, // otro tenant, no cuenta
      ],
      bitacora_auditoria: [],
      tenants: [{ id: TENANT_A, nombre_fantasia: null }],
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const resultado = await obtenerObservabilidadTenant(TENANT_A);

    expect(resultado.backlogOperativo).toEqual({ pedidosPendientes: 3, incidenciasSinGestion: 2 });
  });

  it('alertas recientes: filtra bitácora por tenant + la lista curada de accion', async () => {
    vi.mocked(obtenerSuscripcionPorTenant).mockResolvedValue(null);
    vi.mocked(obtenerResumenSaludMlPorTenant).mockResolvedValue(CONEXIONES_ML_VACIA);

    const { cliente, llamadas } = crearClienteMultiTabla({
      pedidos: [],
      incidencias: [],
      tenants: [{ id: TENANT_A, nombre_fantasia: null }],
      bitacora_auditoria: [
        {
          id: 1,
          tenant_id: TENANT_A,
          accion: 'notificacion.conexion_caida',
          entidad_tipo: 'conexion_ml',
          entidad_id: 'cnx-1',
          creado_en: '2026-07-10T10:00:00.000Z',
        },
        {
          id: 2,
          tenant_id: TENANT_A,
          accion: 'plataforma.plan_asignado', // no está en la lista curada
          entidad_tipo: 'suscripcion',
          entidad_id: 'susc-1',
          creado_en: '2026-07-10T09:00:00.000Z',
        },
        {
          id: 3,
          tenant_id: 'otro-tenant',
          accion: 'notificacion.conexion_caida', // otro tenant, no cuenta
          entidad_tipo: 'conexion_ml',
          entidad_id: 'cnx-2',
          creado_en: '2026-07-10T11:00:00.000Z',
        },
      ],
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const resultado = await obtenerObservabilidadTenant(TENANT_A);

    expect(resultado.alertasRecientes).toEqual([
      {
        id: 1,
        creadoEn: '2026-07-10T10:00:00.000Z',
        accion: 'notificacion.conexion_caida',
        entidadTipo: 'conexion_ml',
        entidadId: 'cnx-1',
      },
    ]);

    const llamadasBitacora = llamadas.bitacora_auditoria ?? [];
    expect(llamadasBitacora).toContainEqual({ metodo: 'eq', args: ['tenant_id', TENANT_A] });
    expect(llamadasBitacora.some((l) => l.metodo === 'in' && l.args[0] === 'accion')).toBe(true);
  });

  it('reusa obtenerResumenSaludMlPorTenant del adaptador ML tal cual, sin transformarlo', async () => {
    vi.mocked(obtenerSuscripcionPorTenant).mockResolvedValue(null);
    const resumenMl: ResumenSaludMlTenant = {
      sanas: 5,
      atencion: 0,
      desvinculadas: 2,
      pendientes: 1,
      total: 8,
    };
    vi.mocked(obtenerResumenSaludMlPorTenant).mockResolvedValue(resumenMl);

    const { cliente } = crearClienteMultiTabla({
      pedidos: [],
      incidencias: [],
      bitacora_auditoria: [],
      tenants: [{ id: TENANT_A, nombre_fantasia: null }],
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const resultado = await obtenerObservabilidadTenant(TENANT_A);

    expect(resultado.conexionesMl).toEqual(resumenMl);
    expect(obtenerResumenSaludMlPorTenant).toHaveBeenCalledWith(TENANT_A);
  });

  it('propaga el error si falla el conteo de pedidos pendientes', async () => {
    vi.mocked(obtenerSuscripcionPorTenant).mockResolvedValue(null);
    vi.mocked(obtenerResumenSaludMlPorTenant).mockResolvedValue(CONEXIONES_ML_VACIA);

    const { cliente } = crearClienteMultiTabla(
      { incidencias: [], bitacora_auditoria: [], tenants: [{ id: TENANT_A, nombre_fantasia: null }] },
      { pedidos: 'boom' },
    );
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    await expect(obtenerObservabilidadTenant(TENANT_A)).rejects.toThrow(
      /error al contar pedidos pendientes/i,
    );
  });
});
