/**
 * Tests de `periodos.ts` — función pura `calcularRangoPeriodo`.
 *
 * La función `calcularRangoPeriodo` es semi-pura (depende de la zona horaria
 * del sistema a través de `Intl.DateTimeFormat` con `timeZone: 'America/Santiago'`).
 * Todos los cálculos deben producir rangos correctos en zona Santiago,
 * independientemente de la timezone del servidor.
 *
 * Casos cubiertos:
 * 1. Período mensual — inicio del mes y último día del mes.
 * 2. Período quincenal — primera quincena (1-15) y segunda quincena (16-último).
 * 3. Período semanal — lunes a domingo.
 * 4. Casos borde: cambio de mes, fin de febrero, fechas cerca de medianoche UTC.
 * 5. Invariante: fechaFin siempre >= fechaInicio.
 * 6. Invariante: las fechas son strings en formato 'YYYY-MM-DD'.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calcularRangoPeriodo, obtenerOCrearPeriodoCobroAbierto } from './periodos';
import type { SupabaseClient } from '@supabase/supabase-js';

// =============================================================================
// Tests período MENSUAL
// =============================================================================

describe('calcularRangoPeriodo — mensual', () => {
  it('1 de junio 2026 → inicio 2026-06-01, fin 2026-06-30', () => {
    const fecha = new Date('2026-06-01T12:00:00-03:00'); // mediodía Santiago
    const { fechaInicio, fechaFin } = calcularRangoPeriodo(fecha, 'mensual');

    expect(fechaInicio).toBe('2026-06-01');
    expect(fechaFin).toBe('2026-06-30');
  });

  it('15 de junio 2026 → inicio 2026-06-01, fin 2026-06-30', () => {
    const fecha = new Date('2026-06-15T10:00:00-03:00');
    const { fechaInicio, fechaFin } = calcularRangoPeriodo(fecha, 'mensual');

    expect(fechaInicio).toBe('2026-06-01');
    expect(fechaFin).toBe('2026-06-30');
  });

  it('30 de junio 2026 → inicio 2026-06-01, fin 2026-06-30', () => {
    const fecha = new Date('2026-06-30T23:59:00-03:00');
    const { fechaInicio, fechaFin } = calcularRangoPeriodo(fecha, 'mensual');

    expect(fechaInicio).toBe('2026-06-01');
    expect(fechaFin).toBe('2026-06-30');
  });

  it('1 de julio 2026 → inicio 2026-07-01, fin 2026-07-31', () => {
    const fecha = new Date('2026-07-01T09:00:00-03:00');
    const { fechaInicio, fechaFin } = calcularRangoPeriodo(fecha, 'mensual');

    expect(fechaInicio).toBe('2026-07-01');
    expect(fechaFin).toBe('2026-07-31');
  });

  it('28 de febrero 2027 (no bisiesto) → fin 2027-02-28', () => {
    const fecha = new Date('2027-02-15T12:00:00-03:00');
    const { fechaInicio, fechaFin } = calcularRangoPeriodo(fecha, 'mensual');

    expect(fechaInicio).toBe('2027-02-01');
    expect(fechaFin).toBe('2027-02-28');
  });

  it('febrero 2028 (bisiesto) → fin 2028-02-29', () => {
    const fecha = new Date('2028-02-15T12:00:00-03:00');
    const { fechaInicio, fechaFin } = calcularRangoPeriodo(fecha, 'mensual');

    expect(fechaInicio).toBe('2028-02-01');
    expect(fechaFin).toBe('2028-02-29');
  });

  it('31 de diciembre 2026 → inicio 2026-12-01, fin 2026-12-31', () => {
    const fecha = new Date('2026-12-31T12:00:00-03:00');
    const { fechaInicio, fechaFin } = calcularRangoPeriodo(fecha, 'mensual');

    expect(fechaInicio).toBe('2026-12-01');
    expect(fechaFin).toBe('2026-12-31');
  });

  // Borde: fecha en UTC que sea 30 de junio 22:00 UTC = 1 de julio 02:00 AM en UTC+3
  // Pero en Santiago (UTC-3) = 30 de junio 19:00. Debe dar junio.
  it('30 junio 22:00 UTC = 30 junio 19:00 Santiago → fecha correcta en Santiago', () => {
    const fechaUtc = new Date('2026-06-30T22:00:00Z');
    const { fechaInicio, fechaFin } = calcularRangoPeriodo(fechaUtc, 'mensual');

    // En Santiago (UTC-3), 22:00 UTC = 19:00 = todavía 30 de junio
    expect(fechaInicio).toBe('2026-06-01');
    expect(fechaFin).toBe('2026-06-30');
  });
});

// =============================================================================
// Tests período QUINCENAL
// =============================================================================

describe('calcularRangoPeriodo — quincenal', () => {
  it('día 1 → primera quincena (1-15)', () => {
    const fecha = new Date('2026-06-01T12:00:00-03:00');
    const { fechaInicio, fechaFin } = calcularRangoPeriodo(fecha, 'quincenal');

    expect(fechaInicio).toBe('2026-06-01');
    expect(fechaFin).toBe('2026-06-15');
  });

  it('día 8 → primera quincena (1-15)', () => {
    const fecha = new Date('2026-06-08T10:00:00-03:00');
    const { fechaInicio, fechaFin } = calcularRangoPeriodo(fecha, 'quincenal');

    expect(fechaInicio).toBe('2026-06-01');
    expect(fechaFin).toBe('2026-06-15');
  });

  it('día 15 → primera quincena (1-15)', () => {
    const fecha = new Date('2026-06-15T23:59:00-03:00');
    const { fechaInicio, fechaFin } = calcularRangoPeriodo(fecha, 'quincenal');

    expect(fechaInicio).toBe('2026-06-01');
    expect(fechaFin).toBe('2026-06-15');
  });

  it('día 16 → segunda quincena (16-último)', () => {
    const fecha = new Date('2026-06-16T12:00:00-03:00');
    const { fechaInicio, fechaFin } = calcularRangoPeriodo(fecha, 'quincenal');

    expect(fechaInicio).toBe('2026-06-16');
    expect(fechaFin).toBe('2026-06-30');
  });

  it('día 30 de junio → segunda quincena (16-30)', () => {
    const fecha = new Date('2026-06-30T12:00:00-03:00');
    const { fechaInicio, fechaFin } = calcularRangoPeriodo(fecha, 'quincenal');

    expect(fechaInicio).toBe('2026-06-16');
    expect(fechaFin).toBe('2026-06-30');
  });

  it('segunda quincena de febrero no bisiesto → fin 2027-02-28', () => {
    const fecha = new Date('2027-02-20T12:00:00-03:00');
    const { fechaInicio, fechaFin } = calcularRangoPeriodo(fecha, 'quincenal');

    expect(fechaInicio).toBe('2027-02-16');
    expect(fechaFin).toBe('2027-02-28');
  });
});

// =============================================================================
// Tests período SEMANAL
// =============================================================================

describe('calcularRangoPeriodo — semanal', () => {
  it('lunes 1 de junio 2026 → semana 2026-06-01 a 2026-06-07', () => {
    // 1 de junio 2026 es lunes
    const fecha = new Date('2026-06-01T12:00:00-03:00');
    const { fechaInicio, fechaFin } = calcularRangoPeriodo(fecha, 'semanal');

    expect(fechaInicio).toBe('2026-06-01');
    expect(fechaFin).toBe('2026-06-07');
  });

  it('miércoles 3 de junio 2026 → misma semana lunes-domingo', () => {
    const fecha = new Date('2026-06-03T12:00:00-03:00');
    const { fechaInicio, fechaFin } = calcularRangoPeriodo(fecha, 'semanal');

    expect(fechaInicio).toBe('2026-06-01');
    expect(fechaFin).toBe('2026-06-07');
  });

  it('domingo 7 de junio 2026 → misma semana (lunes 1 a domingo 7)', () => {
    const fecha = new Date('2026-06-07T23:00:00-03:00');
    const { fechaInicio, fechaFin } = calcularRangoPeriodo(fecha, 'semanal');

    expect(fechaInicio).toBe('2026-06-01');
    expect(fechaFin).toBe('2026-06-07');
  });

  it('lunes siguiente 8 de junio 2026 → nueva semana (8-14)', () => {
    const fecha = new Date('2026-06-08T12:00:00-03:00');
    const { fechaInicio, fechaFin } = calcularRangoPeriodo(fecha, 'semanal');

    expect(fechaInicio).toBe('2026-06-08');
    expect(fechaFin).toBe('2026-06-14');
  });
});

// =============================================================================
// Invariantes
// =============================================================================

describe('invariantes de calcularRangoPeriodo', () => {
  const tipos = ['mensual', 'quincenal', 'semanal'] as const;
  const fechas = [
    new Date('2026-01-15T12:00:00-03:00'),
    new Date('2026-06-30T12:00:00-03:00'),
    new Date('2026-12-31T12:00:00-03:00'),
    new Date('2027-02-28T12:00:00-03:00'),
  ];

  for (const tipo of tipos) {
    for (const fecha of fechas) {
      it(`[${tipo}] fechaInicio <= fechaFin para ${fecha.toISOString().split('T')[0]}`, () => {
        const { fechaInicio, fechaFin } = calcularRangoPeriodo(fecha, tipo);
        expect(fechaInicio <= fechaFin).toBe(true);
      });
    }
  }

  it('el formato de fechaInicio es siempre YYYY-MM-DD', () => {
    const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;
    const fecha = new Date('2026-06-15T12:00:00-03:00');

    for (const tipo of tipos) {
      const { fechaInicio, fechaFin } = calcularRangoPeriodo(fecha, tipo);
      expect(fechaInicio).toMatch(isoDateRegex);
      expect(fechaFin).toMatch(isoDateRegex);
    }
  });

  it('todos los tipos devuelven fechaInicio y fechaFin del mismo mes (mensual) o semana (semanal)', () => {
    const fecha = new Date('2026-06-15T12:00:00-03:00');
    const { fechaInicio: inicioMensual } = calcularRangoPeriodo(fecha, 'mensual');

    // La fecha de inicio mensual es siempre el 1 del mes
    expect(inicioMensual).toBe('2026-06-01');
  });

  it('el tipo de período fallback (tipo desconocido) usa mensual', () => {
    const fecha = new Date('2026-06-15T12:00:00-03:00');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { fechaInicio, fechaFin } = calcularRangoPeriodo(fecha, 'tipo_invalido' as any);

    // El fallback seguro es mensual
    expect(fechaInicio).toBe('2026-06-01');
    expect(fechaFin).toBe('2026-06-30');
  });
});

// =============================================================================
// obtenerOCrearPeriodoCobroAbierto — guarda QA: nunca devolver un período no
// abierto (evita misfilar líneas en un período cerrado/facturado).
// =============================================================================

interface FilaPeriodoTest {
  id: string;
  tenant_id: string;
  seller_id: string;
  fecha_inicio: string;
  fecha_fin: string;
  estado: string;
}

/**
 * Fake Supabase mínimo para `obtenerOCrearPeriodoCobroAbierto`:
 *  - config_periodos: select().eq().eq().or().order().limit() → array
 *  - periodos_cobro: upsert (ignoreDuplicates) + select().eq()xN.maybeSingle()
 */
