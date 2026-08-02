/**
 * Tests de `excepciones.ts` — hook REAL de la bandeja de excepciones consumido
 * por `preflight.ts` (§1.1 P1, jul 2026).
 *
 * `preflight.test.ts` mockea TODO este módulo (`vi.mock('@/modules/dinero/excepciones')`),
 * así que la query real (filtro por tenant, por estado no-terminal, por el flag
 * de bloqueo correcto, el `.or(...)` de período/seller o liquidación/conductor,
 * y el mapeo a `ItemPreflight`) nunca se ejecutaba en ningún test. Este archivo
 * cierra ese hueco ejercitando `bloqueaFacturacion`/`bloqueaPago` contra un fake
 * de Supabase que sí interpreta `.eq()/.in()/.or()`.
 *
 * No se mockea el módulo bajo prueba — solo `crearClienteServiceRole`, mismo
 * patrón que `preflight.test.ts`/`folios.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/service-role', () => ({
  crearClienteServiceRole: vi.fn(),
}));

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { bloqueaFacturacion, bloqueaPago } from './excepciones';

// =============================================================================
// Fake Supabase — soporta `.eq()/.in()/.or()` encadenados sobre una única tabla,
// suficiente para las queries de `excepciones.ts` (siempre `eventos_conciliacion`).
// El `.or()` real de PostgREST-js recibe una cadena "colA.eq.val,colB.eq.val"
// con semántica OR — se interpreta aquí de la misma forma.
// =============================================================================

type Fila = Record<string, unknown>;

function crearFakeSupabase(filas: Fila[]) {
  function construirBuilder(filtros: Array<(f: Fila) => boolean>) {
    const aplicarFiltros = () => filas.filter((f) => filtros.every((fn) => fn(f)));
    const builder = {
      eq(col: string, val: unknown) {
        return construirBuilder([...filtros, (f: Fila) => f[col] === val]);
      },
      in(col: string, vals: unknown[]) {
        return construirBuilder([...filtros, (f: Fila) => vals.includes(f[col] as never)]);
      },
      or(expr: string) {
        const condiciones = expr.split(',').map((cond) => {
          const [col, , ...resto] = cond.split('.');
          const valor = resto.join('.');
          return (f: Fila) => String(f[col]) === valor;
        });
        return construirBuilder([...filtros, (f: Fila) => condiciones.some((fn) => fn(f))]);
      },
      then(resolve: (v: { data: Fila[]; error: null }) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve({ data: aplicarFiltros(), error: null }).then(resolve, reject);
      },
    };
    return builder;
  }

  return {
    schema() {
      return {
        from() {
          return {
            select() {
              return construirBuilder([]);
            },
          };
        },
      };
    },
  };
}

function usar(filas: Fila[]) {
  vi.mocked(crearClienteServiceRole).mockReturnValue(
    crearFakeSupabase(filas) as unknown as ReturnType<typeof crearClienteServiceRole>,
  );
}

const TENANT = 'tenant-a';
const OTRO_TENANT = 'tenant-b';
const PERIODO_ID = 'periodo-1';
const SELLER_ID = 'seller-1';
const LIQUIDACION_ID = 'liq-1';
const DRIVER_ID = 'driver-1';

/** Fila base de un evento bloqueante de facturación por período — overrides para variar el caso. */
function eventoBloqueaFacturacion(overrides: Fila = {}): Fila {
  return {
    id: 'evento-1',
    tenant_id: TENANT,
    seller_id: SELLER_ID,
    periodo_cobro_id: PERIODO_ID,
    liquidacion_id: null,
    driver_id: null,
    tipo_diferencia: 'pagado_conductor_sin_cobro_seller',
    estado: 'pendiente',
    bloquea_facturacion: true,
    bloquea_pago: false,
    monto_diferencia_clp: 1200,
    fecha_limite: '2026-07-10',
    motivo_bloqueo: 'Se retiene hasta confirmar el cobro faltante',
    ...overrides,
  };
}

function eventoBloqueaPago(overrides: Fila = {}): Fila {
  return {
    id: 'evento-pago-1',
    tenant_id: TENANT,
    seller_id: null,
    periodo_cobro_id: null,
    liquidacion_id: LIQUIDACION_ID,
    driver_id: DRIVER_ID,
    tipo_diferencia: 'pago_conductor_faltante',
    estado: 'pendiente',
    bloquea_facturacion: false,
    bloquea_pago: true,
    monto_diferencia_clp: 3000,
    fecha_limite: '2026-07-12',
    motivo_bloqueo: 'Falta confirmar el pago con el conductor',
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(crearClienteServiceRole).mockReset();
});

// =============================================================================
// bloqueaFacturacion
// =============================================================================

