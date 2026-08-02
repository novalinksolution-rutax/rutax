/**
 * Tests de `obtenerMetricasNegocio` (F2, item L — MRR/ARR/churn/morosidad).
 *
 * Mismo patrón de mocks que `cobro.test.ts`: builder encadenable que resuelve
 * el `await` directo de la cadena vía `.then()` (consultas de LISTA, sin
 * `.maybeSingle()`), consumiendo una cola de respuestas en el mismo orden en
 * que el código las dispara:
 *   1. suscripciones (todas)
 *   2. planes (catálogo completo)
 *   3. pagos_plataforma confirmados del mes
 *   4. periodos_suscripcion vencidos
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/supabase/service-role', () => ({
  crearClienteServiceRole: vi.fn(),
}));

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { obtenerMetricasNegocio } from './metricas-negocio';

function crearMockSupabase(secuencia: Array<{ data: unknown; error: unknown }>) {
  let i = 0;
  const siguiente = () => secuencia[i++] ?? { data: [], error: null };
  const q: Record<string, unknown> = {
    schema: vi.fn(() => q),
    from: vi.fn(() => q),
    select: vi.fn(() => q),
    eq: vi.fn(() => q),
    gte: vi.fn(() => q),
    lt: vi.fn(() => q),
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(siguiente()).then(resolve, reject),
  };
  return q;
}

const PLAN_A = { id: 'plan-a', precio_mensual_clp: 19990, precio_anual_clp: 199900 };
const PLAN_B = { id: 'plan-b', precio_mensual_clp: 49990, precio_anual_clp: 499900 };

describe('obtenerMetricasNegocio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Invierno chileno (UTC-4) — 2026-07-15, sin ambigüedad de DST.
    vi.setSystemTime(new Date('2026-07-15T16:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('MRR normaliza anual a mensual (÷12), excluye trial/suspendida/cancelada; ARR = MRR*12', async () => {
    const suscripciones = [
      { id: 's1', estado: 'activa', periodicidad: 'mensual', plan_id: 'plan-a', cancelada_en: null },
      { id: 's2', estado: 'activa', periodicidad: 'anual', plan_id: 'plan-b', cancelada_en: null },
      { id: 's3', estado: 'trial', periodicidad: 'mensual', plan_id: 'plan-a', cancelada_en: null },
      { id: 's4', estado: 'suspendida', periodicidad: 'mensual', plan_id: 'plan-a', cancelada_en: null },
      { id: 's5', estado: 'cancelada', periodicidad: 'mensual', plan_id: 'plan-a', cancelada_en: '2026-07-10T12:00:00.000Z' },
      { id: 's6', estado: 'cancelada', periodicidad: 'mensual', plan_id: 'plan-a', cancelada_en: '2026-06-10T12:00:00.000Z' },
    ];

    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabase([
        { data: suscripciones, error: null },
        { data: [PLAN_A, PLAN_B], error: null },
        { data: [{ monto_clp: 19990 }, { monto_clp: 16452 }], error: null }, // pagos del mes
        { data: [{ monto_clp: 19990 }, { monto_clp: 5000 }], error: null }, // vencidos
      ]) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const m = await obtenerMetricasNegocio();

    // MRR = 19990 (s1, mensual) + round(499900/12)=41658 (s2, anual → mensual)
    expect(m.mrrClp).toBe(61648);
    expect(m.arrClp).toBe(61648 * 12);

    expect(m.couriersPorEstado).toEqual({ trial: 1, activa: 2, suspendida: 1, cancelada: 2 });

    expect(m.ingresosMesClp).toBe(36442);
    expect(m.morosidadTotalClp).toBe(24990);

    // Solo s5 canceló ESTE mes (s6 fue el mes anterior).
    expect(m.churnMes.canceladas).toBe(1);
    // activasAlInicioAprox = activas HOY (2) + canceladas este mes (1) = 3.
    expect(m.churnMes.activasAlInicioAprox).toBe(3);
    expect(m.churnMes.tasa).toBeCloseTo(1 / 3, 10);
  });

  it('sin suscripciones activas: MRR/ARR = 0, churn con denominador 0 → tasa 0 (sin división por cero)', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabase([
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
      ]) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const m = await obtenerMetricasNegocio();

    expect(m.mrrClp).toBe(0);
    expect(m.arrClp).toBe(0);
    expect(m.churnMes).toEqual({ canceladas: 0, activasAlInicioAprox: 0, tasa: 0 });
    expect(m.couriersPorEstado).toEqual({ trial: 0, activa: 0, suspendida: 0, cancelada: 0 });
  });

  it('el override de características NUNCA afecta el MRR (se ignora — el precio viene solo del plan)', async () => {
    // Ni siquiera se consulta `caracteristicas_override` — la fila de
    // suscripción usada aquí no la trae, y el cálculo de MRR igual funciona
    // usando exclusivamente `planes.precio_mensual_clp`.
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabase([
        { data: [{ id: 's1', estado: 'activa', periodicidad: 'mensual', plan_id: 'plan-a', cancelada_en: null }], error: null },
        { data: [PLAN_A], error: null },
        { data: [], error: null },
        { data: [], error: null },
      ]) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const m = await obtenerMetricasNegocio();
    expect(m.mrrClp).toBe(19990);
  });
});
