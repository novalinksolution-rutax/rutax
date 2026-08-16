/**
 * Resolución de la tarifa vigente de un pedido.
 *
 * Vivía incrustada dentro de `crearPedidoSameDay` con `tipo_entrega` fijo en
 * `'same_day'`, y era la ÚNICA resolución de tarifa del sistema. Se extrajo al
 * agregar Shopify como fuente, y no por prolijidad:
 * `dinero/jobs/generar-lineas.ts` inserta `tarifa_id` en una columna NOT NULL,
 * así que un pedido que nace sin `tarifa_aplicable_id` no falla al crearse —
 * falla mucho después, al entregarse, tumbando el job que genera la plata. Toda
 * ruta de ingesta que cree pedidos con POD autoritativo en Rutax tiene que pasar
 * por aquí.
 *
 * Precedencia (la del ORDER BY, no la del texto): tarifa específica del seller
 * antes que la del tenant, y entre dos igual de específicas gana la de vigencia
 * más reciente.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TipoPedido } from "./tipos";

export interface ResolverTarifaVigenteEntrada {
  tenantId: string;
  sellerId: string;
  /** Régimen de tarifa. NO es la fuente del pedido: un pedido Shopify tarifica como `same_day`. */
  tipoEntrega: TipoPedido;
  /** Fecha 'YYYY-MM-DD' en zona Santiago contra la que se evalúa la vigencia. */
  fecha: string;
}

/**
 * Devuelve el id de la tarifa vigente, o `null` si el seller no tiene ninguna
 * configurada para ese régimen.
 *
 * Devuelve `null` en vez de lanzar porque los dos llamadores necesitan cosas
 * distintas: el alta manual rechaza al usuario con un mensaje accionable, y un
 * job de ingesta no puede rechazar nada — tiene que decidir si ingesta igual o
 * salta la fila, y esa decisión no es de este helper.
 */
export async function resolverTarifaVigente(
  cliente: SupabaseClient,
  entrada: ResolverTarifaVigenteEntrada,
): Promise<string | null> {
  const { data: tarifas, error } = await cliente
    .from("tarifas")
    .select("id")
    .eq("tenant_id", entrada.tenantId)
    .eq("tipo_entrega", entrada.tipoEntrega)
    .eq("estado", "activa")
    .lte("vigente_desde", entrada.fecha)
    .or(`vigente_hasta.is.null,vigente_hasta.gte.${entrada.fecha}`)
    .or(`seller_id.eq.${entrada.sellerId},seller_id.is.null`)
    .order("seller_id", { ascending: false, nullsFirst: false })
    .order("vigente_desde", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`Error al buscar tarifa vigente: ${error.message}`);
  }

  return tarifas && tarifas.length > 0 ? (tarifas[0].id as string) : null;
}
