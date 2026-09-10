/**
 * Tests de `consumo-agregado.ts` (agregación de telemetría de consumo,
 * backstage `/admin/consumo`). Cubre:
 * - Las funciones que envuelven las RPCs (`consumo_por_courier`,
 *   `consumo_por_conductor`, `consumo_por_proveedor`) mapean snake_case →
 *   camelCase y lanzan si la RPC devuelve error.
 * - `obtenerConsumoPorProveedor` calcula `%` dentro del free tier vigente que
 *   devuelve `consumo_precios_vigentes`.
 * - `obtenerKpisCostosConsumo`: costo total = suma por proveedor, costo por
 *   entrega = costoTotal / conteo de `entrega.cerrar`, y `null` sin entregas.
 * - `obtenerKpisUsoConsumo`: reoptimizaciones por conductor, reordenamientos y
 *   el ratio local-vs-proveedor de `ruteo.optimizar`.
 *
 * TODO se lee por RPC (`infra` no está expuesto a PostgREST): el doble solo
 * necesita enrutar `.rpc(nombre, args)` por nombre — ya no hay `.schema().from()`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/service-role', () => ({
  crearClienteServiceRole: vi.fn(),
}));

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import {
  obtenerConsumoPorCourier,
  obtenerConsumoPorConductor,
  obtenerConsumoPorProveedor,
  obtenerKpisCostosConsumo,
  obtenerKpisUsoConsumo,
} from './consumo-agregado';

/**
 * Cliente falso: `.rpc(nombre, args)` resuelve desde `respuestasRpc[nombre]` (o
 * error si `erroresRpc[nombre]` está seteado).
 */
function crearClienteFalso(opciones: {
  respuestasRpc?: Record<string, unknown[]>;
  erroresRpc?: Record<string, string>;
}) {
  const { respuestasRpc = {}, erroresRpc = {} } = opciones;
  const rpc = vi.fn((nombre: string) => {
    if (erroresRpc[nombre]) {
      return Promise.resolve({ data: null, error: { message: erroresRpc[nombre] } });
    }
    return Promise.resolve({ data: respuestasRpc[nombre] ?? [], error: null });
  });
  return { rpc };
}

const VENTANA = { desde: '2026-09-01T00:00:00.000Z', hasta: '2026-10-01T00:00:00.000Z' };

