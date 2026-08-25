/**
 * ¿Este pedido lo movimos nosotros?
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * EL PROBLEMA
 * -----------------------------------------------------------------------------
 * Los paneles muestran todos los pedidos que entran por cualquier fuente, con
 * sus estados. Pero **no todos los entrega el courier**: en Flex, Mercado Libre
 * puede despachar un envío con su propia logística, y ese pedido llega a
 * `entregado` en Rutax sin que nadie de la flota lo haya tocado nunca.
 *
 * Mezclado con los propios, ese pedido ensucia dos cosas a la vez: el conteo de
 * lo que hay que hacer hoy, y —peor— la lectura de «cómo nos fue», porque suma
 * entregas que no hicimos.
 *
 * -----------------------------------------------------------------------------
 * 🔴 SE MARCA, NO SE FILTRA — Y LA RAZÓN NO ES ESTÉTICA
 * -----------------------------------------------------------------------------
 * Decisión del usuario (25-08). Un filtro fijo por «tiene conductor o
 * manifiesto» **escondería el pedido recién ingestado, que es justo el que hay
 * que asignar**: todavía no tiene conductor porque nadie se lo ha dado. Un panel
 * que esconde lo que falta por hacer es peor que uno con ruido.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ Y LA MARCA SOLO APLICA A LO QUE YA TERMINÓ
 * -----------------------------------------------------------------------------
 * Un pedido pendiente **no es ajeno: es nuestro y todavía no asignado.** Marcarlo
 * como «no lo movimos nosotros» sería mentir sobre un pedido que está esperando
 * a que alguien lo tome.
 *
 * La marca es para el pedido que **llegó a un estado terminal sin que Rutax lo
 * tocara**: sin conductor, sin manifiesto y sin retiro nuestro. Ése sí lo
 * entregó —o lo canceló— otro, y decirlo es lo que evita contarlo como propio.
 */

/** Los estados de los que ya no se vuelve. */
const TERMINALES: readonly string[] = [
  "entregado",
  "entregado_manual",
  "cancelado",
  "devuelto",
  "no_procesado",
  "fallido",
  "fallido_manual",
];

export interface PedidoParaGestion {
  estado: string;
  /** Denormalizado por el trigger de asignación. `null` = nadie lo lleva. */
  driverIdAsignado: string | null;
  /** `retirado` cuando un conductor nuestro escaneó su bulto. */
  situacionRetiro: string | null;
}

/**
 * `true` cuando el pedido terminó sin que la flota lo tocara.
 *
 * ⚠️ **Las tres condiciones son un `y`, no un `o`.** Basta una huella —un
 * conductor asignado alguna vez, un retiro escaneado— para que el pedido sea
 * nuestro, aunque después se haya caído o reasignado. Marcar como ajeno algo
 * que un conductor sí cargó en su van es peor que no marcar nada: le borra el
 * trabajo a alguien.
 */
export function loEntregoOtro(p: PedidoParaGestion): boolean {
  if (!TERMINALES.includes(p.estado)) return false;
  if (p.driverIdAsignado !== null) return false;
  if (p.situacionRetiro === "retirado") return false;
  return true;
}

/**
 * La frase que acompaña la marca.
 *
 * Dice **el hecho y su consecuencia**, no una categoría: «no pasó por tu flota»
 * explica por qué está en gris; «no cuenta en tus entregas» es lo que la persona
 * necesita saber para no sumarlo.
 */
export const FRASE_ENTREGO_OTRO =
  "No pasó por tu flota: no lo asignaste ni lo retiraste, así que no cuenta como entrega tuya.";

/** Rótulo corto, para la celda. */
export const ETIQUETA_ENTREGO_OTRO = "Ajeno";
