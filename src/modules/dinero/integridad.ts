/**
 * Verificaciones de integridad estructural del motor entrega→dinero (QW6).
 * =============================================================================
 * Completa la cobertura de la bandeja de excepciones: C6 (`conciliar-periodo`)
 * ya detecta, al cerrar cada período, los pedidos entregados SIN línea y las
 * líneas sueltas; C7 (`conciliar-tres-fuentes`) cruza cobro↔liquidación↔tarifa.
 * Lo único que ningún detector emitía es el caso INVERSO y permanente:
 *
 *   `linea_cobro_sin_pedido_entregado` — una línea de cobro ACTIVA cuyo pedido
 *   NO está en un estado que deba generar cobro. Ocurre si un pedido revierte a
 *   un estado operativo, o se devuelve/cancela tras cerrarse su período (la
 *   anulación pre-cierre del motor solo actúa con período `abierto`), o si el
 *   pedido desaparece. Es dinero fantasma que debe revisarse.
 *
 * A diferencia de C6/C7 (atados al cierre de un período), este barrido es
 * PERMANENTE: lo corre el watchdog horario sobre todas las líneas activas.
 *
 * Reutiliza la infraestructura de la bandeja (`conciliacion-insercion`): misma
 * idempotencia y clasificación. Detective puro — solo LEE e INSERTA en
 * `eventos_conciliacion`, nunca muta líneas ni pedidos.
 */

import type { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { existeEventoConciliacion, insertarEventoConciliacion } from './conciliacion-insercion';

type ClienteServiceRole = ReturnType<typeof crearClienteServiceRole>;

/**
 * Estados de pedido en los que una línea de cobro ACTIVA es inconsistente:
 * - `devuelto` / `cancelado`: la línea debió anularse (no ocurrió, o el período
 *   ya estaba cerrado cuando el pedido cambió de estado).
 * - `pendiente_asignacion` / `asignado` / `en_ruta`: el pedido revirtió a un
 *   estado operativo pero la línea de cobro quedó viva.
 *
 * Se EXCLUYEN a propósito `entregado`/`entregado_manual` (generan cobro) y
 * `fallido`/`fallido_manual` (pueden generar cobro si la incidencia lo afecta):
 * en esos estados la línea puede ser legítima — incluirlos daría falsos positivos.
 */
const ESTADOS_PEDIDO_SIN_COBRO_LEGITIMO: ReadonlySet<string> = new Set([
  'devuelto',
  'cancelado',
  'pendiente_asignacion',
  'asignado',
  'en_ruta',
]);

/**
 * Predicado puro: ¿una línea de cobro ACTIVA cuyo pedido está en `estadoPedido`
 * es huérfana/inconsistente? `undefined` = el pedido ya no existe → huérfana.
 * Extraído para poder testear la regla sin BD.
 */
export function esLineaCobroHuerfana(estadoPedido: string | undefined): boolean {
  if (estadoPedido === undefined) return true; // pedido ausente
  return ESTADOS_PEDIDO_SIN_COBRO_LEGITIMO.has(estadoPedido);
}

/**
 * Detecta líneas de cobro activas huérfanas/inconsistentes de un tenant y las
 * registra como excepciones `linea_cobro_sin_pedido_entregado`. Devuelve cuántas
 * excepciones NUEVAS insertó (0 si todo consistente o ya reportado).
 */
export async function detectarLineasCobroHuerfanas(
  supabase: ClienteServiceRole,
  tenantId: string,
  runId: string,
): Promise<number> {
  // Líneas de cobro vigentes (no anuladas) del tenant.
  const { data: lineas, error: errLineas } = await supabase
    .schema('dinero')
    .from('lineas_cobro')
    .select('id, pedido_id, seller_id, periodo_cobro_id, monto_final_clp')
    .eq('tenant_id', tenantId)
    .eq('anulada', false);

  if (errLineas) throw new Error(`Integridad · Error al leer lineas_cobro: ${errLineas.message}`);
  if (!lineas || lineas.length === 0) return 0;

  // Estado actual de los pedidos referenciados por esas líneas.
  const pedidoIds = [...new Set(lineas.map((l) => l.pedido_id as string))];
  const { data: pedidos, error: errPedidos } = await supabase
    .schema('operacion')
    .from('pedidos')
    .select('id, estado')
    .eq('tenant_id', tenantId)
    .in('id', pedidoIds);

  if (errPedidos) throw new Error(`Integridad · Error al leer pedidos: ${errPedidos.message}`);

  const estadoPorPedido = new Map<string, string>(
    (pedidos ?? []).map((p) => [p.id as string, p.estado as string]),
  );

  let insertados = 0;

  for (const linea of lineas) {
    const pedidoId = linea.pedido_id as string;
    const estado = estadoPorPedido.get(pedidoId);
    const pedidoAusente = estado === undefined;

    if (!esLineaCobroHuerfana(estado)) continue;

    // Idempotencia: una excepción de este tipo por pedido.
    const yaExiste = await existeEventoConciliacion(
      supabase,
      tenantId,
      'linea_cobro_sin_pedido_entregado',
      { pedidoId },
    );
    if (yaExiste) continue;

    const monto = Math.round(Number(linea.monto_final_clp ?? 0));
    const descripcion = pedidoAusente
      ? `Línea de cobro activa (${monto} CLP) para el pedido ${pedidoId}, que ya no existe. ` +
        'Revisar: la línea no debería seguir viva.'
      : `Línea de cobro activa (${monto} CLP) para el pedido ${pedidoId} en estado '${estado}', ` +
        'que no debe generar cobro. Probable anulación no aplicada o reversión post-cierre.';

    await insertarEventoConciliacion(supabase, {
      tenant_id: tenantId,
      seller_id: (linea.seller_id as string | null) ?? null,
      periodo_cobro_id: (linea.periodo_cobro_id as string | null) ?? null,
      pedido_id: pedidoId,
      tipo_diferencia: 'linea_cobro_sin_pedido_entregado',
      descripcion,
      monto_diferencia_clp: monto,
      estado: 'pendiente',
      job_run_id: runId,
    });
    insertados++;
  }

  return insertados;
}
