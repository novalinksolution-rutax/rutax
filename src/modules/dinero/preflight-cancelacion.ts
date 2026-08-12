/**
 * PREFLIGHT de `cancelarPedido` (docs/arquitectura/edicion-y-cancelacion-de-
 * pedidos.md §7.2 y D-A3).
 * =============================================================================
 *
 * Contrato NO-NEGOCIABLE (D-A1): la cancelación operativa de un pedido SIEMPRE
 * procede. Impedir que el coordinador marque como cancelado un paquete que
 * físicamente no se va a entregar, porque contabilidad ya cerró el período o ya
 * emitió la liquidación, es meter una mentira en la operación para tapar una en
 * el dinero. Este preflight es 100% informativo: NUNCA bloquea, solo avisa si
 * la anulación de las líneas de cobro/liquidación asociadas al pedido va a ser
 * automática (el job C1 las anula solas al recibir el evento financiero,
 * `generar-lineas.ts`) o si va a requerir intervención humana — nota de crédito
 * (RF-038) del lado del cobro, o corrección manual del lado de la liquidación.
 * Ese "no puede anular" YA levanta su propia excepción BLOQUEANTE de
 * conciliación en `generar-lineas.ts` (D-A2/H2) — este preflight no lo duplica,
 * solo lo adelanta para que el humano lo sepa ANTES de confirmar (tapa H3).
 *
 * Se llama SOLO desde la capa de aplicación (Server Actions de
 * `(tenant)/operaciones` y `portal/pedidos`), NUNCA desde `operacion` — ese
 * módulo no importa `dinero` (regla de límite, ver `pedidos.ts`).
 *
 * 100% de LECTURA — mismo contrato que `./preflight.ts`: ninguna función de
 * aquí hace INSERT/UPDATE.
 */

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import type { ItemPreflight } from './preflight';

export interface CtxPreflightCancelacion {
  tenantId: string;
  pedidoId: string;
}

export interface ResultadoPreflightCancelacion {
  /**
   * `true` si TODAS las líneas vivas del pedido (cobro y liquidación) se
   * anularán solas al cancelar — período de cobro 'abierto' (o línea sin
   * período todavía) y liquidación 'borrador' (o línea sin liquidación
   * todavía). `false` si al menos una quedará viva y requerirá intervención
   * humana.
   */
  anulacionAutomatica: boolean;
  /** Nunca bloquean — la cancelación operativa siempre procede (D-A1). */
  advertencias: ItemPreflight[];
}

/**
 * Evalúa el pedido y devuelve si la cancelación va a poder anular sola sus
 * líneas de dinero vivas, con las advertencias correspondientes cuando no.
 * No verifica RBAC: `cancelarPedido` es quien exige la capacidad; este
 * preflight es puramente informativo y se llama ANTES de esa acción, desde la
 * misma Server Action que ya validó permisos para mostrar el botón.
 */
export async function preflightCancelacionPedido(
  ctx: CtxPreflightCancelacion,
): Promise<ResultadoPreflightCancelacion> {
  const supabase = crearClienteServiceRole();
  const advertencias: ItemPreflight[] = [];

  // --- Línea de cobro ---------------------------------------------------------
  let cobroAutomatico = true;

  const { data: lineaCobro, error: errorCobro } = await supabase
    .schema('dinero')
    .from('lineas_cobro')
    .select('id, anulada, periodo_cobro_id')
    .eq('pedido_id', ctx.pedidoId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  if (errorCobro) throw new Error(`Error al leer línea de cobro: ${errorCobro.message}`);

  if (lineaCobro && !lineaCobro.anulada && lineaCobro.periodo_cobro_id) {
    const { data: periodo, error: errorPeriodo } = await supabase
      .schema('dinero')
      .from('periodos_cobro')
      .select('estado')
      .eq('id', lineaCobro.periodo_cobro_id as string)
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle();
    if (errorPeriodo) throw new Error(`Error al leer período de cobro: ${errorPeriodo.message}`);

    const estadoPeriodo = (periodo?.estado as string | undefined) ?? null;
    cobroAutomatico = estadoPeriodo === 'abierto';

    if (!cobroAutomatico) {
      advertencias.push({
        codigo: 'linea_cobro_no_anulable',
        categoria: 'advierte',
        titulo: `El cobro de este pedido ya está en un período '${estadoPeriodo ?? 'desconocido'}'`,
        detalle:
          'La cancelación procede igual, pero la línea de cobro NO se anulará sola. Si el ' +
          'período ya está facturado, corregir el monto exige una nota de crédito (RF-038).',
        meta: {
          estado_periodo: estadoPeriodo,
          periodo_cobro_id: lineaCobro.periodo_cobro_id as string,
        },
      });
    }
  }
  // Línea sin período asignado, ya anulada, o sin línea → se anula libremente
  // (o no hay nada que anular). `cobroAutomatico` queda en `true`.

  // --- Línea de liquidación ---------------------------------------------------
  let liquidacionAutomatica = true;

  const { data: lineaLiq, error: errorLiq } = await supabase
    .schema('dinero')
    .from('lineas_liquidacion')
    .select('id, anulada, liquidacion_id')
    .eq('pedido_id', ctx.pedidoId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  if (errorLiq) throw new Error(`Error al leer línea de liquidación: ${errorLiq.message}`);

  if (lineaLiq && !lineaLiq.anulada && lineaLiq.liquidacion_id) {
    const { data: liquidacion, error: errorLiquidacion } = await supabase
      .schema('dinero')
      .from('liquidaciones')
      .select('estado')
      .eq('id', lineaLiq.liquidacion_id as string)
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle();
    if (errorLiquidacion) throw new Error(`Error al leer liquidación: ${errorLiquidacion.message}`);

    const estadoLiquidacion = (liquidacion?.estado as string | undefined) ?? null;
    liquidacionAutomatica = estadoLiquidacion === 'borrador';

    if (!liquidacionAutomatica) {
      advertencias.push({
        codigo: 'linea_liquidacion_no_anulable',
        categoria: 'advierte',
        titulo: `La liquidación de este pedido ya está en estado '${estadoLiquidacion ?? 'desconocido'}'`,
        detalle:
          'La cancelación procede igual, pero la línea de liquidación NO se anulará sola — ' +
          'el conductor ya fue liquidado (o está por serlo) por una entrega que se va a cancelar.',
        meta: {
          estado_liquidacion: estadoLiquidacion,
          liquidacion_id: lineaLiq.liquidacion_id as string,
        },
      });
    }
  }

  return {
    anulacionAutomatica: cobroAutomatico && liquidacionAutomatica,
    advertencias,
  };
}