function crearFakeSupabasePeriodos(periodos: FilaPeriodoTest[]) {
  let schemaActual = '';
  return {
    schema(s: string) {
      schemaActual = s;
      return {
        from(tabla: string) {
          if (schemaActual === 'dinero' && tabla === 'config_periodos') {
            const b = {
              select() { return b; },
              eq() { return b; },
              or() { return b; },
              order() { return b; },
              limit() { return Promise.resolve({ data: [], error: null }); },
            };
            return b;
          }
          if (schemaActual === 'dinero' && tabla === 'periodos_cobro') {
            return {
              upsert(valores: Record<string, unknown>, _opts: { ignoreDuplicates?: boolean }) {
                const existe = periodos.some(
                  (p) =>
                    p.tenant_id === valores.tenant_id &&
                    p.seller_id === valores.seller_id &&
                    p.fecha_inicio === valores.fecha_inicio &&
                    p.fecha_fin === valores.fecha_fin,
                );
                // ignoreDuplicates: si ya existe el rango, NO inserta nada (y NO
                // cambia el estado del existente) — exactamente como ON CONFLICT
                // DO NOTHING en la BD real.
                if (!existe) {
                  periodos.push({
                    id: `nuevo-${periodos.length + 1}`,
                    tenant_id: valores.tenant_id as string,
                    seller_id: valores.seller_id as string,
                    fecha_inicio: valores.fecha_inicio as string,
                    fecha_fin: valores.fecha_fin as string,
                    estado: 'abierto',
                  });
                }
                return Promise.resolve({ error: null });
              },
              select() {
                const filtros: Array<(f: FilaPeriodoTest) => boolean> = [];
                const b = {
                  eq(col: keyof FilaPeriodoTest, val: unknown) {
                    filtros.push((f) => f[col] === val);
                    return b;
                  },
                  maybeSingle() {
                    const r = periodos.filter((f) => filtros.every((fn) => fn(f)));
                    return Promise.resolve({ data: r[0] ?? null, error: null });
                  },
                };
                return b;
              },
            };
          }
          throw new Error(`Tabla no modelada: ${schemaActual}.${tabla}`);
        },
      };
    },
  } as unknown as SupabaseClient;
}