describe('bloqueaFacturacion', () => {
  it('sin eventos → bloquea:false, motivos:[]', async () => {
    usar([]);
    const resultado = await bloqueaFacturacion({
      tenantId: TENANT,
      periodoCobroId: PERIODO_ID,
      sellerId: SELLER_ID,
    });
    expect(resultado).toEqual({ bloquea: false, motivos: [] });
  });

  it('evento bloqueante encontrado por periodo_cobro_id → bloquea:true con el ItemPreflight correcto', async () => {
    usar([eventoBloqueaFacturacion({ periodo_cobro_id: PERIODO_ID, seller_id: 'seller-no-relacionado' })]);

    const resultado = await bloqueaFacturacion({
      tenantId: TENANT,
      periodoCobroId: PERIODO_ID,
      sellerId: SELLER_ID,
    });

    expect(resultado.bloquea).toBe(true);
    expect(resultado.motivos).toHaveLength(1);
    expect(resultado.motivos[0]).toMatchObject({
      codigo: 'bandeja_excepciones',
      categoria: 'bloquea',
      titulo: 'Facturación bloqueada por excepción',
      detalle: 'Se retiene hasta confirmar el cobro faltante',
    });
    expect(resultado.motivos[0].meta).toMatchObject({
      evento_id: 'evento-1',
      tipo_diferencia: 'pagado_conductor_sin_cobro_seller',
      estado: 'pendiente',
      monto_diferencia_clp: 1200,
      fecha_limite: '2026-07-10',
    });
  });

  it('evento bloqueante encontrado por seller_id (aunque el período no calce) → bloquea:true', async () => {
    usar([eventoBloqueaFacturacion({ periodo_cobro_id: 'otro-periodo', seller_id: SELLER_ID })]);

    const resultado = await bloqueaFacturacion({
      tenantId: TENANT,
      periodoCobroId: PERIODO_ID,
      sellerId: SELLER_ID,
    });

    expect(resultado.bloquea).toBe(true);
    expect(resultado.motivos).toHaveLength(1);
  });

  it('evento en estado terminal NO bloquea aunque bloquea_facturacion siga true (comportamiento diseñado)', async () => {
    usar([eventoBloqueaFacturacion({ estado: 'resuelta_manual' })]);

    const resultado = await bloqueaFacturacion({
      tenantId: TENANT,
      periodoCobroId: PERIODO_ID,
      sellerId: SELLER_ID,
    });

    expect(resultado).toEqual({ bloquea: false, motivos: [] });
  });

  it.each(['resuelta_auto', 'aceptada_justificada', 'ignorada'] as const)(
    'evento en estado terminal "%s" tampoco bloquea',
    async (estadoTerminal) => {
      usar([eventoBloqueaFacturacion({ estado: estadoTerminal })]);

      const resultado = await bloqueaFacturacion({
        tenantId: TENANT,
        periodoCobroId: PERIODO_ID,
        sellerId: SELLER_ID,
      });

      expect(resultado.bloquea).toBe(false);
    },
  );

  it('evento de otro tenant no aparece aunque el período/seller coincidan (filtro tenant_id)', async () => {
    usar([eventoBloqueaFacturacion({ tenant_id: OTRO_TENANT })]);

    const resultado = await bloqueaFacturacion({
      tenantId: TENANT,
      periodoCobroId: PERIODO_ID,
      sellerId: SELLER_ID,
    });

    expect(resultado).toEqual({ bloquea: false, motivos: [] });
  });

  it('evento con bloquea_facturacion=false no bloquea aunque período/seller calcen', async () => {
    usar([eventoBloqueaFacturacion({ bloquea_facturacion: false })]);

    const resultado = await bloqueaFacturacion({
      tenantId: TENANT,
      periodoCobroId: PERIODO_ID,
      sellerId: SELLER_ID,
    });

    expect(resultado).toEqual({ bloquea: false, motivos: [] });
  });

  it('múltiples eventos bloqueantes generan múltiples ItemPreflight', async () => {
    usar([
      eventoBloqueaFacturacion({ id: 'evento-1', periodo_cobro_id: PERIODO_ID }),
      eventoBloqueaFacturacion({ id: 'evento-2', periodo_cobro_id: PERIODO_ID, motivo_bloqueo: 'Segundo motivo' }),
    ]);

    const resultado = await bloqueaFacturacion({
      tenantId: TENANT,
      periodoCobroId: PERIODO_ID,
      sellerId: SELLER_ID,
    });

    expect(resultado.bloquea).toBe(true);
    expect(resultado.motivos).toHaveLength(2);
    expect(resultado.motivos.map((m) => m.meta?.evento_id)).toEqual(['evento-1', 'evento-2']);
  });

  it('sin motivo_bloqueo registrado → usa el detalle default', async () => {
    usar([eventoBloqueaFacturacion({ motivo_bloqueo: null })]);

    const resultado = await bloqueaFacturacion({
      tenantId: TENANT,
      periodoCobroId: PERIODO_ID,
      sellerId: SELLER_ID,
    });

    expect(resultado.motivos[0].detalle).toBe('Sin motivo registrado — revisa la bandeja de conciliación.');
  });

  it('no bloquea el pago aunque exista bloqueaPago:true en otro evento (bloqueaFacturacion es independiente)', async () => {
    usar([eventoBloqueaPago()]);

    const resultado = await bloqueaFacturacion({
      tenantId: TENANT,
      periodoCobroId: PERIODO_ID,
      sellerId: SELLER_ID,
    });

    expect(resultado).toEqual({ bloquea: false, motivos: [] });
  });
});

