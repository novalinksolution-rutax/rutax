/**
 * DTO mínimo de pedido para el flujo de retiro — el ÚNICO lugar autorizado a
 * leer `operacion.pedidos` en este flujo (docs/arquitectura/retiro-y-ruteo.md
 * §13bis-1.1).
 *
 * POR QUÉ EXISTE ESTE ARCHIVO Y NO UN SELECT SUELTO EN CADA ENDPOINT: durante
 * el retiro el conductor NO tiene asignación todavía, así que la política P3
 * de `operacion.pedidos` (el conductor ve solo los pedidos asignados a él) le
 * devuelve CERO filas por el camino normal. Resolverlo ampliando esa política
 * a "los de su tenant" filtraría el domicilio y el teléfono de los ~400
 * destinatarios del día a cada conductor — la peor regresión de privacidad
 * posible. La resolución va por endpoint Bearer con `service_role` que
 * devuelve este DTO mínimo, y punto: nunca `destinatario_nombre`,
 * `destinatario_direccion`, `destinatario_telefono`, `instrucciones_entrega`,
 * `lat`/`long`, `tracking_token`, `ml_order_id`, el título del producto, ni
 * nada de `bultos_retiro_qr`.
 *
 * ⚠️ NO TOCAR `pedidos_select`: hay un pgTAP que fija ese cero en piedra.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { FormatoCodigoBulto } from "./parser-codigo";

export interface PedidoRetiroDto {
  pedidoId: string;
  /** `ml_shipment_id` en Flex, `codigo_interno` en same-day — misma regla que la Torre. */
  codigoVisible: string;
  sellerNombre: string;
  /** Solo la comuna — nunca la dirección completa (minimización, mismo criterio que la Torre). */
  comuna: string;
  /** ¿El pedido es del MISMO seller que la bodega que se está visitando? */
  esDeEstaBodega: boolean;
  /** ¿Ya estaba `retirado` ANTES de este escaneo? (posible re-escaneo o traspaso). */
  yaRetirado: boolean;
  alerta: "cancelado" | "ya_retirado" | null;
}

/**
 * Qué columna de `operacion.pedidos` casa cada formato. Único lugar del
 * sistema que lo sabe: sumar una fuente nueva es agregar una entrada aquí, no
 * tocar el resto del flujo. `desconocido` queda deliberadamente sin entrada:
 * de un código que Rutax no entiende no hay nada contra qué buscar.
 */
const COLUMNA_BUSQUEDA_POR_FORMATO: Partial<
  Record<FormatoCodigoBulto, "ml_shipment_id" | "codigo_interno">
> = {
  flex_qr: "ml_shipment_id",
  // Tecleado a mano, pero es el MISMO shipment id: se busca contra la misma
  // columna. Sin esta entrada el código tecleado se guardaría sin encontrar
  // jamás su pedido — y en silencio, porque un formato sin entrada aquí es un
  // caso previsto (`desconocido`), no un error. Ese es exactamente el fallo mudo
  // que el ingreso manual vino a evitar.
  flex_manual: "ml_shipment_id",
  rutax_interno: "codigo_interno",
};

/** Columnas exactas que se leen de `operacion.pedidos` — lista cerrada, nunca `select *`. */
const COLUMNAS_PEDIDO_RETIRO =
  "id, ml_shipment_id, codigo_interno, seller_id, estado, situacion_retiro, destinatario_comuna";

interface FilaPedidoCruda {
  id: string;
  ml_shipment_id: string | null;
  codigo_interno: string | null;
  seller_id: string;
  estado: string;
  situacion_retiro: string;
  destinatario_comuna: string;
}

/** Resultado crudo de la búsqueda — sin nombre de seller ni contexto de bodega todavía. */
export interface PedidoCandidatoRetiro {
  pedidoId: string;
  codigoVisible: string;
  sellerId: string;
  comuna: string;
  estado: string;
  situacionRetiro: string;
}

function filaACandidato(fila: FilaPedidoCruda): PedidoCandidatoRetiro {
  return {
    pedidoId: fila.id,
    // Misma regla que la Torre (contexto/composer/index.ts:221).
    codigoVisible: fila.ml_shipment_id ?? fila.codigo_interno ?? "",
    sellerId: fila.seller_id,
    comuna: fila.destinatario_comuna,
    estado: fila.estado,
    situacionRetiro: fila.situacion_retiro,
  };
}

/**
 * Resuelve, EN LOTE, los pedidos que casan con un conjunto de códigos ya
 * parseados (una consulta por columna de búsqueda involucrada, nunca una por
 * ítem). Los códigos sin match, o de formato `desconocido`, simplemente no
 * aparecen en el Map devuelto — no es un error, es "candidato ajeno o
 * todavía no ingestado" (alcance §2.1).
 */
