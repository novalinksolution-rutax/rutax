/**
 * Tests de humo de `consultas.ts` — trazabilidad financiera bidireccional
 * pedido→dinero (auditoría externa jul 2026, §1.1 P1).
 *
 * Cubre:
 * - `obtenerPayoutPorLiquidacion`: mapea la fila, respeta el aislamiento por
 *   tenant, y devuelve `null` cuando no hay payout todavía.
 * - `obtenerTrazaDineroPorPedido`: smoke test del lazo completo — snapshot de
 *   regla, soft-anulación, pagos recibidos del período, eventos de
 *   conciliación del pedido y el payout de la liquidación — todo en un solo
 *   objeto. No es exhaustivo (QA cubre casos de borde por separado); solo
 *   verifica que el nuevo contrato se arma correctamente.
 *
 * No se mockea `crearClienteServiceRole`: estas funciones reciben el cliente
 * Supabase como parámetro, así que se les pasa el fake directamente.
 */

import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  obtenerPayoutPorLiquidacion,
  obtenerTrazaDineroPorPedido,
  listarEventosConciliacion,
  listarHistorialEventoConciliacion,
} from './consultas';

// =============================================================================
// Fake Supabase multi-tabla — enruta por `${schema}.${tabla}` a un fixture.
// Mismo espíritu que el mock generalizado de `preflight.test.ts`.
// =============================================================================

type Fila = Record<string, unknown>;
type Tablas = Record<string, Fila[]>;

interface FakeBuilder {
  eq(col: string, val: unknown): FakeBuilder;
  in(col: string, vals: unknown[]): FakeBuilder;
  or(expr: string): FakeBuilder;
  order(): FakeBuilder;
  limit(): FakeBuilder;
  maybeSingle(): Promise<{ data: Fila | null; error: null }>;
  then(
    resolve: (v: { data: Fila[]; error: null }) => unknown,
    reject?: (e: unknown) => unknown,
  ): Promise<unknown>;
}

