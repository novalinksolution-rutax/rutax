/**
 * Tests de `preflight.ts` — hallazgo P0 de la auditoría (jul 2026).
 *
 * Cubre, para las 3 funciones (`preflightEmitirFactura`,
 * `preflightEmitirNotaCredito`, `preflightEmitirPago`):
 * - RBAC: rechaza sin la capacidad equivalente a la acción de escritura.
 * - Cada código BLOQUEA se activa cuando corresponde y NO en el caso feliz.
 * - Advertencias (folios bajos, discrepancias, incidencias) no bloquean `ok`.
 * - El resumen cuadra (neto+iva=total; bruto-retención=líquido).
 * - El módulo NUNCA escribe: el mock de Supabase no expone `insert`/`update`,
 *   así que cualquier intento de escritura haría fallar el test con un error
 *   de "no es una función" — verificación estructural del contrato read-only.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ErrorValidacion } from '@/modules/identidad/errores';
import type { UsuarioActual } from '@/modules/identidad/usuario-actual';

// =============================================================================
// Mocks
// =============================================================================

vi.mock('@/lib/supabase/service-role', () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock('@/modules/dinero/excepciones', () => ({
  bloqueaFacturacion: vi.fn(),
  bloqueaPago: vi.fn(),
}));

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { bloqueaFacturacion, bloqueaPago } from './excepciones';
import { preflightEmitirFactura, preflightEmitirNotaCredito, preflightEmitirPago } from './preflight';
import { AREAS_PRODUCTO } from "@/modules/identidad/areas-producto";

// =============================================================================
// Fake Supabase multi-tabla — enruta por `${schema}.${tabla}` a un fixture.
// Soporta `.eq()/.in()` encadenados, `.order()/.limit()` (no-op), y como
// terminal: `.maybeSingle()` (primera fila que calza) o `await` directo del
// builder (thenable → todas las filas que calzan). Mismo espíritu que el
// mock de `folios.test.ts`, generalizado a múltiples tablas.
// =============================================================================

type Fila = Record<string, unknown>;
type Tablas = Record<string, Fila[]>;

interface FakeBuilder {
  eq(col: string, val: unknown): FakeBuilder;
  in(col: string, vals: unknown[]): FakeBuilder;
  order(): FakeBuilder;
  limit(): FakeBuilder;
  range(desde: number, hasta: number): FakeBuilder;
  maybeSingle(): Promise<{ data: Fila | null; error: null }>;
  then(
    resolve: (v: { data: Fila[]; error: null }) => unknown,
    reject?: (e: unknown) => unknown,
  ): Promise<unknown>;
}

function crearFakeSupabase(tablas: Tablas) {
  function construirBuilder(
    filas: Fila[],
    filtros: Array<(f: Fila) => boolean>,
    rango?: { desde: number; hasta: number },
  ): FakeBuilder {
    // `.range()` se aplica DE VERDAD, no como no-op: `leerTodasLasFilas` decide
    // que llegó a la última página cuando recibe uno incompleto, así que un doble
    // que ignorara el rango devolvería siempre la página llena y el lector
    // pagitaría para siempre.
    const aplicarFiltros = () => {
      const filtradas = filas.filter((f) => filtros.every((fn) => fn(f)));
      // Sin `.range()`, el doble CORTA EN 1000 igual que PostgREST con su
      // `max_rows`. Es lo que vuelve honesta a esta suite: si el doble devolviera
      // todo, un test sobre 1.365 filas pasaría aunque el código leyera sin
      // paginar, y daría por buena justo la clase de bug que costó una factura
      // 27% menor a la real.
      return rango ? filtradas.slice(rango.desde, rango.hasta + 1) : filtradas.slice(0, 1000);
    };
    const builder: FakeBuilder = {
      eq(col: string, val: unknown) {
        return construirBuilder(filas, [...filtros, (f: Fila) => f[col] === val]);
      },
      in(col: string, vals: unknown[]) {
        return construirBuilder(filas, [...filtros, (f: Fila) => vals.includes(f[col] as never)]);
      },
      order() {
        return builder;
      },
      limit() {
        return builder;
      },
      range(desde: number, hasta: number) {
        return construirBuilder(filas, filtros, { desde, hasta });
      },
      maybeSingle() {
        const encontradas = aplicarFiltros();
        return Promise.resolve({ data: encontradas[0] ?? null, error: null });
      },
      then(resolve: (v: { data: Fila[]; error: null }) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve({ data: aplicarFiltros(), error: null }).then(resolve, reject);
      },
    };
    return builder;
  }

  return {
    schema(s: string) {
      return {
        from(t: string) {
          const clave = `${s}.${t}`;
          return {
            select() {
              return construirBuilder(tablas[clave] ?? [], []);
            },
          };
        },
      };
    },
  };
}

// =============================================================================
// Fixtures
// =============================================================================

const TENANT = 'tenant-a';
const PERIODO_ID = 'periodo-1';
const SELLER_ID = 'seller-1';
const LIQUIDACION_ID = 'liq-1';
const DRIVER_ID = 'driver-1';

function usuarioConRol(rol: UsuarioActual['rol']): UsuarioActual {
  return {
    tenantId: TENANT,
    tipoUsuario: 'interno',
    sellerId: null,
    driverId: null,
    rol,
    estado: 'activo',
    areasHabilitadas: [...AREAS_PRODUCTO],
  };
}

/** Fixture base — período cerrado, seller válido, folios abundantes, sin discrepancias/incidencias. */
function fixturesFactura(overrides: Partial<Tablas> = {}): Tablas {
  return {
    'dinero.periodos_cobro': [
      { id: PERIODO_ID, tenant_id: TENANT, seller_id: SELLER_ID, estado: 'cerrado', documento_dte_id: null },
    ],
    'identidad.sellers': [
      { id: SELLER_ID, tenant_id: TENANT, razon_social: 'Seller Uno SpA', rut: '76123456-7' },
    ],
    'identidad.folios_caf': [
      { tenant_id: TENANT, tipo_documento: 33, estado: 'vigente', folio_actual: 10, folio_hasta: 200 },
      { tenant_id: TENANT, tipo_documento: 61, estado: 'vigente', folio_actual: 5, folio_hasta: 200 },
    ],
    'dinero.lineas_cobro': [
      { tenant_id: TENANT, periodo_cobro_id: PERIODO_ID, pedido_id: 'pedido-1', monto_final_clp: 10000, anulada: false },
      { tenant_id: TENANT, periodo_cobro_id: PERIODO_ID, pedido_id: 'pedido-2', monto_final_clp: 5000, anulada: false },
    ],
    'dinero.eventos_conciliacion': [],
    'operacion.incidencias': [],
    'identidad.courier_config_dte': [],
    'dinero.documentos_dte': [],
    ...overrides,
  };
}

