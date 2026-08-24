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

/**
 * Cuáles de estos pedidos se van a entregar sin poder cobrarse.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ NO SE MIRA `tarifa_aplicable_id`
 * -----------------------------------------------------------------------------
 * Es el campo obvio y da una respuesta falsa. Lo escriben el alta same-day y la
 * ingesta de Shopify; **la ingesta de Mercado Libre no lo escribe nunca**. Si la
 * pantalla marcara «sin tarifa» donde esa columna viene en `null`, en un courier
 * cuya operación es Flex entera se pintarían de reparo las treinta paradas —
 * todas falsas, y la próxima vez nadie miraría el reparo verdadero.
 *
 * Se resuelve la tarifa igual que el motor: por **seller y régimen**, a la fecha
 * de operación. Es la misma pregunta que se hace `detectarSellersSinTarifa` en
 * la pantalla de preparación, y tiene que dar lo mismo en las dos.
 *
 * -----------------------------------------------------------------------------
 * UNA CONSULTA POR SELLER, NO POR PARADA
 * -----------------------------------------------------------------------------
 * Treinta paradas de un manifiesto suelen ser tres o cuatro sellers. Se agrupa
 * por `(seller, régimen)` antes de preguntar; si no, son treinta viajes para
 * responder cuatro veces lo mismo.
 *
 * Ante un error de lectura devuelve el conjunto vacío: no marcar un reparo que
 * existe es malo, pero inventar treinta reparos porque se cayó una consulta es
 * peor — y esto se llama desde pantallas que ya se dibujaron.
 */
export async function detectarPedidosSinTarifa(
  cliente: SupabaseClient,
  entrada: {
    tenantId: string;
    /** Fecha 'YYYY-MM-DD' contra la que se evalúa la vigencia. */
    fecha: string;
  },
  pedidos: readonly { id: string; sellerId: string; tipoPedido: TipoPedido }[],
): Promise<Set<string>> {
  const claves = new Map<string, { sellerId: string; tipoPedido: TipoPedido }>();
  for (const p of pedidos) {
    claves.set(`${p.sellerId}·${p.tipoPedido}`, { sellerId: p.sellerId, tipoPedido: p.tipoPedido });
  }
  if (claves.size === 0) return new Set();

  const resueltas = await Promise.all(
    [...claves].map(async ([clave, { sellerId, tipoPedido }]) => ({
      clave,
      tarifaId: await resolverTarifaVigente(cliente, {
        tenantId: entrada.tenantId,
        sellerId,
        tipoEntrega: tipoPedido,
        fecha: entrada.fecha,
      }).catch(() => "error"),
    })),
  );

  const sinTarifa = new Set(resueltas.filter((r) => r.tarifaId === null).map((r) => r.clave));
  if (sinTarifa.size === 0) return new Set();

  return new Set(
    pedidos.filter((p) => sinTarifa.has(`${p.sellerId}·${p.tipoPedido}`)).map((p) => p.id),
  );
}
