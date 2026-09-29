/**
 * Dashboard vacío (docs/ux/puesta-en-marcha-v2.md §9): UNA sola acción siguiente.
 * =============================================================================
 * Se evalúa en orden y se muestra la PRIMERA que aplique, nunca dos. Se apaga
 * para siempre con el primer pedido real y no hay flag: se deriva de que
 * existan pedidos.
 *
 * Q13 (pedido de prueba): la base NO tiene un concepto de "pedido de prueba" —
 * `actionCrearSameDayPrueba` crea pedidos normales, distinguibles solo por el
 * nombre del destinatario («Prueba {comuna} #n»). Se excluyen por ese prefijo,
 * que es una heurística: si esa herramienta cambia su nombre, esto deja de
 * excluirlos (y el efecto es inocuo: el dueño que probó pierde la guía).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type SiguienteAccion = "invitar_seller" | "sumar_conductor" | "esperar_pedido";

export function decidirSiguienteAccion(d: {
  pedidosReales: number;
  sellers: number;
  conductoresActivos: number;
}): SiguienteAccion | null {
  if (d.pedidosReales > 0) return null;
  if (d.sellers === 0) return "invitar_seller";
  if (d.conductoresActivos === 0) return "sumar_conductor";
  return "esperar_pedido";
}

/** Falla ABIERTO hacia el dashboard normal: un error de lectura no esconde el mosaico. */
export async function leerSiguienteAccion(
  cliente: Pick<SupabaseClient, "schema">,
  tenantId: string,
): Promise<SiguienteAccion | null> {
  try {
    const [pedidos, sellers, conductores] = await Promise.all([
      cliente
        .schema("operacion")
        .from("pedidos")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .not("destinatario_nombre", "like", "Prueba %"),
      cliente
        .schema("identidad")
        .from("sellers")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId),
      cliente
        .schema("identidad")
        .from("conductores")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("estado", "activo"),
    ]);
    if (pedidos.error || sellers.error || conductores.error) return null;
    return decidirSiguienteAccion({
      pedidosReales: pedidos.count ?? 0,
      sellers: sellers.count ?? 0,
      conductoresActivos: conductores.count ?? 0,
    });
  } catch {
    return null;
  }
}
