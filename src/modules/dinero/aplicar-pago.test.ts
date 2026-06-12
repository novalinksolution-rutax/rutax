/**
 * Tests de idempotencia y reglas de dinero de `conciliarPagoPersistido`
 * (núcleo de aplicación de un pago a su período — capa "pagado").
 *
 * No tocan BD: se mockea `crearClienteServiceRole` con un fake en memoria que
 * imita las tablas `dinero.pagos_recibidos`, `dinero.periodos_cobro` e
 * `identidad.sellers`, y soporta la cadena de query builder que usa el código
 * (`.schema().from().select().eq()...`, `.update().eq().eq()`, `.in()`).
 *
 * Foco QA:
 *  - Reprocesar el MISMO pago no re-imputa al período (idempotencia real).
 *  - Pago terminal (`conciliado`/`descartado`) no se re-procesa.
 *  - Calce total / parcial / sobrante / sin RUT → estados y proyección correctos.
 *  - Aislamiento por tenant: la lectura va siempre acotada a `tenant_id`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/service-role', () => ({
  crearClienteServiceRole: vi.fn(),
}));

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { conciliarPagoPersistido } from './aplicar-pago';

// =============================================================================
// Fake Supabase en memoria — modela solo lo que el código consulta.
// =============================================================================

interface FilaPago {
  id: string;
  tenant_id: string;
  seller_id: string | null;
  periodo_cobro_id: string | null;
  monto_clp: number;
  contraparte_rut_normalizado: string | null;
  estado_match: string;
}

interface FilaPeriodo {
  id: string;
  tenant_id: string;
  seller_id: string;
  monto_total_clp: number;
  monto_pagado_clp: number;
  estado: string;
  estado_cobro: string;
}

interface FilaSeller {
  id: string;
  tenant_id: string;
  rut: string | null;
}

interface DB {
  pagos: FilaPago[];
  periodos: FilaPeriodo[];
  sellers: FilaSeller[];
}

/**
 * Query builder mínimo: acumula filtros `eq`/`in` y resuelve sobre el array de
 * la tabla. Para `update`, aplica el patch a las filas que cumplen los filtros.
 */
function crearFakeSupabase(db: DB) {
  function tablaPara(schema: string, tabla: string): Array<Record<string, unknown>> {
    if (schema === 'dinero' && tabla === 'pagos_recibidos') return db.pagos as unknown as Array<Record<string, unknown>>;
    if (schema === 'dinero' && tabla === 'periodos_cobro') return db.periodos as unknown as Array<Record<string, unknown>>;
    if (schema === 'identidad' && tabla === 'sellers') return db.sellers as unknown as Array<Record<string, unknown>>;
    throw new Error(`Tabla no modelada: ${schema}.${tabla}`);
  }

  let schemaActual = '';

  const cliente = {
    schema(s: string) {
      schemaActual = s;
      return {
        from(tabla: string) {
          const filas = tablaPara(schemaActual, tabla);
          const filtros: Array<(f: Record<string, unknown>) => boolean> = [];

          const builderLectura = {
            select() {
              return this;
            },
            eq(col: string, val: unknown) {
              filtros.push((f) => f[col] === val);
              return this;
            },
            in(col: string, vals: unknown[]) {
              filtros.push((f) => vals.includes(f[col]));
              return this;
            },
            filtradas() {
              return filas.filter((f) => filtros.every((fn) => fn(f)));
            },
            maybeSingle() {
              const r = this.filtradas();
              return Promise.resolve({ data: r[0] ?? null, error: null });
            },
            then(resolve: (v: { data: unknown; error: null }) => unknown) {
              // Permite `await query` directo (caso de listados como sellers/periodos).
              return Promise.resolve({ data: this.filtradas(), error: null }).then(resolve);
            },
          };

          return {
            select() {
              return builderLectura;
            },
            update(patch: Record<string, unknown>) {
              const filtrosU: Array<(f: Record<string, unknown>) => boolean> = [];
              const builderUpdate = {
                eq(col: string, val: unknown) {
                  filtrosU.push((f) => f[col] === val);
                  return this;
                },
                then(resolve: (v: { error: null }) => unknown) {
                  for (const f of filas) {
                    if (filtrosU.every((fn) => fn(f))) Object.assign(f, patch);
                  }
                  return Promise.resolve({ error: null }).then(resolve);
                },
              };
              return builderUpdate;
            },
          };
        },
      };
    },
  };

  return cliente as unknown as ReturnType<typeof crearClienteServiceRole>;
}

