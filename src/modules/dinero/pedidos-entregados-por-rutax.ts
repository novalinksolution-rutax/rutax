/**
 * Qué pedidos cuentan para el dinero de un período.
 * =============================================================================
 * **Los que Rutax entregó. Sin más.**
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ HACE FALTA DECIRLO EXPLÍCITO
 * -----------------------------------------------------------------------------
 * `operacion.pedidos.estado` NO responde esa pregunta, y esa confusión costó un
 * incidente real. Para un pedido Flex, el estado lo escribe **Mercado Libre**:
 * la ingesta trae el envío con el estado que ML reporta, y si el propio seller
 * lo despachó, en Rutax igual queda `entregado`. Nadie de Rutax lo retiró, lo
 * asignó ni lo entregó.
 *
 * El 2026-08-25, al cerrar su primer período, un courier que **todavía no
 * empezaba a operar** encontró **109 excepciones** de «Pedido entregado sin
 * línea de cobro». Todas eran pedidos Flex solo ingestados. El detector
 * preguntaba «¿está entregado y sin cobro?» y nunca «¿lo movimos nosotros?».
 *
 * -----------------------------------------------------------------------------
 * LA EVIDENCIA: LA ASIGNACIÓN
 * -----------------------------------------------------------------------------
 * Si no existe una fila en `operacion.asignaciones_pedido`, Rutax nunca puso ese
 * bulto en la ruta de nadie. No hay conductor a quien pagarle ni entrega que
 * cobrarle a un seller.
 *
 * Se mira **cualquier** asignación, no solo la activa (`activa = true`): un
 * pedido que se reasignó, o cuyo traspaso se cerró, sigue siendo un pedido que
 * Rutax movió. Filtrar por activa dejaría fuera entregas legítimas — el error
 * caro en la dirección contraria.
 *
 * ⚠️ **LOS DOS ERRORES NO CUESTAN LO MISMO.** Dejar pasar un pedido que Rutax no
 * tocó llena la bandeja de ruido; excluir uno que sí entregó **esconde un cobro
 * que correspondía** y le hace perder plata al courier en silencio. Por eso el
 * predicado es lo más permisivo que sigue siendo cierto, y por eso las pruebas
 * fijan los dos lados.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { leerTodasLasFilas, leerPorLotesDeIds } from "@/lib/supabase/leer-paginado";

/** Los estados que significan «se entregó». Espeja `operacion/tipos.ts`. */
const ESTADOS_ENTREGADO = ["entregado", "entregado_manual"] as const;

export interface RangoPeriodo {
  /** ISO, inicio inclusivo. Ya resuelto al calendario de Santiago por el llamador. */
  desdeIso: string;
  /** ISO, fin exclusivo. */
  hastaIso: string;
}

/**
 * Los ids de los pedidos de un seller que **Rutax entregó** dentro del rango.
 *
 * Dos consultas y no un `join`: PostgREST no cruza esquemas (`operacion` →
 * `operacion` sí, pero la relación pedidos↔asignaciones es ambigua y atarse al
 * nombre de un constraint es frágil). Y las dos van paginadas y por lotes, que
 * es lo que ya hacía el detector — con quincenas, un seller de 67 entregas
 * diarias cruza las 1.000 filas de PostgREST y el resto se pierde EN SILENCIO.
 */
export async function listarPedidosEntregadosPorRutax(
  supabase: SupabaseClient,
  entrada: { tenantId: string; sellerId: string; rango: RangoPeriodo },
): Promise<string[]> {
  const { tenantId, sellerId, rango } = entrada;

  const entregados = await leerTodasLasFilas<{ id: string }>(
    `pedidos entregados del seller ${sellerId}`,
    (desde, hasta) =>
      supabase
        .schema("operacion")
        .from("pedidos")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("seller_id", sellerId)
        .in("estado", ESTADOS_ENTREGADO)
        .gte("actualizado_en", rango.desdeIso)
        .lt("actualizado_en", rango.hastaIso)
        .order("id")
        .range(desde, hasta),
  );

  const ids = entregados.map((p) => p.id);
  if (ids.length === 0) return [];

  // La pregunta que faltaba: ¿alguien de Rutax lo puso en una ruta?
  const asignados = await leerPorLotesDeIds<{ pedido_id: string }>(
    "asignaciones por pedido",
    ids,
    (lote) =>
      supabase
        .schema("operacion")
        .from("asignaciones_pedido")
        .select("pedido_id")
        .eq("tenant_id", tenantId)
        .in("pedido_id", lote),
  );

  const conAsignacion = new Set(asignados.map((a) => a.pedido_id));
  return ids.filter((id) => conAsignacion.has(id));
}
