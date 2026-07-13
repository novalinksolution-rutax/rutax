/**
 * Tests de `obtenerMetricasUsoPlataforma` (F3, gap 2 AMPLIADO — uso agregado
 * cross-tenant del backstage admin: GMV, pedidos, DTEs, conductores/couriers/
 * sellers). Cubre:
 * - GMV: suma `periodos_cobro.monto_total_clp` excluyendo `anulado`; los
 *   `abierto` (monto NULL) aportan 0; separa mes-actual vs total histórico
 *   en una sola pasada.
 * - Pedidos: total histórico sin filtro vs. mes-actual (`creado_en`) vs.
 *   entregados del mes (`estado IN (entregado, entregado_manual)`).
 * - DTEs: solo `tipo_documento=33` (excluye notas de crédito tipo 61), total
 *   vs. mes-actual (`fecha_emision`).
 * - Conductores activos / couriers activos / sellers: conteos simples
 *   cross-tenant.
 * - Propagación de errores de cualquiera de las consultas.
 *
 * Mock: cliente multi-tabla que enruta por nombre de tabla y resuelve el
 * `await` directo de la cadena (`.then()`), igual patrón que
 * `observabilidad-tenant.test.ts`, extendido con `neq`/`gte`/`lt` para las
 * ventanas de fecha.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/supabase/service-role', () => ({
  crearClienteServiceRole: vi.fn(),
}));

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { obtenerMetricasUsoPlataforma } from './metricas-uso';

type Fila = Record<string, unknown>;

/**
 * Cliente falso multi-tabla: enruta por nombre de tabla, filtra `filas` por
 * los `.eq()`/`.neq()`/`.gte()`/`.lt()`/`.in()` encadenados y resuelve al
 * `await` (thenable). `count` = filas.length tras filtrar (head o no).
 * `erroresPorTabla` fuerza que la tabla indicada devuelva error.
 */
