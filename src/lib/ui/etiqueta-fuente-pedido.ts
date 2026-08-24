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
  ml_flex: "Flex",
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

/** Forma corta para la columna «Origen» de una tabla densa. */
const TEXTO_FUENTE_CORTA: Record<string, string> = {
  ml_flex: "FLEX",
  rutax_manual: "SD",
  shopify: "SHOP",
};

/**
 * `FLEX` · `SD` · `SHOP` — la procedencia en una columna de tabla.
 *
 * ⚠️ **Existe porque «Mercado Libre Flex» no cabe en una columna densa**, no
 * porque el nombre largo esté mal: en el chip, en el filtro y en el detalle sigue
 * mandando `etiquetaFuentePedido`. Acá el ancho es el que manda, y tres letras se
 * barren de un vistazo por una lista de cincuenta filas.
 *
 * Ante un valor desconocido devuelve el crudo, igual que su hermana: si mañana
 * entra una fuente y alguien olvida esta tabla, la pantalla lo delata en vez de
 * mostrar un guion.
 */
export function etiquetaFuenteCorta(fuente: string | null | undefined): string {
  if (!fuente) return "—";
  return TEXTO_FUENTE_CORTA[fuente] ?? fuente.toUpperCase();
}
