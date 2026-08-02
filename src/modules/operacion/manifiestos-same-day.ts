/**
 * Efectos same-day sobre el manifiesto — acciones que ocurren cuando
 * el conductor marca su manifiesto como 'en_ruta'.
 *
 * FRONTERA DURA: solo se actúa sobre pedidos tipo_pedido='same_day'.
 * Los pedidos Flex NO se tocan — sus transiciones de estado vienen de ML
 * (la app de Mercado Envíos Flex es obligatoria y no integrable — CLAUDE.md).
 *
 * Idempotente: los pedidos que ya están en 'en_ruta' (u otro estado) son
 * ignorados silenciosamente gracias al filtro de estado='asignado' en la
 * consulta y al optimistic locking de actualizarEstadoPedido.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { UsuarioActual } from "@/modules/identidad/usuario-actual";
import { actualizarEstadoPedido } from "./pedidos";
import { ErrorConflicto } from "@/modules/identidad/errores";

/**
 * Transiciona en lote los pedidos same-day del manifiesto que estén en
 * estado 'asignado' → 'en_ruta', con ejecutor 'conductor'.
 *
 * Idempotente: si un pedido ya salió de 'asignado' antes de ejecutarse
 * (carrera resuelta), el ErrorConflicto del optimistic locking se captura
 * y se ignora (no es un fallo real — el pedido ya avanzó).
 *
 * NO toca pedidos Flex (filtro tipo_pedido='same_day').
 *
 * @param cliente     Cliente service_role de Supabase.
 * @param manifiestoId UUID del manifiesto que pasó a 'en_ruta'.
 * @param tenantId    UUID del tenant (aislamiento).
 * @param driverId    UUID del conductor (para la barrera en actualizarEstadoPedido).
 * @param actor       UsuarioActual del conductor (para RBAC + bitácora).
 */
export async function transicionarPedidosSameDayAEnRuta(
  cliente: SupabaseClient,
  manifiestoId: string,
  tenantId: string,
  driverId: string,
  actor: UsuarioActual,
): Promise<void> {
  // Leer los pedidos same-day del manifiesto que aún están en 'asignado'.
  // La JOIN va por asignaciones_pedido: la tabla que relaciona pedido↔manifiesto.
  const { data: asignaciones, error } = await cliente
    .from("asignaciones_pedido")
    .select("pedido_id, pedidos!inner(id, estado, tipo_pedido, driver_id_asignado)")
    .eq("manifiesto_id", manifiestoId)
    .eq("tenant_id", tenantId)
    .eq("activa", true)
    .eq("pedidos.estado", "asignado")
    .eq("pedidos.tipo_pedido", "same_day");

  if (error) {
    // Un fallo de lectura es un error de infraestructura — relanzar para que
    // el llamador pueda registrarlo. No bloquea la transición del manifiesto,
    // que ya se hizo en la Server Action antes de llamar a esta función.
    throw new Error(
      `Error al leer pedidos same-day del manifiesto para en_ruta: ${error.message}`,
    );
  }

  if (!asignaciones || asignaciones.length === 0) return;

  // Transicionar cada pedido. Procesamos en serie para no saturar el pool de
  // conexiones (en MVP los manifiestos tienen <50 paradas).
  for (const asignacion of asignaciones) {
    try {
      await actualizarEstadoPedido(
        cliente,
        {
          pedidoId: asignacion.pedido_id,
          tenantId,
          estadoNuevo: "en_ruta",
          estadoEsperado: "asignado",
          ejecutor: "conductor",
          actuadoPorUsuarioId: actor.driverId ?? undefined,
        },
        actor,
      );
    } catch (err) {
      // ErrorConflicto = el pedido ya salió de 'asignado' antes de nuestro UPDATE.
      // Es una condición de carrera resuelta — no es un fallo real. Ignorar.
      if (err instanceof ErrorConflicto) continue;
      // Cualquier otro error (infraestructura, validación inesperada) lo relanzamos.
      throw err;
    }
  }
}