function crearClienteMultiTabla(
  tablas: Record<string, Fila[]>,
  erroresPorTabla: Record<string, string> = {},
) {
  function fromImpl(tabla: string) {
    const filas = tablas[tabla] ?? [];
    const errorForzado = erroresPorTabla[tabla];

    return {
      select: (_cols: string, opts?: { count?: 'exact'; head?: boolean }) => {
        const filtros: Array<(f: Fila) => boolean> = [];
        const chain: Record<string, unknown> = {
          eq: (campo: string, valor: unknown) => {
            filtros.push((f) => f[campo] === valor);
            return chain;
          },
          neq: (campo: string, valor: unknown) => {
            filtros.push((f) => f[campo] !== valor);
            return chain;
          },
          gte: (campo: string, valor: unknown) => {
            filtros.push((f) => (f[campo] as string) >= (valor as string));
            return chain;
          },
          lt: (campo: string, valor: unknown) => {
            filtros.push((f) => (f[campo] as string) < (valor as string));
            return chain;
          },
          in: (campo: string, valores: unknown[]) => {
            filtros.push((f) => valores.includes(f[campo]));
            return chain;
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

  return { schema: vi.fn(() => ({ from: fromImpl })), from: fromImpl };
}

describe('obtenerMetricasUsoPlataforma', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Invierno chileno (UTC-4) — 2026-07-15, sin ambigüedad de DST.
    // Mes calendario Santiago actual: [2026-07-01, 2026-08-01).
    vi.setSystemTime(new Date('2026-07-15T16:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('agrega GMV, pedidos, DTEs, conductores/couriers/sellers cross-tenant, separando mes actual de total', async () => {
    const cliente = crearClienteMultiTabla({
      periodos_cobro: [
        // Distintos tenants (no hay filtro de tenant_id — agregado de TODA la plataforma).
        { id: 'per-1', tenant_id: 't1', estado: 'facturado', monto_total_clp: 100000, fecha_inicio: '2026-07-01' },
        { id: 'per-2', tenant_id: 't2', estado: 'cerrado', monto_total_clp: 50000, fecha_inicio: '2026-06-25' },
        // Abierto: monto_total_clp aún NULL (no lo calcula C2 hasta cerrar) → aporta 0.
        { id: 'per-3', tenant_id: 't1', estado: 'abierto', monto_total_clp: null, fecha_inicio: '2026-07-10' },
        // Anulado: excluido por completo pese a tener monto y caer en el mes.
        { id: 'per-4', tenant_id: 't3', estado: 'anulado', monto_total_clp: 99999, fecha_inicio: '2026-07-05' },
      ],
      pedidos: [
        { id: 'ped-1', tenant_id: 't1', estado: 'entregado', creado_en: '2026-07-05T10:00:00.000Z' },
        { id: 'ped-2', tenant_id: 't2', estado: 'en_ruta', creado_en: '2026-07-06T10:00:00.000Z' },
        { id: 'ped-3', tenant_id: 't1', estado: 'entregado', creado_en: '2026-06-20T10:00:00.000Z' }, // fuera del mes
        { id: 'ped-4', tenant_id: 't3', estado: 'entregado_manual', creado_en: '2026-07-10T10:00:00.000Z' },
      ],
      documentos_dte: [
        { id: 'dte-1', tenant_id: 't1', tipo_documento: 33, fecha_emision: '2026-07-03' },
        { id: 'dte-2', tenant_id: 't2', tipo_documento: 33, fecha_emision: '2026-06-15' }, // fuera del mes
        { id: 'dte-3', tenant_id: 't1', tipo_documento: 61, fecha_emision: '2026-07-04' }, // nota de crédito, excluida
      ],
      conductores: [
        { id: 'c1', tenant_id: 't1', estado: 'activo' },
        { id: 'c2', tenant_id: 't2', estado: 'activo' },
        { id: 'c3', tenant_id: 't1', estado: 'inactivo' },
      ],
      suscripciones: [
        { id: 's1', tenant_id: 't1', estado: 'activa' },
        { id: 's2', tenant_id: 't2', estado: 'trial' },
        { id: 's3', tenant_id: 't3', estado: 'activa' },
      ],
      sellers: [
        { id: 'sel-1', tenant_id: 't1' },
        { id: 'sel-2', tenant_id: 't1' },
        { id: 'sel-3', tenant_id: 't2' },
      ],
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const m = await obtenerMetricasUsoPlataforma();

    expect(m.gmv).toEqual({ mesActualClp: 100000, totalClp: 150000 });
    expect(m.pedidos).toEqual({ total: 4, mes: 3, entregadosMes: 2 });
    expect(m.dtesEmitidos).toEqual({ total: 2, mes: 1 });
    expect(m.conductoresActivos).toBe(2);
    expect(m.couriersActivos).toBe(2);
    expect(m.sellersTotal).toBe(3);
  });

  it('plataforma vacía: todo en 0, sin errores', async () => {
    const cliente = crearClienteMultiTabla({
      periodos_cobro: [],
      pedidos: [],
      documentos_dte: [],
      conductores: [],
      suscripciones: [],
      sellers: [],
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const m = await obtenerMetricasUsoPlataforma();

    expect(m).toEqual({
      gmv: { mesActualClp: 0, totalClp: 0 },
      pedidos: { total: 0, mes: 0, entregadosMes: 0 },
      dtesEmitidos: { total: 0, mes: 0 },
      conductoresActivos: 0,
      couriersActivos: 0,
      sellersTotal: 0,
    });
  });

  it('propaga el error si falla la consulta de GMV (periodos_cobro)', async () => {
    const cliente = crearClienteMultiTabla(
      { pedidos: [], documentos_dte: [], conductores: [], suscripciones: [], sellers: [] },
      { periodos_cobro: 'boom' },
    );
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    await expect(obtenerMetricasUsoPlataforma()).rejects.toThrow(/error al calcular gmv/i);
  });

  it('propaga el error si falla el conteo de DTEs emitidos', async () => {
    const cliente = crearClienteMultiTabla(
      { periodos_cobro: [], pedidos: [], conductores: [], suscripciones: [], sellers: [] },
      { documentos_dte: 'boom' },
    );
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    await expect(obtenerMetricasUsoPlataforma()).rejects.toThrow(/error al contar dtes emitidos/i);
  });
});