export async function buscarPedidosPorCodigos(
  cliente: SupabaseClient,
  tenantId: string,
  items: readonly { formato: FormatoCodigoBulto; codigoNormalizado: string }[],
): Promise<Map<string, PedidoCandidatoRetiro>> {
  const resultado = new Map<string, PedidoCandidatoRetiro>();

  const valoresPorColumna = new Map<"ml_shipment_id" | "codigo_interno", Set<string>>();
  for (const item of items) {
    const columna = COLUMNA_BUSQUEDA_POR_FORMATO[item.formato];
    if (!columna) continue;
    if (!valoresPorColumna.has(columna)) valoresPorColumna.set(columna, new Set());
    valoresPorColumna.get(columna)!.add(item.codigoNormalizado);
  }

  for (const [columna, valores] of valoresPorColumna) {
    if (valores.size === 0) continue;

    const { data, error } = await cliente
      .from("pedidos")
      .select(COLUMNAS_PEDIDO_RETIRO)
      .eq("tenant_id", tenantId)
      .in(columna, [...valores]);

    if (error) {
      throw new Error(`Error al resolver pedidos para retiro (${columna}): ${error.message}`);
    }

    for (const fila of ((data ?? []) as unknown as FilaPedidoCruda[])) {
      const clave = columna === "ml_shipment_id" ? fila.ml_shipment_id : fila.codigo_interno;
      if (clave) resultado.set(clave, filaACandidato(fila));
    }
  }

  return resultado;
}

/**
 * Resuelve pedidos POR ID (no por código) — la usa la vista de detalle de una
 * sesión de retiro, que ya conoce el `pedido_id` denormalizado en cada bulto
 * y necesita su estado ACTUAL (comuna, estado, situación de retiro pueden
 * haber cambiado desde el momento del escaneo).
 */
export async function buscarPedidosPorIds(
  cliente: SupabaseClient,
  tenantId: string,
  pedidoIds: readonly string[],
): Promise<Map<string, PedidoCandidatoRetiro>> {
  const resultado = new Map<string, PedidoCandidatoRetiro>();
  const unicos = [...new Set(pedidoIds)];
  if (unicos.length === 0) return resultado;

  const { data, error } = await cliente
    .from("pedidos")
    .select(COLUMNAS_PEDIDO_RETIRO)
    .eq("tenant_id", tenantId)
    .in("id", unicos);

  if (error) {
    throw new Error(`Error al resolver pedidos por id para retiro: ${error.message}`);
  }

  for (const fila of ((data ?? []) as unknown as FilaPedidoCruda[])) {
    resultado.set(fila.id, filaACandidato(fila));
  }
  return resultado;
}

/**
 * Nombre comercial de un conjunto de sellers, para enriquecer el DTO sin N+1
 * (una consulta para todo el lote, no una por pedido resuelto).
 */
export async function resolverNombresSellers(
  cliente: SupabaseClient,
  tenantId: string,
  sellerIds: readonly string[],
): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  const unicos = [...new Set(sellerIds)];
  if (unicos.length === 0) return mapa;

  const { data, error } = await cliente
    .from("sellers")
    .select("id, razon_social")
    .eq("tenant_id", tenantId)
    .in("id", unicos);

  if (error) {
    throw new Error(`Error al resolver nombres de sellers para retiro: ${error.message}`);
  }
  for (const fila of (data ?? []) as { id: string; razon_social: string }[]) {
    mapa.set(fila.id, fila.razon_social);
  }
  return mapa;
}

/**
 * Construye el DTO final — función PURA, sin I/O. `sellerIdBodega` es el
 * seller dueño de la bodega que se está visitando (de la sesión de retiro):
 * comparado contra el seller REAL del pedido resuelto, es lo que destapa un
 * bulto ajeno aparecido en la bodega equivocada.
 */
export function construirDtoPedidoRetiro(
  candidato: PedidoCandidatoRetiro,
  sellerNombre: string,
  sellerIdBodega: string,
): PedidoRetiroDto {
  const yaRetirado = candidato.situacionRetiro === "retirado";
  const alerta: PedidoRetiroDto["alerta"] =
    candidato.estado === "cancelado" ? "cancelado" : yaRetirado ? "ya_retirado" : null;

  return {
    pedidoId: candidato.pedidoId,
    codigoVisible: candidato.codigoVisible,
    sellerNombre,
    comuna: candidato.comuna,
    esDeEstaBodega: candidato.sellerId === sellerIdBodega,
    yaRetirado,
    alerta,
  };
}