function dbBase(): DB {
  return {
    pagos: [],
    periodos: [],
    sellers: [{ id: 'seller-a', tenant_id: 'tenant-a', rut: '74.593.127-8' }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// Idempotencia / estado terminal
// =============================================================================

describe('conciliarPagoPersistido — idempotencia', () => {
  it('pago en estado terminal (conciliado) no se re-procesa ni toca el período', async () => {
    const db = dbBase();
    db.pagos.push({
      id: 'pago-1', tenant_id: 'tenant-a', seller_id: 'seller-a',
      periodo_cobro_id: 'per-1', monto_clp: 100000,
      contraparte_rut_normalizado: '745931278', estado_match: 'conciliado',
    });
    db.periodos.push({
      id: 'per-1', tenant_id: 'tenant-a', seller_id: 'seller-a',
      monto_total_clp: 100000, monto_pagado_clp: 100000,
      estado: 'facturado', estado_cobro: 'pagado',
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(crearFakeSupabase(db));

    const r = await conciliarPagoPersistido('pago-1', 'tenant-a');

    expect(r).toEqual({ resultado: 'terminal' });
    expect(db.periodos[0].monto_pagado_clp).toBe(100000); // sin cambios
  });

  it('pago descartado no se re-procesa', async () => {
    const db = dbBase();
    db.pagos.push({
      id: 'pago-1', tenant_id: 'tenant-a', seller_id: null,
      periodo_cobro_id: null, monto_clp: 5000,
      contraparte_rut_normalizado: null, estado_match: 'descartado',
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(crearFakeSupabase(db));

    const r = await conciliarPagoPersistido('pago-1', 'tenant-a');
    expect(r).toEqual({ resultado: 'terminal' });
  });

  it('calce total → período pagado, monto_pagado_clp correcto, pago conciliado', async () => {
    const db = dbBase();
    db.pagos.push({
      id: 'pago-1', tenant_id: 'tenant-a', seller_id: null,
      periodo_cobro_id: null, monto_clp: 119000,
      contraparte_rut_normalizado: '745931278', estado_match: 'sin_atribuir',
    });
    db.periodos.push({
      id: 'per-1', tenant_id: 'tenant-a', seller_id: 'seller-a',
      monto_total_clp: 119000, monto_pagado_clp: 0,
      estado: 'facturado', estado_cobro: 'pendiente',
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(crearFakeSupabase(db));

    const r = await conciliarPagoPersistido('pago-1', 'tenant-a');

    expect(r.resultado).toBe('conciliado');
    expect(db.periodos[0].estado_cobro).toBe('pagado');
    expect(db.periodos[0].monto_pagado_clp).toBe(119000);
    expect(db.pagos[0].estado_match).toBe('conciliado');
    expect(db.pagos[0].periodo_cobro_id).toBe('per-1');
  });

  it('reprocesar el MISMO pago tras un calce total NO re-imputa (idempotente)', async () => {
    const db = dbBase();
    db.pagos.push({
      id: 'pago-1', tenant_id: 'tenant-a', seller_id: null,
      periodo_cobro_id: null, monto_clp: 119000,
      contraparte_rut_normalizado: '745931278', estado_match: 'sin_atribuir',
    });
    db.periodos.push({
      id: 'per-1', tenant_id: 'tenant-a', seller_id: 'seller-a',
      monto_total_clp: 119000, monto_pagado_clp: 0,
      estado: 'facturado', estado_cobro: 'pendiente',
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(crearFakeSupabase(db));

    await conciliarPagoPersistido('pago-1', 'tenant-a');
    // Segunda corrida (reintento del job / webhook reentregado): el pago ya es
    // terminal (conciliado) → no debe re-imputar.
    const r2 = await conciliarPagoPersistido('pago-1', 'tenant-a');

    expect(r2).toEqual({ resultado: 'terminal' });
    expect(db.periodos[0].monto_pagado_clp).toBe(119000); // NO 238000
  });

  it('REGRESIÓN — reprocesar un pago PARCIAL no debe duplicar la imputación', async () => {
    const db = dbBase();
    db.pagos.push({
      id: 'pago-1', tenant_id: 'tenant-a', seller_id: null,
      periodo_cobro_id: null, monto_clp: 40000,
      contraparte_rut_normalizado: '745931278', estado_match: 'sin_atribuir',
    });
    db.periodos.push({
      id: 'per-1', tenant_id: 'tenant-a', seller_id: 'seller-a',
      monto_total_clp: 100000, monto_pagado_clp: 0,
      estado: 'facturado', estado_cobro: 'pendiente',
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(crearFakeSupabase(db));

    const r1 = await conciliarPagoPersistido('pago-1', 'tenant-a');
    expect(r1.resultado).toBe('parcial');
    expect(db.periodos[0].monto_pagado_clp).toBe(40000);

    // Reintento del job sobre el MISMO pago parcial (no terminal): NO debe sumar
    // otros 40.000. El movimiento bancario es uno solo.
    await conciliarPagoPersistido('pago-1', 'tenant-a');

    expect(db.periodos[0].monto_pagado_clp).toBe(40000); // si fuese 80000 → cobro doble
  });
});

// =============================================================================
// Reglas de dinero
// =============================================================================

describe('conciliarPagoPersistido — reglas de dinero', () => {
  it('sin RUT y sin seller atribuible → sin_atribuir, sin tocar período', async () => {
    const db = dbBase();
    db.pagos.push({
      id: 'pago-1', tenant_id: 'tenant-a', seller_id: null,
      periodo_cobro_id: null, monto_clp: 50000,
      contraparte_rut_normalizado: null, estado_match: 'sin_atribuir',
    });
    db.periodos.push({
      id: 'per-1', tenant_id: 'tenant-a', seller_id: 'seller-a',
      monto_total_clp: 50000, monto_pagado_clp: 0,
      estado: 'facturado', estado_cobro: 'pendiente',
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(crearFakeSupabase(db));

    const r = await conciliarPagoPersistido('pago-1', 'tenant-a');

    expect(r).toEqual({ resultado: 'sin_atribuir' });
    expect(db.periodos[0].monto_pagado_clp).toBe(0);
    expect(db.periodos[0].estado_cobro).toBe('pendiente');
  });

  it('sobrepago (monto > saldo) → sobrante, sin imputar', async () => {
    const db = dbBase();
    db.pagos.push({
      id: 'pago-1', tenant_id: 'tenant-a', seller_id: null,
      periodo_cobro_id: null, monto_clp: 200000,
      contraparte_rut_normalizado: '745931278', estado_match: 'sin_atribuir',
    });
    db.periodos.push({
      id: 'per-1', tenant_id: 'tenant-a', seller_id: 'seller-a',
      monto_total_clp: 50000, monto_pagado_clp: 0,
      estado: 'facturado', estado_cobro: 'pendiente',
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(crearFakeSupabase(db));

    const r = await conciliarPagoPersistido('pago-1', 'tenant-a');

    expect(r).toEqual({ resultado: 'sobrante' });
    expect(db.periodos[0].monto_pagado_clp).toBe(0);
    expect(db.pagos[0].seller_id).toBe('seller-a'); // sí se atribuyó el seller
    expect(db.pagos[0].estado_match).toBe('sobrante');
  });

  it('seller atribuido pero sin período facturado impago → atribuido, sin imputar', async () => {
    const db = dbBase();
    db.pagos.push({
      id: 'pago-1', tenant_id: 'tenant-a', seller_id: null,
      periodo_cobro_id: null, monto_clp: 50000,
      contraparte_rut_normalizado: '745931278', estado_match: 'sin_atribuir',
    });
    // Período del seller pero NO facturado (no candidato).
    db.periodos.push({
      id: 'per-1', tenant_id: 'tenant-a', seller_id: 'seller-a',
      monto_total_clp: 50000, monto_pagado_clp: 0,
      estado: 'cerrado', estado_cobro: 'no_aplica',
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(crearFakeSupabase(db));

    const r = await conciliarPagoPersistido('pago-1', 'tenant-a');

    expect(r).toEqual({ resultado: 'atribuido' });
    expect(db.pagos[0].seller_id).toBe('seller-a');
    expect(db.pagos[0].estado_match).toBe('atribuido');
  });

  it('aislamiento: un período de OTRO seller del tenant no se concilia (cae a atribuido)', async () => {
    const db = dbBase();
    db.sellers.push({ id: 'seller-b', tenant_id: 'tenant-a', rut: '76.430.498-5' });
    db.pagos.push({
      id: 'pago-1', tenant_id: 'tenant-a', seller_id: null,
      periodo_cobro_id: null, monto_clp: 99000,
      contraparte_rut_normalizado: '745931278', estado_match: 'sin_atribuir',
    });
    // Período candidato pero del seller-B (no del que calza por RUT).
    db.periodos.push({
      id: 'per-b', tenant_id: 'tenant-a', seller_id: 'seller-b',
      monto_total_clp: 99000, monto_pagado_clp: 0,
      estado: 'facturado', estado_cobro: 'pendiente',
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(crearFakeSupabase(db));

    const r = await conciliarPagoPersistido('pago-1', 'tenant-a');

    // El pago se atribuye al seller-a (por RUT), cuyo único candidato no existe →
    // NO debe imputarse al período del seller-b.
    expect(r).toEqual({ resultado: 'atribuido' });
    expect(db.periodos[0].monto_pagado_clp).toBe(0);
  });
});