describe('consumo-agregado — envoltorios de RPC', () => {
  beforeEach(() => vi.clearAllMocks());

  it('obtenerConsumoPorCourier mapea snake_case a camelCase', async () => {
    const cliente = crearClienteFalso({
      respuestasRpc: {
        consumo_por_courier: [
          { tenant_id: 't1', eventos: 10, total_unidades: 25, total_costo_usd: 1.5 },
        ],
      },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente as never);

    const r = await obtenerConsumoPorCourier(VENTANA);
    expect(r).toEqual([{ tenantId: 't1', eventos: 10, totalUnidades: 25, totalCostoUsd: 1.5 }]);
    expect(cliente.rpc).toHaveBeenCalledWith('consumo_por_courier', {
      desde: VENTANA.desde,
      hasta: VENTANA.hasta,
    });
  });

  it('obtenerConsumoPorConductor pasa p_tenant_id y mapea', async () => {
    const cliente = crearClienteFalso({
      respuestasRpc: {
        consumo_por_conductor: [
          { usuario_id: 'u1', eventos: 3, total_unidades: 3, total_costo_usd: 0 },
        ],
      },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente as never);

    const r = await obtenerConsumoPorConductor('t1', VENTANA);
    expect(r).toEqual([{ usuarioId: 'u1', eventos: 3, totalUnidades: 3, totalCostoUsd: 0 }]);
    expect(cliente.rpc).toHaveBeenCalledWith('consumo_por_conductor', {
      p_tenant_id: 't1',
      desde: VENTANA.desde,
      hasta: VENTANA.hasta,
    });
  });

  it('obtenerConsumoPorCourier lanza si la RPC devuelve error', async () => {
    const cliente = crearClienteFalso({ erroresRpc: { consumo_por_courier: 'boom' } });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente as never);
    await expect(obtenerConsumoPorCourier(VENTANA)).rejects.toThrow(/consumo_por_courier/i);
  });

  it('obtenerConsumoPorProveedor calcula % dentro del free tier vigente', async () => {
    const cliente = crearClienteFalso({
      respuestasRpc: {
        consumo_por_proveedor: [
          {
            proveedor_costo: 'google_route_optimization',
            sku: 'single_vehicle',
            eventos: 5,
            total_unidades: 2500,
            total_costo_usd: 25,
          },
          { proveedor_costo: null, sku: null, eventos: 2, total_unidades: 0, total_costo_usd: 0 },
        ],
        // La RPC ya devuelve el free tier vigente (el más reciente) — aquí 5000.
        consumo_precios_vigentes: [
          { proveedor_costo: 'google_route_optimization', sku: 'single_vehicle', free_tier_mensual: 5000 },
        ],
      },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente as never);

    const r = await obtenerConsumoPorProveedor(VENTANA);
    const google = r.find((p) => p.proveedorCosto === 'google_route_optimization');
    expect(google?.freeTierMensual).toBe(5000);
    // 2500 / 5000 * 100 = 50%
    expect(google?.porcentajeFreeTier).toBe(50);

    const sinProveedor = r.find((p) => p.proveedorCosto === null);
    expect(sinProveedor?.freeTierMensual).toBeNull();
    expect(sinProveedor?.porcentajeFreeTier).toBeNull();
  });
});

describe('obtenerKpisCostosConsumo', () => {
  beforeEach(() => vi.clearAllMocks());

  it('costo total = suma por proveedor; costo por entrega = costoTotal / conteo de entrega.cerrar', async () => {
    const cliente = crearClienteFalso({
      respuestasRpc: {
        consumo_por_courier: [
          { tenant_id: 't1', eventos: 5, total_unidades: 100, total_costo_usd: 10 },
        ],
        consumo_por_proveedor: [
          { proveedor_costo: 'google_geocoding', sku: '', eventos: 4, total_unidades: 4, total_costo_usd: 6 },
          { proveedor_costo: 'whatsapp_cloud', sku: 'utility', eventos: 2, total_unidades: 2, total_costo_usd: 4 },
        ],
        consumo_precios_vigentes: [],
        // Agregado por tipo × usuario × proveedor: 2 entregas cerradas, 1 fallida.
        consumo_uso_por_tipo: [
          { tipo_evento: 'entrega.cerrar', usuario_id: null, proveedor_costo: null, eventos: 2 },
          { tipo_evento: 'entrega.fallar', usuario_id: null, proveedor_costo: null, eventos: 1 },
        ],
      },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente as never);

    const kpis = await obtenerKpisCostosConsumo(VENTANA);

    expect(kpis.costoTotalUsd).toBe(10); // 6 + 4
    expect(kpis.entregasEfectivas).toBe(2);
    expect(kpis.costoPorEntregaUsd).toBe(5); // 10 / 2
    expect(kpis.topCouriers).toEqual([{ tenantId: 't1', eventos: 5, totalUnidades: 100, totalCostoUsd: 10 }]);
    expect(kpis.desglosePorProveedor).toHaveLength(2);
  });

  it('costoPorEntregaUsd es null si no hubo ninguna entrega efectiva (evita dividir por 0)', async () => {
    const cliente = crearClienteFalso({
      respuestasRpc: {
        consumo_por_courier: [],
        consumo_por_proveedor: [],
        consumo_precios_vigentes: [],
        consumo_uso_por_tipo: [],
      },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente as never);

    const kpis = await obtenerKpisCostosConsumo(VENTANA);
    expect(kpis.entregasEfectivas).toBe(0);
    expect(kpis.costoPorEntregaUsd).toBeNull();
    expect(kpis.costoTotalUsd).toBe(0);
  });

  it('topCouriers respeta topN', async () => {
    const cliente = crearClienteFalso({
      respuestasRpc: {
        consumo_por_courier: [
          { tenant_id: 't1', eventos: 1, total_unidades: 1, total_costo_usd: 3 },
          { tenant_id: 't2', eventos: 1, total_unidades: 1, total_costo_usd: 2 },
          { tenant_id: 't3', eventos: 1, total_unidades: 1, total_costo_usd: 1 },
        ],
        consumo_por_proveedor: [],
        consumo_precios_vigentes: [],
        consumo_uso_por_tipo: [],
      },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente as never);

    const kpis = await obtenerKpisCostosConsumo(VENTANA, { topN: 2 });
    expect(kpis.topCouriers).toHaveLength(2);
    expect(kpis.topCouriers.map((c) => c.tenantId)).toEqual(['t1', 't2']);
  });
});

describe('obtenerKpisUsoConsumo', () => {
  beforeEach(() => vi.clearAllMocks());

  it('agrupa reoptimizaciones por conductor, cuenta reordenamientos y calcula el ratio local-vs-proveedor', async () => {
    const cliente = crearClienteFalso({
      respuestasRpc: {
        // Filas ya AGREGADAS por (tipo_evento, usuario, proveedor) con su conteo.
        consumo_uso_por_tipo: [
          { tipo_evento: 'ruta.optimizar', usuario_id: 'u1', proveedor_costo: null, eventos: 2 },
          { tipo_evento: 'ruta.ir_a_esta_ahora', usuario_id: 'u1', proveedor_costo: null, eventos: 1 },
          { tipo_evento: 'ruta.optimizar', usuario_id: 'u2', proveedor_costo: null, eventos: 1 },
          { tipo_evento: 'ruta.reordenar', usuario_id: 'u2', proveedor_costo: null, eventos: 1 },
          { tipo_evento: 'ruta.reordenar', usuario_id: 'u1', proveedor_costo: null, eventos: 1 },
          // Capa adaptador — decide el ratio local/proveedor:
          { tipo_evento: 'ruteo.optimizar', usuario_id: 'u1', proveedor_costo: 'google_route_optimization', eventos: 1 },
          { tipo_evento: 'ruteo.optimizar', usuario_id: 'u2', proveedor_costo: null, eventos: 2 },
        ],
      },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente as never);

    const kpis = await obtenerKpisUsoConsumo(VENTANA);

    expect(kpis.reoptimizacionesPorConductor).toEqual([
      { usuarioId: 'u1', total: 3 },
      { usuarioId: 'u2', total: 1 },
    ]);
    expect(kpis.reordenamientosTotal).toBe(2);
    expect(kpis.ratioLocalVsProveedor).toEqual({ local: 2, proveedor: 1, porcentajeLocal: 66.7 });
  });

  it('porcentajeLocal es null si no hubo ningún cálculo de ruteo en la ventana', async () => {
    const cliente = crearClienteFalso({ respuestasRpc: { consumo_uso_por_tipo: [] } });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente as never);

    const kpis = await obtenerKpisUsoConsumo(VENTANA);
    expect(kpis.ratioLocalVsProveedor).toEqual({ local: 0, proveedor: 0, porcentajeLocal: null });
    expect(kpis.reoptimizacionesPorConductor).toEqual([]);
    expect(kpis.reordenamientosTotal).toBe(0);
  });
});