function crearFakeSupabase(tablas: Tablas) {
  function construirBuilder(filas: Fila[], filtros: Array<(f: Fila) => boolean>): FakeBuilder {
    const aplicarFiltros = () => filas.filter((f) => filtros.every((fn) => fn(f)));
    const builder: FakeBuilder = {
      eq(col: string, val: unknown) {
        return construirBuilder(filas, [...filtros, (f: Fila) => f[col] === val]);
      },
      in(col: string, vals: unknown[]) {
        return construirBuilder(filas, [...filtros, (f: Fila) => vals.includes(f[col] as never)]);
      },
      or(expr: string) {
        // `expr` viene con la forma "colA.eq.true,colB.eq.true" (semántica OR de
        // PostgREST) — interpretado igual que el mock de `excepciones.test.ts`.
        const condiciones = expr.split(',').map((cond) => {
          const [col, , ...resto] = cond.split('.');
          const valorTexto = resto.join('.');
          return (f: Fila) => String(f[col]) === valorTexto;
        });
        return construirBuilder(filas, [...filtros, (f: Fila) => condiciones.some((fn) => fn(f))]);
      },
      order() {
        return builder;
      },
      limit() {
        return builder;
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
  } as unknown as SupabaseClient;
}

const TENANT = 'tenant-a';
const OTRO_TENANT = 'tenant-b';

// =============================================================================
// obtenerPayoutPorLiquidacion
// =============================================================================

describe('obtenerPayoutPorLiquidacion', () => {
  it('devuelve el payout mapeado cuando existe', async () => {
    const cliente = crearFakeSupabase({
      'dinero.payouts_conductor': [
        {
          id: 'payout-1',
          tenant_id: TENANT,
          driver_id: 'driver-1',
          liquidacion_id: 'liq-1',
          monto_bruto_clp: 100000,
          monto_retencion_clp: 10000,
          monto_liquido_clp: 90000,
          tipo_relacion_conductor: 'independiente',
          metodo: 'manual',
          estado: 'enviado',
          payout_externo_id: null,
          comprobante_ref: null,
          error_descripcion: null,
          solicitado_por_usuario_id: 'u-1',
          solicitado_en: '2026-07-01T00:00:00Z',
          confirmado_en: null,
          creado_en: '2026-07-01T00:00:00Z',
          actualizado_en: '2026-07-01T00:00:00Z',
        },
      ],
    });

    const payout = await obtenerPayoutPorLiquidacion(cliente, TENANT, 'liq-1');

    expect(payout).not.toBeNull();
    expect(payout?.estado).toBe('enviado');
    expect(payout?.montoLiquidoClp).toBe(90000);
    expect(payout?.montoBrutoClp).toBe(100000);
    expect(payout?.montoRetencionClp).toBe(10000);
  });

  it('devuelve null si la liquidación no tiene payout todavía', async () => {
    const cliente = crearFakeSupabase({ 'dinero.payouts_conductor': [] });
    const payout = await obtenerPayoutPorLiquidacion(cliente, TENANT, 'liq-sin-payout');
    expect(payout).toBeNull();
  });

  it('respeta el aislamiento por tenant: no devuelve el payout de otro tenant', async () => {
    const cliente = crearFakeSupabase({
      'dinero.payouts_conductor': [
        {
          id: 'payout-otro-tenant',
          tenant_id: OTRO_TENANT,
          driver_id: 'driver-x',
          liquidacion_id: 'liq-compartida',
          monto_bruto_clp: 50000,
          monto_retencion_clp: 0,
          monto_liquido_clp: 50000,
          tipo_relacion_conductor: 'dependiente',
          metodo: 'manual',
          estado: 'confirmado',
          payout_externo_id: null,
          comprobante_ref: null,
          error_descripcion: null,
          solicitado_por_usuario_id: null,
          solicitado_en: '2026-07-01T00:00:00Z',
          confirmado_en: '2026-07-02T00:00:00Z',
          creado_en: '2026-07-01T00:00:00Z',
          actualizado_en: '2026-07-02T00:00:00Z',
        },
      ],
    });

    const payout = await obtenerPayoutPorLiquidacion(cliente, TENANT, 'liq-compartida');
    expect(payout).toBeNull();
  });
});

// =============================================================================
// obtenerTrazaDineroPorPedido — smoke test del lazo completo
// =============================================================================

describe('obtenerTrazaDineroPorPedido', () => {
  it('arma el lazo completo: snapshot de regla, pagos, conciliación y payout', async () => {
    const cliente = crearFakeSupabase({
      'dinero.lineas_cobro': [
        {
          tenant_id: TENANT,
          pedido_id: 'pedido-1',
          monto_final_clp: 5000,
          periodo_cobro_id: 'periodo-1',
          snapshot_regla: { tarifaBaseClp: 5000, zona: 'centro' },
          anulada: false,
          motivo_anulacion: null,
        },
      ],
      'dinero.lineas_liquidacion': [
        {
          tenant_id: TENANT,
          pedido_id: 'pedido-1',
          monto_final_clp: 3000,
          liquidacion_id: 'liq-1',
          snapshot_regla: { tarifaConductorClp: 3000 },
          anulada: false,
          motivo_anulacion: null,
        },
      ],
      'dinero.periodos_cobro': [
        {
          id: 'periodo-1',
          tenant_id: TENANT,
          estado: 'facturado',
          estado_cobro: 'pagado',
          documento_dte_id: 'dte-1',
        },
      ],
      'dinero.documentos_dte': [
        {
          id: 'dte-1',
          tenant_id: TENANT,
          folio: 42,
          estado_sii: 'aceptado',
          tipo_documento: 33,
        },
      ],
      'dinero.liquidaciones': [
        { id: 'liq-1', tenant_id: TENANT, estado: 'pagada' },
      ],
      'dinero.pagos_recibidos': [
        {
          id: 'pago-1',
          tenant_id: TENANT,
          seller_id: 'seller-1',
          periodo_cobro_id: 'periodo-1',
          movimiento_externo_id: 'mov-1',
          monto_clp: 5000,
          fecha_movimiento: '2026-07-05',
          contraparte_rut_normalizado: null,
          contraparte_nombre: null,
          estado_match: 'conciliado',
          atribuido_por_usuario_id: null,
          atribuido_en: null,
          creado_en: '2026-07-05T00:00:00Z',
          actualizado_en: '2026-07-05T00:00:00Z',
        },
      ],
      'dinero.eventos_conciliacion': [
        {
          id: 'evento-1',
          tenant_id: TENANT,
          seller_id: 'seller-1',
          periodo_cobro_id: 'periodo-1',
          tipo_diferencia: 'monto_dte_difiere_de_lineas',
          pedido_id: 'pedido-1',
          descripcion: 'Diferencia de prueba',
          monto_diferencia_clp: 100,
          estado: 'pendiente',
          resuelto_por_usuario_id: null,
          resuelto_en: null,
          job_run_id: null,
          driver_id: null,
          liquidacion_id: null,
          creado_en: '2026-07-06T00:00:00Z',
        },
      ],
      'dinero.payouts_conductor': [
        {
          id: 'payout-1',
          tenant_id: TENANT,
          driver_id: 'driver-1',
          liquidacion_id: 'liq-1',
          monto_bruto_clp: 3000,
          monto_retencion_clp: 0,
          monto_liquido_clp: 3000,
          tipo_relacion_conductor: 'independiente',
          metodo: 'manual',
          estado: 'confirmado',
          payout_externo_id: null,
          comprobante_ref: null,
          error_descripcion: null,
          solicitado_por_usuario_id: 'u-1',
          solicitado_en: '2026-07-06T00:00:00Z',
          confirmado_en: '2026-07-07T00:00:00Z',
          creado_en: '2026-07-06T00:00:00Z',
          actualizado_en: '2026-07-07T00:00:00Z',
        },
      ],
    });

    const traza = await obtenerTrazaDineroPorPedido(cliente, TENANT, 'pedido-1');

    // Cobro: monto + snapshot + soft-anulación.
    expect(traza.cobro).toEqual({
      montoFinalClp: 5000,
      snapshotRegla: { tarifaBaseClp: 5000, zona: 'centro' },
      anulada: false,
      motivoAnulacion: null,
    });

    // Período + factura.
    expect(traza.periodo).toEqual({ id: 'periodo-1', estado: 'facturado', estadoCobro: 'pagado' });
    expect(traza.factura).toEqual({ folio: 42, estadoSii: 'aceptado' });

    // Liquidación: monto + snapshot + soft-anulación.
    expect(traza.liquidacion).toEqual({
      id: 'liq-1',
      estado: 'pagada',
      montoFinalClp: 3000,
      snapshotRegla: { tarifaConductorClp: 3000 },
      anulada: false,
      motivoAnulacion: null,
    });

    // Pagos recibidos del período de este pedido.
    expect(traza.pagosRecibidos).toHaveLength(1);
    expect(traza.pagosRecibidos[0].id).toBe('pago-1');

    // Conciliación: evento propio del pedido + evaluada=true (hay evento).
    expect(traza.conciliacion.evaluada).toBe(true);
    expect(traza.conciliacion.eventos).toHaveLength(1);
    expect(traza.conciliacion.eventos[0].pedidoId).toBe('pedido-1');

    // Payout de la liquidación de este pedido.
    expect(traza.payout).not.toBeNull();
    expect(traza.payout?.estado).toBe('confirmado');
    expect(traza.payout?.montoLiquidoClp).toBe(3000);
  });

  it('lazo en curso: sin línea de cobro ni liquidación, todo null/vacío, no evaluada', async () => {
    const cliente = crearFakeSupabase({
      'dinero.lineas_cobro': [],
      'dinero.lineas_liquidacion': [],
      'dinero.eventos_conciliacion': [],
    });

    const traza = await obtenerTrazaDineroPorPedido(cliente, TENANT, 'pedido-sin-nada');

    expect(traza.cobro).toBeNull();
    expect(traza.periodo).toBeNull();
    expect(traza.factura).toBeNull();
    expect(traza.liquidacion).toBeNull();
    expect(traza.pagosRecibidos).toEqual([]);
    expect(traza.conciliacion).toEqual({ evaluada: false, eventos: [] });
    expect(traza.payout).toBeNull();
  });

  it('respeta el aislamiento por tenant: no arrastra la línea de cobro de otro tenant', async () => {
    const cliente = crearFakeSupabase({
      'dinero.lineas_cobro': [
        {
          tenant_id: OTRO_TENANT,
          pedido_id: 'pedido-compartido',
          monto_final_clp: 9999,
          periodo_cobro_id: 'periodo-x',
          snapshot_regla: null,
          anulada: false,
          motivo_anulacion: null,
        },
      ],
      'dinero.lineas_liquidacion': [],
      'dinero.eventos_conciliacion': [],
    });

    const traza = await obtenerTrazaDineroPorPedido(cliente, TENANT, 'pedido-compartido');
    expect(traza.cobro).toBeNull();
  });
});

// =============================================================================
// listarEventosConciliacion — filtros nuevos de la bandeja de excepciones
// (§1.1 P1: categoria, asignadoA, bloqueado, estados). Ver huecos de cobertura
// identificados en la auditoría — `consultas.test.ts` no los ejercitaba.
// =============================================================================

describe('listarEventosConciliacion — filtros de la bandeja de excepciones', () => {
  function eventoBase(overrides: Fila = {}): Fila {
    return {
      id: 'evento-1',
      tenant_id: TENANT,
      seller_id: 'seller-1',
      periodo_cobro_id: 'periodo-1',
      tipo_diferencia: 'monto_dte_difiere_de_lineas',
      pedido_id: null,
      descripcion: 'Diferencia de prueba',
      monto_diferencia_clp: 100,
      estado: 'pendiente',
      resuelto_por_usuario_id: null,
      resuelto_en: null,
      job_run_id: null,
      driver_id: null,
      liquidacion_id: null,
      creado_en: '2026-07-06T00:00:00Z',
      categoria_negocio: 'cumplimiento_dte',
      accion_sugerida: 'reenviar_o_verificar_dte',
      asignado_a_usuario_id: null,
      asignado_en: null,
      asignado_por_usuario_id: null,
      fecha_limite: null,
      bloquea_facturacion: false,
      bloquea_pago: false,
      motivo_bloqueo: null,
      fuentes_comparadas: null,
      actualizado_en: '2026-07-06T00:00:00Z',
      ...overrides,
    };
  }

  it('filtro categoria: solo devuelve eventos de la categoría de negocio pedida', async () => {
    const cliente = crearFakeSupabase({
      'dinero.eventos_conciliacion': [
        eventoBase({ id: 'ev-dte', categoria_negocio: 'cumplimiento_dte' }),
        eventoBase({ id: 'ev-fuga', categoria_negocio: 'fuga_ingreso' }),
      ],
    });

    const eventos = await listarEventosConciliacion(cliente, TENANT, undefined, undefined, {
      categoria: 'fuga_ingreso',
    });

    expect(eventos).toHaveLength(1);
    expect(eventos[0].id).toBe('ev-fuga');
  });

  it('filtro asignadoA: solo devuelve eventos asignados a ese usuario', async () => {
    const cliente = crearFakeSupabase({
      'dinero.eventos_conciliacion': [
        eventoBase({ id: 'ev-asignado', asignado_a_usuario_id: 'usuario-1' }),
        eventoBase({ id: 'ev-otro-usuario', asignado_a_usuario_id: 'usuario-2' }),
        eventoBase({ id: 'ev-sin-asignar', asignado_a_usuario_id: null }),
      ],
    });

    const eventos = await listarEventosConciliacion(cliente, TENANT, undefined, undefined, {
      asignadoA: 'usuario-1',
    });

    expect(eventos).toHaveLength(1);
    expect(eventos[0].id).toBe('ev-asignado');
  });

  it('filtro bloqueado=true: devuelve eventos con bloquea_facturacion O bloquea_pago en true', async () => {
    const cliente = crearFakeSupabase({
      'dinero.eventos_conciliacion': [
        eventoBase({ id: 'ev-bloquea-factura', bloquea_facturacion: true, bloquea_pago: false }),
        eventoBase({ id: 'ev-bloquea-pago', bloquea_facturacion: false, bloquea_pago: true }),
        eventoBase({ id: 'ev-sin-bloqueo', bloquea_facturacion: false, bloquea_pago: false }),
      ],
    });

    const eventos = await listarEventosConciliacion(cliente, TENANT, undefined, undefined, {
      bloqueado: true,
    });

    expect(eventos.map((e) => e.id).sort()).toEqual(['ev-bloquea-factura', 'ev-bloquea-pago']);
  });

  it('filtro bloqueado=false: excluye cualquier evento con al menos un flag de bloqueo activo', async () => {
    const cliente = crearFakeSupabase({
      'dinero.eventos_conciliacion': [
        eventoBase({ id: 'ev-bloquea-factura', bloquea_facturacion: true, bloquea_pago: false }),
        eventoBase({ id: 'ev-bloquea-pago', bloquea_facturacion: false, bloquea_pago: true }),
        eventoBase({ id: 'ev-sin-bloqueo', bloquea_facturacion: false, bloquea_pago: false }),
      ],
    });

    const eventos = await listarEventosConciliacion(cliente, TENANT, undefined, undefined, {
      bloqueado: false,
    });

    expect(eventos).toHaveLength(1);
    expect(eventos[0].id).toBe('ev-sin-bloqueo');
  });

  it('filtro estados: aplica un OR sobre la lista, complementando (no reemplazando) el parámetro posicional estado', async () => {
    const cliente = crearFakeSupabase({
      'dinero.eventos_conciliacion': [
        eventoBase({ id: 'ev-pendiente', estado: 'pendiente' }),
        eventoBase({ id: 'ev-en-analisis', estado: 'en_analisis' }),
        eventoBase({ id: 'ev-ignorada', estado: 'ignorada' }),
      ],
    });

    const eventos = await listarEventosConciliacion(cliente, TENANT, undefined, undefined, {
      estados: ['pendiente', 'en_analisis'],
    });

    expect(eventos.map((e) => e.id).sort()).toEqual(['ev-en-analisis', 'ev-pendiente']);
  });

  it('combina varios filtros nuevos a la vez (categoria + bloqueado)', async () => {
    const cliente = crearFakeSupabase({
      'dinero.eventos_conciliacion': [
        eventoBase({ id: 'ev-match', categoria_negocio: 'fuga_ingreso', bloquea_facturacion: true }),
        eventoBase({ id: 'ev-categoria-no-calza', categoria_negocio: 'integridad_datos', bloquea_facturacion: true }),
        eventoBase({ id: 'ev-bloqueo-no-calza', categoria_negocio: 'fuga_ingreso', bloquea_facturacion: false }),
      ],
    });

    const eventos = await listarEventosConciliacion(cliente, TENANT, undefined, undefined, {
      categoria: 'fuga_ingreso',
      bloqueado: true,
    });

    expect(eventos).toHaveLength(1);
    expect(eventos[0].id).toBe('ev-match');
  });

  it('aislamiento: no devuelve eventos de otro tenant aunque calcen los filtros nuevos', async () => {
    const cliente = crearFakeSupabase({
      'dinero.eventos_conciliacion': [
        eventoBase({ id: 'ev-otro-tenant', tenant_id: OTRO_TENANT, categoria_negocio: 'fuga_ingreso' }),
      ],
    });

    const eventos = await listarEventosConciliacion(cliente, TENANT, undefined, undefined, {
      categoria: 'fuga_ingreso',
    });

    expect(eventos).toHaveLength(0);
  });

  it('sin filtros nuevos: se comporta igual que antes (todos los eventos del tenant)', async () => {
    const cliente = crearFakeSupabase({
      'dinero.eventos_conciliacion': [eventoBase({ id: 'ev-1' }), eventoBase({ id: 'ev-2' })],
    });

    const eventos = await listarEventosConciliacion(cliente, TENANT);
    expect(eventos).toHaveLength(2);
  });
});

// =============================================================================
// listarHistorialEventoConciliacion
// =============================================================================

describe('listarHistorialEventoConciliacion', () => {
  function historialBase(overrides: Fila = {}): Fila {
    return {
      id: 'hist-1',
      tenant_id: TENANT,
      evento_id: 'evento-1',
      tipo_cambio: 'cambio_estado',
      estado_anterior: 'pendiente',
      estado_nuevo: 'en_analisis',
      comentario: null,
      datos: {},
      actor_usuario_id: 'usuario-1',
      actor_tipo: 'usuario',
      creado_en: '2026-07-06T00:00:00Z',
      ...overrides,
    };
  }

  it('devuelve solo el historial del evento pedido, mapeado', async () => {
    const cliente = crearFakeSupabase({
      'dinero.eventos_conciliacion_historial': [
        historialBase({ id: 'hist-1', evento_id: 'evento-1' }),
        historialBase({ id: 'hist-2', evento_id: 'evento-otro' }),
      ],
    });

    const historial = await listarHistorialEventoConciliacion(cliente, TENANT, 'evento-1');

    expect(historial).toHaveLength(1);
    expect(historial[0].id).toBe('hist-1');
    expect(historial[0].eventoId).toBe('evento-1');
    expect(historial[0].tipoCambio).toBe('cambio_estado');
  });

  it('aislamiento: no devuelve historial de otro tenant aunque el evento_id coincida', async () => {
    const cliente = crearFakeSupabase({
      'dinero.eventos_conciliacion_historial': [
        historialBase({ id: 'hist-otro-tenant', tenant_id: OTRO_TENANT, evento_id: 'evento-compartido' }),
      ],
    });

    const historial = await listarHistorialEventoConciliacion(cliente, TENANT, 'evento-compartido');
    expect(historial).toHaveLength(0);
  });

  it('sin historial → array vacío', async () => {
    const cliente = crearFakeSupabase({ 'dinero.eventos_conciliacion_historial': [] });
    const historial = await listarHistorialEventoConciliacion(cliente, TENANT, 'evento-sin-historial');
    expect(historial).toEqual([]);
  });

  it('mapea múltiples entradas conservando datos/comentario/actor', async () => {
    const cliente = crearFakeSupabase({
      'dinero.eventos_conciliacion_historial': [
        historialBase({
          id: 'hist-1',
          tipo_cambio: 'bloqueo',
          comentario: 'Se bloquea el pago hasta confirmar con el conductor',
          datos: { bloquea_pago: true, bloquea_pago_anterior: false },
          actor_tipo: 'usuario',
        }),
        historialBase({
          id: 'hist-2',
          tipo_cambio: 'deteccion',
          comentario: null,
          actor_usuario_id: null,
          actor_tipo: 'sistema',
        }),
      ],
    });

    const historial = await listarHistorialEventoConciliacion(cliente, TENANT, 'evento-1');

    expect(historial).toHaveLength(2);
    expect(historial[0].comentario).toBe('Se bloquea el pago hasta confirmar con el conductor');
    expect(historial[0].datos).toEqual({ bloquea_pago: true, bloquea_pago_anterior: false });
    expect(historial[1].actorTipo).toBe('sistema');
    expect(historial[1].actorUsuarioId).toBeNull();
  });
});
