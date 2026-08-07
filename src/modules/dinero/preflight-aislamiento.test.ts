/**
 * Aislamiento multi-tenant de `preflight.ts` — QA jul 2026.
 *
 * `preflight.ts` usa `crearClienteServiceRole()` (bypassa RLS) en las 3
 * funciones (`preflightEmitirFactura`, `preflightEmitirNotaCredito`,
 * `preflightEmitirPago`). Sin RLS de por medio, la ÚNICA barrera contra una
 * fuga cross-tenant es que CADA query dentro de esas funciones incluya
 * `.eq('tenant_id', tenantId)` explícito.
 *
 * Este archivo NO vuelve a probar la lógica de negocio (ya cubierta en
 * `preflight.test.ts`) — solo siembra, para cada tabla que preflight.ts lee,
 * una fila "señuelo" de OTRO tenant que coincide en todos los demás campos
 * (mismo `periodo_cobro_id` / `liquidacion_id` / `pedido_id` / `id` de
 * seller/conductor) y confirma que esa fila señuelo NUNCA contamina el
 * resultado del tenant real. Es el mismo patrón de bug que el hallazgo de
 * confidencialidad del proyecto hermano "snapshot de reglas" (un filtro de
 * tenant faltante en una sola query) — aquí como guardia de regresión.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UsuarioActual } from '@/modules/identidad/usuario-actual';

vi.mock('@/lib/supabase/service-role', () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock('@/modules/dinero/excepciones', () => ({
  bloqueaFacturacion: vi.fn().mockResolvedValue({ bloquea: false, motivos: [] }),
  bloqueaPago: vi.fn().mockResolvedValue({ bloquea: false, motivos: [] }),
}));

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { preflightEmitirFactura, preflightEmitirNotaCredito, preflightEmitirPago } from './preflight';

// =============================================================================
// Fake Supabase multi-tabla — idéntico en espíritu al de `preflight.test.ts`,
// pero aquí el foco es sembrar filas señuelo de otro tenant con las MISMAS
// claves de negocio (periodo/liquidación/pedido/seller/conductor) para que
// una query sin `.eq('tenant_id', …)` las capturaría por error.
// =============================================================================

type Fila = Record<string, unknown>;
type Tablas = Record<string, Fila[]>;

function crearFakeSupabase(tablas: Tablas) {
  function construirBuilder(
    filas: Fila[],
    filtros: Array<(f: Fila) => boolean>,
    rango?: { desde: number; hasta: number },
  ) {
    // `.range()` real, no no-op: `leerTodasLasFilas` para cuando recibe una página
    // incompleta, así que un doble que devolviera siempre todo no terminaría.
    const aplicarFiltros = () => {
      const filtradas = filas.filter((f) => filtros.every((fn) => fn(f)));
      return rango ? filtradas.slice(rango.desde, rango.hasta + 1) : filtradas;
    };
    const builder = {
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

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b-atacante';
const PERIODO_ID = 'periodo-compartido';
const SELLER_ID = 'seller-compartido';
const LIQUIDACION_ID = 'liq-compartida';
const DRIVER_ID = 'driver-compartido';

function dueno(tenantId: string): UsuarioActual {
  return {
    tenantId,
    tipoUsuario: 'interno',
    sellerId: null,
    driverId: null,
    rol: 'dueno',
    estado: 'activo',
  };
}

function usar(tablas: Tablas) {
  vi.mocked(crearClienteServiceRole).mockReturnValue(
    crearFakeSupabase(tablas) as unknown as ReturnType<typeof crearClienteServiceRole>,
  );
}

beforeEach(() => {
  vi.mocked(crearClienteServiceRole).mockReset();
});

// =============================================================================
// preflightEmitirFactura / preflightEmitirNotaCredito — señuelos de tenant B
// =============================================================================

describe('preflightEmitirFactura — aislamiento cross-tenant', () => {
  function tablasConSenuelo(): Tablas {
    return {
      'dinero.periodos_cobro': [
        { id: PERIODO_ID, tenant_id: TENANT_A, seller_id: SELLER_ID, estado: 'cerrado', documento_dte_id: null },
        // Señuelo: mismo id de período pero de OTRO tenant, estado distinto —
        // si la query de período no filtrara por tenant_id, el `.maybeSingle()`
        // podría devolver esta fila en vez de la de tenant-a.
        { id: PERIODO_ID, tenant_id: TENANT_B, seller_id: SELLER_ID, estado: 'abierto', documento_dte_id: null },
      ],
      'identidad.sellers': [
        { id: SELLER_ID, tenant_id: TENANT_A, razon_social: 'Seller Legítimo SpA', rut: '76123456-7' },
        // Señuelo: mismo id de seller, otro tenant, RUT inválido — si la query
        // de seller no filtrara por tenant, el preflight bloquearía por
        // rut_seller_incompleto usando el RUT del tenant equivocado.
        { id: SELLER_ID, tenant_id: TENANT_B, razon_social: 'Seller Atacante', rut: null },
      ],
      'identidad.folios_caf': [
        { tenant_id: TENANT_A, tipo_documento: 33, estado: 'vigente', folio_actual: 10, folio_hasta: 200 },
        { tenant_id: TENANT_A, tipo_documento: 61, estado: 'vigente', folio_actual: 5, folio_hasta: 200 },
        // Señuelo: CAF agotado de otro tenant — si la query no filtrara por
        // tenant, podría reportar folios_agotados usando el CAF ajeno.
        { tenant_id: TENANT_B, tipo_documento: 33, estado: 'vigente', folio_actual: 200, folio_hasta: 200 },
      ],
      'dinero.lineas_cobro': [
        { tenant_id: TENANT_A, periodo_cobro_id: PERIODO_ID, pedido_id: 'pedido-a1', monto_final_clp: 10000, anulada: false },
        { tenant_id: TENANT_A, periodo_cobro_id: PERIODO_ID, pedido_id: 'pedido-a2', monto_final_clp: 5000, anulada: false },
        // Señuelo: mismo periodo_cobro_id, OTRO tenant, monto grande — si la
        // suma no filtrara por tenant_id, el neto incluiría este monto ajeno.
        { tenant_id: TENANT_B, periodo_cobro_id: PERIODO_ID, pedido_id: 'pedido-b1', monto_final_clp: 999999, anulada: false },
      ],
      'dinero.eventos_conciliacion': [
        // Señuelo: discrepancia de otro tenant sobre el mismo período.
        { tenant_id: TENANT_B, periodo_cobro_id: PERIODO_ID, estado: 'pendiente', monto_diferencia_clp: 777777 },
      ],
      'operacion.incidencias': [
        // Señuelo: incidencia abierta de otro tenant sobre el mismo pedido.
        { tenant_id: TENANT_B, estado: 'abierta', pedido_id: 'pedido-a1' },
      ],
      'identidad.courier_config_dte': [],
      'dinero.documentos_dte': [],
    };
  }

  it('el resumen SOLO suma las líneas del tenant real (el señuelo de tenant-b queda fuera)', async () => {
    usar(tablasConSenuelo());
    const r = await preflightEmitirFactura(TENANT_A, PERIODO_ID, dueno(TENANT_A));

    expect(r.resumen.tipoAccion).toBe('emitir_factura');
    if (r.resumen.tipoAccion === 'emitir_factura') {
      expect(r.resumen.lineasIncluidas).toBe(2);
      expect(r.resumen.netoClp).toBe(15000); // NO 999999 + 15000
      expect(r.resumen.sellerNombre).toBe('Seller Legítimo SpA');
    }
    expect(r.ok).toBe(true);
    expect(r.bloqueos).toEqual([]);
  });

  it('folios_agotados se evalúa con el CAF del tenant real, no el del señuelo', async () => {
    usar(tablasConSenuelo());
    const r = await preflightEmitirFactura(TENANT_A, PERIODO_ID, dueno(TENANT_A));
    // El CAF de tenant-a tiene 190 folios restantes (holgado) — el señuelo
    // agotado de tenant-b NO debe filtrar como si fuera el CAF real.
    expect(r.bloqueos.map((b) => b.codigo)).not.toContain('folios_agotados');
  });

  it('las advertencias de conciliación/incidencias del tenant-b NUNCA aparecen para tenant-a', async () => {
    usar(tablasConSenuelo());
    const r = await preflightEmitirFactura(TENANT_A, PERIODO_ID, dueno(TENANT_A));
    expect(r.advertencias.map((a) => a.codigo)).not.toContain('discrepancias_conciliacion');
    expect(r.advertencias.map((a) => a.codigo)).not.toContain('incidencias_abiertas');
  });

  it('llamado con tenantId=tenant-b ve SU PROPIO período (abierto) y sus propias líneas, nunca las de tenant-a', async () => {
    usar(tablasConSenuelo());
    const r = await preflightEmitirFactura(TENANT_B, PERIODO_ID, dueno(TENANT_B));
    expect(r.bloqueos.map((b) => b.codigo)).toContain('estado_invalido'); // el de tenant-b está 'abierto'
    if (r.resumen.tipoAccion === 'emitir_factura') {
      expect(r.resumen.netoClp).toBe(999999); // solo la línea de tenant-b
      expect(r.resumen.sellerNombre).toBe('Seller Atacante');
    }
  });
});

describe('preflightEmitirNotaCredito — aislamiento cross-tenant', () => {
  it('el DTE 33 a anular se resuelve SOLO dentro del tenant (señuelo de otro tenant con mismo documento_dte_id ignorado)', async () => {
    const DTE33 = 'dte-compartido';
    usar({
      'dinero.periodos_cobro': [
        { id: PERIODO_ID, tenant_id: TENANT_A, seller_id: SELLER_ID, estado: 'facturado', documento_dte_id: DTE33 },
      ],
      'identidad.sellers': [
        { id: SELLER_ID, tenant_id: TENANT_A, razon_social: 'Seller Legítimo SpA', rut: '76123456-7' },
      ],
      'dinero.documentos_dte': [
        { id: DTE33, tenant_id: TENANT_A, tipo_documento: 33, estado_sii: 'aceptado' },
        // Señuelo: mismo id de documento, otro tenant, estado 'rechazado' — si
        // la query no filtrara por tenant, bloquearía con dte_rechazado_no_anulable.
        { id: DTE33, tenant_id: TENANT_B, tipo_documento: 33, estado_sii: 'rechazado' },
      ],
      'identidad.folios_caf': [
        { tenant_id: TENANT_A, tipo_documento: 61, estado: 'vigente', folio_actual: 5, folio_hasta: 200 },
      ],
      'dinero.lineas_cobro': [
        { tenant_id: TENANT_A, periodo_cobro_id: PERIODO_ID, pedido_id: 'pedido-a1', monto_final_clp: 10000, anulada: false },
      ],
      'dinero.eventos_conciliacion': [],
      'operacion.incidencias': [],
      'identidad.courier_config_dte': [],
    });

    const r = await preflightEmitirNotaCredito(TENANT_A, PERIODO_ID, dueno(TENANT_A));
    expect(r.bloqueos.map((b) => b.codigo)).not.toContain('dte_rechazado_no_anulable');
    expect(r.ok).toBe(true);
  });
});

// =============================================================================
// preflightEmitirPago — señuelos de tenant B
// =============================================================================

describe('preflightEmitirPago — aislamiento cross-tenant', () => {
  function tablasConSenuelo(): Tablas {
    return {
      'dinero.liquidaciones': [
        {
          id: LIQUIDACION_ID,
          tenant_id: TENANT_A,
          driver_id: DRIVER_ID,
          estado: 'emitida',
          monto_total_clp: 100000,
          bono_clp: 0,
          penalizacion_clp: 0,
          tipo_relacion_conductor: 'independiente',
        },
        // Señuelo: misma liquidación id, otro tenant, otro estado.
        {
          id: LIQUIDACION_ID,
          tenant_id: TENANT_B,
          driver_id: 'driver-atacante',
          estado: 'borrador',
          monto_total_clp: 1,
          bono_clp: 0,
          penalizacion_clp: 0,
          tipo_relacion_conductor: 'independiente',
        },
      ],
      'identidad.conductores': [
        {
          id: DRIVER_ID,
          tenant_id: TENANT_A,
          nombre_completo: 'Pedro Conductor Real',
          rut: '12345678-9',
          banco: 'banco_estado',
          tipo_cuenta: 'vista',
          numero_cuenta: '1234567890',
          tipo_relacion: 'independiente',
        },
        // Señuelo: mismo driver_id, otro tenant, SIN datos bancarios — si la
        // query no filtrara por tenant, bloquearía por cuenta_bancaria_incompleta
        // usando el conductor equivocado, o expondría su nombre.
        {
          id: DRIVER_ID,
          tenant_id: TENANT_B,
          nombre_completo: 'Conductor Atacante',
          rut: '98765432-1',
          banco: null,
          tipo_cuenta: null,
          numero_cuenta: null,
          tipo_relacion: 'independiente',
        },
      ],
      'identidad.courier_config_payout': [
        { tenant_id: TENANT_A, porcentaje_retencion: 10, minimo_retiro_clp: 0 },
        // Señuelo: config de otro tenant con mínimo altísimo.
        { tenant_id: TENANT_B, porcentaje_retencion: 0, minimo_retiro_clp: 999999999 },
      ],
      'dinero.lineas_liquidacion': [
        { tenant_id: TENANT_A, liquidacion_id: LIQUIDACION_ID, pedido_id: 'pedido-a1', anulada: false },
        // Señuelo: misma liquidacion_id, otro tenant.
        { tenant_id: TENANT_B, liquidacion_id: LIQUIDACION_ID, pedido_id: 'pedido-b1', anulada: false },
      ],
      'dinero.eventos_conciliacion': [
        { tenant_id: TENANT_B, liquidacion_id: LIQUIDACION_ID, estado: 'pendiente', monto_diferencia_clp: 555 },
      ],
      'operacion.incidencias': [
        { tenant_id: TENANT_B, estado: 'abierta', pedido_id: 'pedido-a1' },
      ],
    };
  }

  it('usa el conductor y la config del tenant real — no bloquea por datos del señuelo', async () => {
    usar(tablasConSenuelo());
    const r = await preflightEmitirPago(TENANT_A, LIQUIDACION_ID, dueno(TENANT_A));
    expect(r.ok).toBe(true);
    expect(r.bloqueos.map((b) => b.codigo)).not.toContain('cuenta_bancaria_incompleta');
    expect(r.bloqueos.map((b) => b.codigo)).not.toContain('monto_bajo_minimo_retiro');
    if (r.resumen.tipoAccion === 'emitir_pago') {
      expect(r.resumen.conductorNombre).toBe('Pedro Conductor Real');
      expect(r.resumen.lineasIncluidas).toBe(1); // no la línea señuelo de tenant-b
    }
  });

  it('nunca expone el nombre ni datos del conductor señuelo de otro tenant', async () => {
    usar(tablasConSenuelo());
    const r = await preflightEmitirPago(TENANT_A, LIQUIDACION_ID, dueno(TENANT_A));
    const crudo = JSON.stringify(r);
    expect(crudo).not.toContain('Conductor Atacante');
    expect(crudo).not.toContain('98765432-1');
  });

  it('las advertencias de conciliación/incidencias del tenant-b no contaminan el preflight de tenant-a', async () => {
    usar(tablasConSenuelo());
    const r = await preflightEmitirPago(TENANT_A, LIQUIDACION_ID, dueno(TENANT_A));
    expect(r.advertencias.map((a) => a.codigo)).not.toContain('discrepancias_conciliacion');
    expect(r.advertencias.map((a) => a.codigo)).not.toContain('incidencias_abiertas');
  });
});
