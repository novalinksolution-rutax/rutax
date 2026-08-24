/**
 * Nombres visibles de los dos ejes que hasta ahora se mostraban con el mismo
 * ternario copiado a mano en nueve pantallas.
 *
 * Son ejes DISTINTOS y por eso hay dos funciones, no una:
 *
 * - `etiquetaFuentePedido` responde **de dónde vino este pedido**. Es lo que
 *   corresponde mostrar en una lista de pedidos, en su detalle, en el manifiesto
 *   y en la app del conductor. Antes se resolvía leyendo `tipo_pedido`, y por eso
 *   un pedido de Shopify aparecía rotulado "Same-day" en toda la interfaz.
 *
 * - `etiquetaTipoEntrega` responde **bajo qué régimen se tarifica**. Es lo que
 *   corresponde en la configuración de tarifas y zonas, y en una línea de cobro,
 *   donde el valor mostrado es el de `identidad.tarifas.tipo_entrega` y no la
 *   procedencia de ningún pedido.
 *
 * CLAUDE.md: los helpers de presentación compartidos viven en `src/lib/ui/` y se
 * reusan entre `(tenant)`, `portal` y `conductor` en vez de duplicarse.
 */

import type { FuentePedido, TipoPedido } from "@/modules/operacion/tipos";

const TEXTO_FUENTE: Record<FuentePedido, string> = {
  // ⚠️ **«Mercado Libre Flex», no «Flex» a secas.** Esta etiqueta contesta *de
  // dónde vino el pedido*, y «Flex» solo nombra el régimen — quien recién entra
  // a la pantalla no tiene por qué saber que Flex es de Mercado Libre. El
  // «Flex» final se conserva porque sí carga información operativa: es la
  // fuente cuyo POD lo gobierna la app de Mercado Envíos.
  ml_flex: "Mercado Libre Flex",
  rutax_manual: "Same-day",
  shopify: "Shopify",
};

const TEXTO_TIPO_ENTREGA: Record<TipoPedido, string> = {
  flex: "Flex",
  same_day: "Same-day",
};

/**
 * De dónde vino el pedido, en el lenguaje del courier.
 *
 * `rutax_manual` se muestra como "Same-day" y no como "Manual" a propósito: es
 * el nombre con el que el courier ya llama a ese pedido en toda la operación, y
 * cambiarlo de paso sería renombrar algo que nadie pidió renombrar.
 *
 * Ante un valor desconocido devuelve el crudo en vez de inventar: si mañana
 * entra una fuente y alguien olvida esta tabla, la pantalla lo delata.
 */
export function etiquetaFuentePedido(fuente: string | null | undefined): string {
  if (!fuente) return "—";
  return TEXTO_FUENTE[fuente as FuentePedido] ?? fuente;
}

/** Régimen de tarifa — para tarifas, zonas y líneas de cobro, no para pedidos. */
export function etiquetaTipoEntrega(tipo: string | null | undefined): string {
  if (!tipo) return "—";
  return TEXTO_TIPO_ENTREGA[tipo as TipoPedido] ?? tipo;
}

/**
 * ⚠️ **`etiquetaFuenteCorta` se retiró (24-08-2026, decisión del usuario).**
 *
 * Devolvía `FLEX` · `SD` · `SHOP` para que la procedencia cupiera en una columna
 * densa. El argumento del ancho era cierto y el del significado pesa más: **`SD`
 * no le dice nada a nadie** que no lleve meses en el producto, y la columna
 * existe justo para que la procedencia se lea sin pensar. Con tres fuentes
 * conviviendo —y Falabella en camino— el problema solo iba a crecer.
 *
 * Hay un solo nombre visible por fuente, y es `etiquetaFuentePedido`. Si en
 * alguna superficie no cabe, se resuelve con el ancho de esa superficie, no
 * inventando un segundo vocabulario que el courier tenga que aprender.
 */