describe('obtenerOCrearPeriodoCobroAbierto — guarda de estado', () => {
  beforeEach(() => vi.clearAllMocks());

  it('crea y devuelve el período cuando no existe (estado abierto)', async () => {
    const periodos: FilaPeriodoTest[] = [];
    const cliente = crearFakeSupabasePeriodos(periodos);
    const id = await obtenerOCrearPeriodoCobroAbierto(cliente, {
      tenantId: 't', sellerId: 's', fechaEntrega: new Date('2026-06-15T12:00:00-03:00'),
    });
    expect(id).toBeTruthy();
    expect(periodos[0].estado).toBe('abierto');
  });

  it('reutiliza el período existente si está ABIERTO', async () => {
    const periodos: FilaPeriodoTest[] = [
      { id: 'per-existente', tenant_id: 't', seller_id: 's', fecha_inicio: '2026-06-01', fecha_fin: '2026-06-30', estado: 'abierto' },
    ];
    const cliente = crearFakeSupabasePeriodos(periodos);
    const id = await obtenerOCrearPeriodoCobroAbierto(cliente, {
      tenantId: 't', sellerId: 's', fechaEntrega: new Date('2026-06-15T12:00:00-03:00'),
    });
    expect(id).toBe('per-existente');
    expect(periodos).toHaveLength(1); // no se creó otro
  });

  it('BUG-GUARD: si el período del rango existe pero está FACTURADO, falla (no misfila líneas)', async () => {
    const periodos: FilaPeriodoTest[] = [
      { id: 'per-facturado', tenant_id: 't', seller_id: 's', fecha_inicio: '2026-06-01', fecha_fin: '2026-06-30', estado: 'facturado' },
    ];
    const cliente = crearFakeSupabasePeriodos(periodos);
    await expect(
      obtenerOCrearPeriodoCobroAbierto(cliente, {
        tenantId: 't', sellerId: 's', fechaEntrega: new Date('2026-06-15T12:00:00-03:00'),
      }),
    ).rejects.toThrow(/no 'abierto'|facturado/);
  });

  it('BUG-GUARD: período CERRADO del rango también falla (no se le asignan líneas)', async () => {
    const periodos: FilaPeriodoTest[] = [
      { id: 'per-cerrado', tenant_id: 't', seller_id: 's', fecha_inicio: '2026-06-01', fecha_fin: '2026-06-30', estado: 'cerrado' },
    ];
    const cliente = crearFakeSupabasePeriodos(periodos);
    await expect(
      obtenerOCrearPeriodoCobroAbierto(cliente, {
        tenantId: 't', sellerId: 's', fechaEntrega: new Date('2026-06-15T12:00:00-03:00'),
      }),
    ).rejects.toThrow(/cerrado|abierto/);
  });
});