// =============================================================================
// bloqueaPago
// =============================================================================

describe('bloqueaPago', () => {
  it('sin eventos → bloquea:false, motivos:[]', async () => {
    usar([]);
    const resultado = await bloqueaPago({
      tenantId: TENANT,
      liquidacionId: LIQUIDACION_ID,
      driverId: DRIVER_ID,
    });
    expect(resultado).toEqual({ bloquea: false, motivos: [] });
  });

  it('evento bloqueante encontrado por liquidacion_id → bloquea:true con el ItemPreflight correcto', async () => {
    usar([eventoBloqueaPago({ liquidacion_id: LIQUIDACION_ID, driver_id: 'driver-no-relacionado' })]);

    const resultado = await bloqueaPago({
      tenantId: TENANT,
      liquidacionId: LIQUIDACION_ID,
      driverId: DRIVER_ID,
    });

    expect(resultado.bloquea).toBe(true);
    expect(resultado.motivos).toHaveLength(1);
    expect(resultado.motivos[0]).toMatchObject({
      codigo: 'bandeja_excepciones',
      categoria: 'bloquea',
      titulo: 'Pago bloqueado por excepción',
      detalle: 'Falta confirmar el pago con el conductor',
    });
  });

  it('evento bloqueante encontrado por driver_id (aunque la liquidación no calce) → bloquea:true', async () => {
    usar([eventoBloqueaPago({ liquidacion_id: 'otra-liq', driver_id: DRIVER_ID })]);

    const resultado = await bloqueaPago({
      tenantId: TENANT,
      liquidacionId: LIQUIDACION_ID,
      driverId: DRIVER_ID,
    });

    expect(resultado.bloquea).toBe(true);
    expect(resultado.motivos).toHaveLength(1);
  });

  it('evento en estado terminal NO bloquea el pago aunque bloquea_pago siga true', async () => {
    usar([eventoBloqueaPago({ estado: 'aceptada_justificada' })]);

    const resultado = await bloqueaPago({
      tenantId: TENANT,
      liquidacionId: LIQUIDACION_ID,
      driverId: DRIVER_ID,
    });

    expect(resultado).toEqual({ bloquea: false, motivos: [] });
  });

  it('evento de otro tenant no aparece aunque liquidación/conductor coincidan (filtro tenant_id)', async () => {
    usar([eventoBloqueaPago({ tenant_id: OTRO_TENANT })]);

    const resultado = await bloqueaPago({
      tenantId: TENANT,
      liquidacionId: LIQUIDACION_ID,
      driverId: DRIVER_ID,
    });

    expect(resultado).toEqual({ bloquea: false, motivos: [] });
  });

  it('evento con bloquea_pago=false no bloquea aunque liquidación/conductor calcen', async () => {
    usar([eventoBloqueaPago({ bloquea_pago: false })]);

    const resultado = await bloqueaPago({
      tenantId: TENANT,
      liquidacionId: LIQUIDACION_ID,
      driverId: DRIVER_ID,
    });

    expect(resultado).toEqual({ bloquea: false, motivos: [] });
  });

  it('múltiples eventos bloqueantes generan múltiples ItemPreflight', async () => {
    usar([
      eventoBloqueaPago({ id: 'evento-pago-1', liquidacion_id: LIQUIDACION_ID }),
      eventoBloqueaPago({ id: 'evento-pago-2', driver_id: DRIVER_ID, liquidacion_id: 'otra-liq' }),
    ]);

    const resultado = await bloqueaPago({
      tenantId: TENANT,
      liquidacionId: LIQUIDACION_ID,
      driverId: DRIVER_ID,
    });

    expect(resultado.bloquea).toBe(true);
    expect(resultado.motivos).toHaveLength(2);
  });

  it('no bloquea la facturación aunque exista bloqueaFacturacion:true en otro evento (bloqueaPago es independiente)', async () => {
    usar([eventoBloqueaFacturacion()]);

    const resultado = await bloqueaPago({
      tenantId: TENANT,
      liquidacionId: LIQUIDACION_ID,
      driverId: DRIVER_ID,
    });

    expect(resultado).toEqual({ bloquea: false, motivos: [] });
  });

  it('propaga el error cuando la consulta falla (no traga errores de infra)', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue({
      schema() {
        return {
          from() {
            return {
              select() {
                return {
                  eq() {
                    return this;
                  },
                  in() {
                    return this;
                  },
                  or() {
                    return this;
                  },
                  then(resolve: (v: unknown) => unknown) {
                    return Promise.resolve({ data: null, error: { message: 'conexión perdida' } }).then(resolve);
                  },
                };
              },
            };
          },
        };
      },
    } as unknown as ReturnType<typeof crearClienteServiceRole>);

    await expect(
      bloqueaPago({ tenantId: TENANT, liquidacionId: LIQUIDACION_ID, driverId: DRIVER_ID }),
    ).rejects.toThrow('Error al verificar bloqueos de pago: conexión perdida');
  });
});