function fixturesPago(overrides: Partial<Tablas> = {}): Tablas {
  return {
    'dinero.liquidaciones': [
      {
        id: LIQUIDACION_ID,
        tenant_id: TENANT,
        driver_id: DRIVER_ID,
        estado: 'emitida',
        monto_total_clp: 100000,
        bono_clp: 0,
        penalizacion_clp: 0,
        tipo_relacion_conductor: 'independiente',
      },
    ],
    'identidad.conductores': [
      {
        id: DRIVER_ID,
        tenant_id: TENANT,
        nombre_completo: 'Pedro Conductor',
        rut: '12345678-9',
        banco: 'banco_estado',
        tipo_cuenta: 'vista',
        numero_cuenta: '1234567890',
        tipo_relacion: 'independiente',
      },
    ],
    'identidad.courier_config_payout': [
      { tenant_id: TENANT, porcentaje_retencion: 10, minimo_retiro_clp: 0 },
    ],
    'dinero.lineas_liquidacion': [
      { tenant_id: TENANT, liquidacion_id: LIQUIDACION_ID, pedido_id: 'pedido-1', anulada: false },
      { tenant_id: TENANT, liquidacion_id: LIQUIDACION_ID, pedido_id: 'pedido-2', anulada: false },
    ],
    'dinero.eventos_conciliacion': [],
    'operacion.incidencias': [],
    ...overrides,
  };
}

function usar(tablas: Tablas) {
  vi.mocked(crearClienteServiceRole).mockReturnValue(
    crearFakeSupabase(tablas) as unknown as ReturnType<typeof crearClienteServiceRole>,
  );
}

beforeEach(() => {
  vi.mocked(crearClienteServiceRole).mockReset();
  vi.mocked(bloqueaFacturacion).mockReset().mockResolvedValue({ bloquea: false, motivos: [] });
  vi.mocked(bloqueaPago).mockReset().mockResolvedValue({ bloquea: false, motivos: [] });
});

