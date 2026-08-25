/**
 * ¿Se puede imprimir la etiqueta de este pedido?
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * 🔴 EL PROBLEMA: EL BOTÓN PROMETÍA UNA DESCARGA QUE MERCADO LIBRE NO IBA A DAR
 * -----------------------------------------------------------------------------
 * `GET /shipment_labels` **solo entrega la etiqueta mientras el envío está en
 * `ready_to_ship` o `ready_to_print`**. En cuanto el bulto sale a la calle
 * —`shipped`— ML deja de servirla, y la respuesta es un error de la API que la
 * pantalla traducía a un 502 genérico: «no pudimos generar la etiqueta».
 *
 * O sea que el courier hacía clic, esperaba, y recibía un fallo que **no era un
 * fallo**: era el estado normal de un pedido que ya va en ruta. Lo que hay que
 * hacer no es manejar mejor ese error — es no ofrecer el botón.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ ESTO NO REEMPLAZA AL MANEJO DEL ERROR, LO COMPLEMENTA
 * -----------------------------------------------------------------------------
 * El estado que tenemos es el de la última sincronización, no el de este
 * segundo: un envío puede pasar a `shipped` en ML entre nuestro último sondeo y
 * el clic. Así que la ruta sigue manejando su 502 — lo que cambia es que deja
 * de ser el camino normal para convertirse en la carrera que de verdad es.
 *
 * -----------------------------------------------------------------------------
 * SAME-DAY NO TIENE ESTE PROBLEMA
 * -----------------------------------------------------------------------------
 * Su etiqueta la genera Rutax con su propio QR y **se puede regenerar siempre**.
 * Lo único que la limita es el estado terminal, y eso por sentido —no se
 * imprime la etiqueta de un pedido cancelado— no porque falle.
 */

/**
 * Los dos estados en que ML sirve la etiqueta.
 *
 * ⚠️ **Lista blanca, no lista negra.** Un estado de ML que no conozcamos
 * —porque lo agreguen mañana— tiene que caer en «no disponible»: ofrecer el
 * botón y fallar es peor que no ofrecerlo, porque el segundo caso el courier lo
 * entiende y el primero lo hace esperar.
 */
const ESTADOS_ML_CON_ETIQUETA: readonly string[] = ["ready_to_ship", "ready_to_print"];

export interface PedidoParaEtiqueta {
  /** `flex` | `same_day`. Decide qué etiqueta es. */
  tipoPedido: string;
  /** Solo Flex. Sin él, ML no tiene qué imprimir. */
  mlShipmentId: string | null;
  /** El estado del ENVÍO en ML, no el de la orden. */
  estadoMl: string | null;
  /** El estado interno de Rutax. */
  estado: string;
}

/** Los estados internos en que no tiene sentido imprimir nada. */
const TERMINALES: readonly string[] = [
  "entregado",
  "entregado_manual",
  "cancelado",
  "devuelto",
  "no_procesado",
];

export type MotivoSinEtiqueta =
  | "terminal"
  | "sin_envio_ml"
  | "ya_salio"
  | "todavia_no_esta_lista";

export type DisponibilidadEtiqueta =
  | { disponible: true }
  | { disponible: false; motivo: MotivoSinEtiqueta; frase: string };

export function disponibilidadEtiqueta(p: PedidoParaEtiqueta): DisponibilidadEtiqueta {
  if (TERMINALES.includes(p.estado)) {
    return {
      disponible: false,
      motivo: "terminal",
      frase: "Este pedido ya cerró: no hay etiqueta que imprimir.",
    };
  }

  // Same-day: la etiqueta es nuestra y siempre se puede regenerar.
  if (p.tipoPedido !== "flex") return { disponible: true };

  if (!p.mlShipmentId) {
    return {
      disponible: false,
      motivo: "sin_envio_ml",
      frase: "Mercado Libre todavía no creó el envío de este pedido.",
    };
  }

  if (p.estadoMl && ESTADOS_ML_CON_ETIQUETA.includes(p.estadoMl)) {
    return { disponible: true };
  }

  // ⚠️ Se distinguen los dos «no» porque la salida es distinta: si ya salió no
  // hay nada que hacer, y si todavía no está lista hay que esperar. Decir solo
  // «no disponible» deja al courier sin saber cuál de las dos es.
  const yaSalio = p.estadoMl !== null && p.estadoMl !== "handling" && p.estadoMl !== "pending";
  return yaSalio
    ? {
        disponible: false,
        motivo: "ya_salio",
        frase:
          "El bulto ya salió: Mercado Libre deja de entregar la etiqueta cuando el envío está en camino.",
      }
    : {
        disponible: false,
        motivo: "todavia_no_esta_lista",
        frase: "Mercado Libre todavía no la tiene lista. Vuelve a intentar en un rato.",
      };
}

/** Atajo para los sitios que solo necesitan saber si mostrar el botón. */
export function puedeImprimirEtiqueta(p: PedidoParaEtiqueta): boolean {
  return disponibilidadEtiqueta(p).disponible;
}