const ORIGINAL_SANDBOX_MODE = process.env.DTE_SANDBOX_MODE;
afterEach(() => {
  if (ORIGINAL_SANDBOX_MODE === undefined) delete process.env.DTE_SANDBOX_MODE;
  else process.env.DTE_SANDBOX_MODE = ORIGINAL_SANDBOX_MODE;
});

// =============================================================================
// RBAC
// =============================================================================

describe('preflight — RBAC', () => {
  it('preflightEmitirFactura rechaza a un rol sin emitir_facturas', async () => {
    await expect(
      preflightEmitirFactura(TENANT, PERIODO_ID, usuarioConRol('supervisor')),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });

  it('preflightEmitirNotaCredito rechaza a un rol sin emitir_facturas, sin leer datos (no hay fuga parcial)', async () => {
    await expect(
      preflightEmitirNotaCredito(TENANT, PERIODO_ID, usuarioConRol('coordinador')),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });

  it('preflightEmitirPago rechaza a un rol sin gestionar_liquidaciones_conductores, sin leer datos (no hay fuga parcial)', async () => {
    await expect(
      preflightEmitirPago(TENANT, LIQUIDACION_ID, usuarioConRol('coordinador')),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });

  it('preflightEmitirNotaCredito rechaza también a roles seller/conductor (no solo internos sin capacidad)', async () => {
    await expect(
      preflightEmitirNotaCredito(TENANT, PERIODO_ID, usuarioConRol('seller')),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    await expect(
      preflightEmitirPago(TENANT, LIQUIDACION_ID, usuarioConRol('conductor')),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });

  it('preflightEmitirFactura permite a dueño y administracion', async () => {
    usar(fixturesFactura());
    const r1 = await preflightEmitirFactura(TENANT, PERIODO_ID, usuarioConRol('dueno'));
    expect(r1.tipoAccion).toBe('emitir_factura');
    usar(fixturesFactura());
    const r2 = await preflightEmitirFactura(TENANT, PERIODO_ID, usuarioConRol('administracion'));
    expect(r2.tipoAccion).toBe('emitir_factura');
  });

  it('preflightEmitirPago permite a dueño y administracion', async () => {
    usar(fixturesPago());
    const r1 = await preflightEmitirPago(TENANT, LIQUIDACION_ID, usuarioConRol('dueno'));
    expect(r1.tipoAccion).toBe('emitir_pago');
    usar(fixturesPago());
    const r2 = await preflightEmitirPago(TENANT, LIQUIDACION_ID, usuarioConRol('administracion'));
    expect(r2.tipoAccion).toBe('emitir_pago');
  });
});

// =============================================================================
// preflightEmitirFactura
// =============================================================================

describe('preflightEmitirFactura', () => {
  it('caso feliz: ok=true, sin bloqueos, resumen cuadra (neto+iva=total)', async () => {
    usar(fixturesFactura());
    const r = await preflightEmitirFactura(TENANT, PERIODO_ID, usuarioConRol('dueno'));

    expect(r.ok).toBe(true);
    expect(r.bloqueos).toEqual([]);
    expect(r.resumen.tipoAccion).toBe('emitir_factura');
    if (r.resumen.tipoAccion === 'emitir_factura' || r.resumen.tipoAccion === 'emitir_nota_credito') {
      expect(r.resumen.netoClp).toBe(15000);
      expect(r.resumen.ivaClp).toBe(Math.round(15000 * 0.19));
      expect(r.resumen.netoClp + r.resumen.ivaClp).toBe(r.resumen.totalClp);
      expect(r.resumen.lineasIncluidas).toBe(2);
      expect(r.resumen.lineasAnuladas).toBe(0);
      expect(r.resumen.sellerNombre).toBe('Seller Uno SpA');
      expect(r.resumen.modoDte).toBe('sandbox');
    }
  });

  it('período no encontrado → ErrorValidacion', async () => {
    usar(fixturesFactura({ 'dinero.periodos_cobro': [] }));
    await expect(
      preflightEmitirFactura(TENANT, PERIODO_ID, usuarioConRol('dueno')),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('estado_invalido: período abierto → bloquea, NO en caso feliz', async () => {
    usar(
      fixturesFactura({
        'dinero.periodos_cobro': [
          { id: PERIODO_ID, tenant_id: TENANT, seller_id: SELLER_ID, estado: 'abierto', documento_dte_id: null },
        ],
      }),
    );
    const r = await preflightEmitirFactura(TENANT, PERIODO_ID, usuarioConRol('dueno'));
    expect(r.ok).toBe(false);
    expect(r.bloqueos.map((b) => b.codigo)).toContain('estado_invalido');

    usar(fixturesFactura());
    const feliz = await preflightEmitirFactura(TENANT, PERIODO_ID, usuarioConRol('dueno'));
    expect(feliz.bloqueos.map((b) => b.codigo)).not.toContain('estado_invalido');
  });

  it('documento_ya_existe: período ya facturado → bloquea (prioridad sobre estado_invalido)', async () => {
    usar(
      fixturesFactura({
        'dinero.periodos_cobro': [
          { id: PERIODO_ID, tenant_id: TENANT, seller_id: SELLER_ID, estado: 'facturado', documento_dte_id: 'dte-1' },
        ],
      }),
    );
    const r = await preflightEmitirFactura(TENANT, PERIODO_ID, usuarioConRol('dueno'));
    const codigos = r.bloqueos.map((b) => b.codigo);
    expect(codigos).toContain('documento_ya_existe');
    expect(codigos).not.toContain('estado_invalido');
  });

  it('rut_seller_incompleto: RUT ausente o con formato inválido → bloquea', async () => {
    usar(
      fixturesFactura({
        'identidad.sellers': [{ id: SELLER_ID, tenant_id: TENANT, razon_social: 'Seller Uno SpA', rut: null }],
      }),
    );
    const r = await preflightEmitirFactura(TENANT, PERIODO_ID, usuarioConRol('dueno'));
    expect(r.bloqueos.map((b) => b.codigo)).toContain('rut_seller_incompleto');

    usar(fixturesFactura());
    const feliz = await preflightEmitirFactura(TENANT, PERIODO_ID, usuarioConRol('dueno'));
    expect(feliz.bloqueos.map((b) => b.codigo)).not.toContain('rut_seller_incompleto');
  });

  it('folios_agotados: sin CAF vigente tipo 33 → bloquea', async () => {
    usar(fixturesFactura({ 'identidad.folios_caf': [] }));
    const r = await preflightEmitirFactura(TENANT, PERIODO_ID, usuarioConRol('dueno'));
    expect(r.ok).toBe(false);
    expect(r.bloqueos.map((b) => b.codigo)).toContain('folios_agotados');
  });

  it('folios_agotados: folio_actual SUPERÓ folio_hasta (rango realmente agotado) → bloquea', async () => {
    usar(
      fixturesFactura({
        'identidad.folios_caf': [
          { tenant_id: TENANT, tipo_documento: 33, estado: 'vigente', folio_actual: 201, folio_hasta: 200 },
        ],
      }),
    );
    const r = await preflightEmitirFactura(TENANT, PERIODO_ID, usuarioConRol('dueno'));
    expect(r.bloqueos.map((b) => b.codigo)).toContain('folios_agotados');
  });

  it('folio_actual === folio_hasta: queda exactamente 1 folio utilizable → NO bloquea (sync con reservarFolio)', async () => {
    // Regresión del fix QA jul 2026: `reservarFolio` (./folios.ts) SOLO lanza
    // ErrorFolioAgotado cuando folio_actual > folio_hasta (estrictamente) — si
    // son iguales, ese folio_actual es el ÚLTIMO folio válido y SÍ se reserva.
    // Antes del fix, `evaluarFolios` bloqueaba un folio antes de tiempo (falso
    // bloqueo): le decía al usuario "sin folios" cuando la emisión real
    // (job C3, vía `reservarFolio`) todavía la habría dejado pasar.
    usar(
      fixturesFactura({
        'identidad.folios_caf': [
          { tenant_id: TENANT, tipo_documento: 33, estado: 'vigente', folio_actual: 200, folio_hasta: 200 },
        ],
      }),
    );
    const r = await preflightEmitirFactura(TENANT, PERIODO_ID, usuarioConRol('dueno'));
    expect(r.bloqueos.map((b) => b.codigo)).not.toContain('folios_agotados');
    // Con solo 1 folio restante (bajo UMBRAL_FOLIOS=50), sí debe advertir.
    expect(r.advertencias.map((a) => a.codigo)).toContain('folios_bajos');
    const item = r.advertencias.find((a) => a.codigo === 'folios_bajos');
    expect(item?.meta?.restantes).toBe(1);
    expect(r.ok).toBe(true);
  });

  it('folios_bajos: restantes bajo el umbral → ADVIERTE, no bloquea', async () => {
    usar(
      fixturesFactura({
        'identidad.folios_caf': [
          { tenant_id: TENANT, tipo_documento: 33, estado: 'vigente', folio_actual: 190, folio_hasta: 200 },
        ],
      }),
    );
    const r = await preflightEmitirFactura(TENANT, PERIODO_ID, usuarioConRol('dueno'));
    expect(r.bloqueos.map((b) => b.codigo)).not.toContain('folios_agotados');
    expect(r.advertencias.map((b) => b.codigo)).toContain('folios_bajos');
    expect(r.ok).toBe(true);
  });

  it('opt_in_real_no_habilitado: plataforma en modo real sin opt-in del courier → bloquea', async () => {
    process.env.DTE_SANDBOX_MODE = 'false';
    usar(fixturesFactura({ 'identidad.courier_config_dte': [] }));
    const r = await preflightEmitirFactura(TENANT, PERIODO_ID, usuarioConRol('dueno'));
    expect(r.bloqueos.map((b) => b.codigo)).toContain('opt_in_real_no_habilitado');
    expect(r.resumen.tipoAccion === 'emitir_factura' && r.resumen.modoDte).toBe('sandbox');
  });

  it('opt_in_real_no_habilitado: NO se activa con el opt-in habilitado', async () => {
    process.env.DTE_SANDBOX_MODE = 'false';
    usar(
      fixturesFactura({
        'identidad.courier_config_dte': [{ tenant_id: TENANT, emision_dte_real_habilitada: true }],
      }),
    );
    const r = await preflightEmitirFactura(TENANT, PERIODO_ID, usuarioConRol('dueno'));
    expect(r.bloqueos.map((b) => b.codigo)).not.toContain('opt_in_real_no_habilitado');
    expect(r.resumen.tipoAccion === 'emitir_factura' && r.resumen.modoDte).toBe('real');
  });

  it('discrepancias_conciliacion: eventos pendientes del período → ADVIERTE', async () => {
    usar(
      fixturesFactura({
        'dinero.eventos_conciliacion': [
          { tenant_id: TENANT, periodo_cobro_id: PERIODO_ID, estado: 'pendiente', monto_diferencia_clp: 1234 },
        ],
      }),
    );
    const r = await preflightEmitirFactura(TENANT, PERIODO_ID, usuarioConRol('dueno'));
    const item = r.advertencias.find((a) => a.codigo === 'discrepancias_conciliacion');
    expect(item).toBeDefined();
    expect(item?.meta?.monto_diferencia_clp).toBe(1234);
    expect(r.ok).toBe(true);
  });

  it('incidencias_abiertas: incidencia abierta de un pedido incluido → ADVIERTE', async () => {
    usar(
      fixturesFactura({
        'operacion.incidencias': [{ tenant_id: TENANT, estado: 'abierta', pedido_id: 'pedido-1' }],
      }),
    );
    const r = await preflightEmitirFactura(TENANT, PERIODO_ID, usuarioConRol('dueno'));
    expect(r.advertencias.map((a) => a.codigo)).toContain('incidencias_abiertas');
    expect(r.ok).toBe(true);
  });

  it('lineas_anuladas_excluidas: líneas anuladas quedan fuera del total y se listan como informativo', async () => {
    usar(
      fixturesFactura({
        'dinero.lineas_cobro': [
          { tenant_id: TENANT, periodo_cobro_id: PERIODO_ID, pedido_id: 'pedido-1', monto_final_clp: 10000, anulada: false },
          { tenant_id: TENANT, periodo_cobro_id: PERIODO_ID, pedido_id: 'pedido-3', monto_final_clp: 9999, anulada: true, motivo_anulacion: 'devolucion' },
        ],
      }),
    );
    const r = await preflightEmitirFactura(TENANT, PERIODO_ID, usuarioConRol('dueno'));
    if (r.resumen.tipoAccion === 'emitir_factura') {
      expect(r.resumen.lineasIncluidas).toBe(1);
      expect(r.resumen.lineasAnuladas).toBe(1);
      expect(r.resumen.netoClp).toBe(10000); // el monto anulado NO se suma
    }
    const item = r.informativos.find((i) => i.codigo === 'lineas_anuladas_excluidas');
    expect(item).toBeDefined();
    expect(item?.detalle).toContain('devolucion');
  });

  it('bandeja_excepciones: un bloqueo del hook se agrega a bloqueos (cableado, hoy trivial)', async () => {
    usar(fixturesFactura());
    vi.mocked(bloqueaFacturacion).mockResolvedValueOnce({
      bloquea: true,
      motivos: [
        {
          codigo: 'bandeja_excepciones',
          categoria: 'bloquea',
          titulo: 'Excepción manual registrada',
        },
      ],
    });
    const r = await preflightEmitirFactura(TENANT, PERIODO_ID, usuarioConRol('dueno'));
    expect(r.ok).toBe(false);
    expect(r.bloqueos.map((b) => b.codigo)).toContain('bandeja_excepciones');
  });
});

// =============================================================================
// preflightEmitirNotaCredito
// =============================================================================

describe('preflightEmitirNotaCredito', () => {
  function fixturesNc(overrides: Partial<Tablas> = {}): Tablas {
    return fixturesFactura({
      'dinero.periodos_cobro': [
        { id: PERIODO_ID, tenant_id: TENANT, seller_id: SELLER_ID, estado: 'facturado', documento_dte_id: 'dte-33' },
      ],
      'dinero.documentos_dte': [
        { id: 'dte-33', tenant_id: TENANT, tipo_documento: 33, estado_sii: 'aceptado' },
      ],
      ...overrides,
    });
  }

  it('caso feliz: ok=true, resumen cuadra', async () => {
    usar(fixturesNc());
    const r = await preflightEmitirNotaCredito(TENANT, PERIODO_ID, usuarioConRol('dueno'));
    expect(r.ok).toBe(true);
    expect(r.resumen.tipoAccion).toBe('emitir_nota_credito');
    if (r.resumen.tipoAccion === 'emitir_nota_credito') {
      expect(r.resumen.netoClp + r.resumen.ivaClp).toBe(r.resumen.totalClp);
    }
  });

  it('estado_invalido: período no facturado → bloquea', async () => {
    usar(
      fixturesNc({
        'dinero.periodos_cobro': [
          { id: PERIODO_ID, tenant_id: TENANT, seller_id: SELLER_ID, estado: 'cerrado', documento_dte_id: null },
        ],
      }),
    );
    const r = await preflightEmitirNotaCredito(TENANT, PERIODO_ID, usuarioConRol('dueno'));
    expect(r.ok).toBe(false);
    expect(r.bloqueos.map((b) => b.codigo)).toContain('estado_invalido');
  });

  it('dte_rechazado_no_anulable: DTE 33 rechazado → bloquea', async () => {
    usar(
      fixturesNc({
        'dinero.documentos_dte': [{ id: 'dte-33', tenant_id: TENANT, tipo_documento: 33, estado_sii: 'rechazado' }],
      }),
    );
    const r = await preflightEmitirNotaCredito(TENANT, PERIODO_ID, usuarioConRol('dueno'));
    expect(r.bloqueos.map((b) => b.codigo)).toContain('dte_rechazado_no_anulable');
  });

  it('documento_ya_existe: ya existe una NC (61) referenciando la factura → bloquea', async () => {
    usar(
      fixturesNc({
        'dinero.documentos_dte': [
          { id: 'dte-33', tenant_id: TENANT, tipo_documento: 33, estado_sii: 'aceptado' },
          { id: 'dte-61', tenant_id: TENANT, tipo_documento: 61, dte_referencia_id: 'dte-33', folio: 42 },
        ],
      }),
    );
    const r = await preflightEmitirNotaCredito(TENANT, PERIODO_ID, usuarioConRol('dueno'));
    const item = r.bloqueos.find((b) => b.codigo === 'documento_ya_existe');
    expect(item).toBeDefined();
    expect(item?.meta?.folio).toBe(42);
  });

  it('folios_agotados: sin CAF vigente tipo 61 → bloquea (independiente del CAF 33)', async () => {
    usar(
      fixturesNc({
        'identidad.folios_caf': [
          { tenant_id: TENANT, tipo_documento: 33, estado: 'vigente', folio_actual: 10, folio_hasta: 200 },
        ],
      }),
    );
    const r = await preflightEmitirNotaCredito(TENANT, PERIODO_ID, usuarioConRol('dueno'));
    expect(r.bloqueos.map((b) => b.codigo)).toContain('folios_agotados');
  });
});

// =============================================================================
// preflightEmitirPago
// =============================================================================

describe('preflightEmitirPago', () => {
  it('caso feliz: ok=true, resumen cuadra (bruto-retención=líquido)', async () => {
    usar(fixturesPago());
    const r = await preflightEmitirPago(TENANT, LIQUIDACION_ID, usuarioConRol('dueno'));
    expect(r.ok).toBe(true);
    expect(r.resumen.tipoAccion).toBe('emitir_pago');
    if (r.resumen.tipoAccion === 'emitir_pago') {
      expect(r.resumen.montoBrutoClp).toBe(100000);
      expect(r.resumen.montoRetencionClp).toBe(10000); // 10% de retención
      expect(r.resumen.montoLiquidoClp).toBe(90000);
      expect(r.resumen.montoBrutoClp - r.resumen.montoRetencionClp).toBe(r.resumen.montoLiquidoClp);
      expect(r.resumen.conductorNombre).toBe('Pedro Conductor');
      expect(r.resumen.lineasIncluidas).toBe(2);
      expect(r.resumen.lineasAnuladas).toBe(0);
    }
  });

  it('liquidación no encontrada → ErrorValidacion', async () => {
    usar(fixturesPago({ 'dinero.liquidaciones': [] }));
    await expect(
      preflightEmitirPago(TENANT, LIQUIDACION_ID, usuarioConRol('dueno')),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('estado_invalido: liquidación no está emitida → bloquea', async () => {
    usar(
      fixturesPago({
        'dinero.liquidaciones': [
          { id: LIQUIDACION_ID, tenant_id: TENANT, driver_id: DRIVER_ID, estado: 'borrador', monto_total_clp: 100000, bono_clp: 0, penalizacion_clp: 0, tipo_relacion_conductor: 'independiente' },
        ],
      }),
    );
    const r = await preflightEmitirPago(TENANT, LIQUIDACION_ID, usuarioConRol('dueno'));
    expect(r.ok).toBe(false);
    expect(r.bloqueos.map((b) => b.codigo)).toContain('estado_invalido');
  });

  it('cuenta_bancaria_incompleta: falta el banco → bloquea, con número enmascarado en meta', async () => {
    usar(
      fixturesPago({
        'identidad.conductores': [
          { id: DRIVER_ID, tenant_id: TENANT, nombre_completo: 'Pedro Conductor', rut: '12345678-9', banco: null, tipo_cuenta: 'vista', numero_cuenta: '1234567890', tipo_relacion: 'independiente' },
        ],
      }),
    );
    const r = await preflightEmitirPago(TENANT, LIQUIDACION_ID, usuarioConRol('dueno'));
    const item = r.bloqueos.find((b) => b.codigo === 'cuenta_bancaria_incompleta');
    expect(item).toBeDefined();
    expect(item?.meta?.numero_cuenta_mascara).toBe('****7890');
    // Nunca el número completo en el resultado.
    expect(JSON.stringify(r)).not.toContain('1234567890');
  });

  it('monto_no_positivo: penalización supera el bruto → bloquea', async () => {
    usar(
      fixturesPago({
        'dinero.liquidaciones': [
          { id: LIQUIDACION_ID, tenant_id: TENANT, driver_id: DRIVER_ID, estado: 'emitida', monto_total_clp: 1000, bono_clp: 0, penalizacion_clp: 2000, tipo_relacion_conductor: 'independiente' },
        ],
        'identidad.courier_config_payout': [{ tenant_id: TENANT, porcentaje_retencion: 0, minimo_retiro_clp: 0 }],
      }),
    );
    const r = await preflightEmitirPago(TENANT, LIQUIDACION_ID, usuarioConRol('dueno'));
    expect(r.bloqueos.map((b) => b.codigo)).toContain('monto_no_positivo');
  });

  it('monto_bajo_minimo_retiro: líquido positivo pero bajo el mínimo configurado → bloquea', async () => {
    usar(
      fixturesPago({
        'dinero.liquidaciones': [
          { id: LIQUIDACION_ID, tenant_id: TENANT, driver_id: DRIVER_ID, estado: 'emitida', monto_total_clp: 10000, bono_clp: 0, penalizacion_clp: 0, tipo_relacion_conductor: 'independiente' },
        ],
        'identidad.courier_config_payout': [{ tenant_id: TENANT, porcentaje_retencion: 0, minimo_retiro_clp: 50000 }],
      }),
    );
    const r = await preflightEmitirPago(TENANT, LIQUIDACION_ID, usuarioConRol('dueno'));
    const codigos = r.bloqueos.map((b) => b.codigo);
    expect(codigos).toContain('monto_bajo_minimo_retiro');
    expect(codigos).not.toContain('monto_no_positivo');
  });

  it('dependiente: la retención NO se aplica aunque el courier tenga % configurado', async () => {
    usar(
      fixturesPago({
        'dinero.liquidaciones': [
          { id: LIQUIDACION_ID, tenant_id: TENANT, driver_id: DRIVER_ID, estado: 'emitida', monto_total_clp: 100000, bono_clp: 0, penalizacion_clp: 0, tipo_relacion_conductor: 'dependiente' },
        ],
        'identidad.conductores': [
          { id: DRIVER_ID, tenant_id: TENANT, nombre_completo: 'Pedro Conductor', rut: '12345678-9', banco: 'banco_estado', tipo_cuenta: 'vista', numero_cuenta: '1234567890', tipo_relacion: 'dependiente' },
        ],
      }),
    );
    const r = await preflightEmitirPago(TENANT, LIQUIDACION_ID, usuarioConRol('dueno'));
    if (r.resumen.tipoAccion === 'emitir_pago') {
      expect(r.resumen.montoRetencionClp).toBe(0);
      expect(r.resumen.montoLiquidoClp).toBe(100000);
    }
  });

  it('discrepancias_conciliacion e incidencias_abiertas acotadas a la liquidación → ADVIERTE', async () => {
    usar(
      fixturesPago({
        'dinero.eventos_conciliacion': [
          { tenant_id: TENANT, liquidacion_id: LIQUIDACION_ID, estado: 'pendiente', monto_diferencia_clp: 500 },
        ],
        'operacion.incidencias': [{ tenant_id: TENANT, estado: 'abierta', pedido_id: 'pedido-2' }],
      }),
    );
    const r = await preflightEmitirPago(TENANT, LIQUIDACION_ID, usuarioConRol('dueno'));
    expect(r.advertencias.map((a) => a.codigo)).toEqual(
      expect.arrayContaining(['discrepancias_conciliacion', 'incidencias_abiertas']),
    );
    expect(r.ok).toBe(true);
  });

  it('bandeja_excepciones: un bloqueo del hook de pago se agrega a bloqueos', async () => {
    usar(fixturesPago());
    vi.mocked(bloqueaPago).mockResolvedValueOnce({
      bloquea: true,
      motivos: [{ codigo: 'bandeja_excepciones', categoria: 'bloquea', titulo: 'Excepción manual de pago' }],
    });
    const r = await preflightEmitirPago(TENANT, LIQUIDACION_ID, usuarioConRol('dueno'));
    expect(r.ok).toBe(false);
    expect(r.bloqueos.map((b) => b.codigo)).toContain('bandeja_excepciones');
  });
});

/**
 * Regresión del truncamiento silencioso de PostgREST en las cifras de dinero.
 *
 * Hallado el 2026-08-05 con el fixture de carga a escala del piloto: las
 * lecturas de líneas por período iban SIN paginar, y PostgREST corta en
 * `max_rows` (1000) sin devolver error. Un período con 1.365 líneas sumaba
 * $4.681.000 en la base y se mostraba —y se facturaba— como $3.420.800.
 *
 * Lo que lo hacía indetectable es que todos los caminos truncaban igual: el
 * total del período, el del DTE y el del preflight coincidían entre sí, así que
 * la conciliación no encontraba nada y la persona que aprueba la emisión veía
 * una cifra plausible y equivocada. Y el DTE es irreversible ante el SII.
 *
 * El número 1.365 no es decorativo: está justo sobre el techo, que es donde el
 * bug vive. Con 999 líneas este test pasaría aun con el código roto.
 */
describe('preflight — cifras completas por sobre el techo de PostgREST', () => {
  const LINEAS = 1365;
  const MONTO = 3429;

  it('suma TODAS las líneas de un período con más de 1.000, no las primeras 1.000', async () => {
    const lineas = Array.from({ length: LINEAS }, (_, i) => ({
      tenant_id: TENANT,
      periodo_cobro_id: PERIODO_ID,
      pedido_id: `pedido-${i}`,
      monto_final_clp: MONTO,
      anulada: false,
    }));

    usar(fixturesFactura({ 'dinero.lineas_cobro': lineas }));

    const r = await preflightEmitirFactura(TENANT, PERIODO_ID, usuarioConRol('dueno'));

    const resumen = r.resumen as { lineasIncluidas: number; netoClp: number };
    expect(resumen.lineasIncluidas).toBe(LINEAS);
    expect(resumen.netoClp).toBe(LINEAS * MONTO);
    // Y explícitamente: NO se quedó en el techo.
    expect(resumen.lineasIncluidas).toBeGreaterThan(1000);
  });
});
