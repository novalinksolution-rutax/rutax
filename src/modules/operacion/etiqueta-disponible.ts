/**
 * ¿Se puede imprimir la etiqueta de este pedido?
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * 🔴 DOS ERRORES SEGUIDOS, Y EL SEGUNDO FUE MÍO
 * -----------------------------------------------------------------------------
 * **Primero:** el botón se mostraba siempre. En cuanto el bulto salía a la calle
 * ML dejaba de servir la etiqueta, el courier hacía clic, esperaba, y recibía un
 * 502 genérico por lo que era el estado normal de un pedido en ruta.
 *
 * **Después, arreglándolo, me pasé al otro lado:** puse una **lista blanca** de
 * `ready_to_ship`/`ready_to_print` razonando que un estado desconocido debía
 * caer en «no disponible». Producción lo desmintió el 25-ago-2026, y con
 * números: de los 8 pedidos Flex pendientes del día, **5 estaban en `handling`**
 * —fuera de la lista, o sea con el botón escondido— y al pedirle la etiqueta a
 * ML por la ruta directa, **ML la entregó sin chistar**. El 62% de lo que había
 * que despachar ese día tenía etiqueta y no se podía imprimir.
 *
 * Y encima la regla no se callaba: clasificaba ese caso como «todavía no está
 * lista, vuelve a intentar en un rato», que era **falso**.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ AHORA ES AL REVÉS: LISTA DE LO QUE ML **NIEGA**
 * -----------------------------------------------------------------------------
 * El razonamiento de la lista blanca —«ante la duda, no ofrecer»— asumía que los
 * dos errores costaban parecido. No es así, y la operación real lo mostró:
 *
 * · **Esconder un botón que funciona bloquea el despacho.** El courier no tiene
 *   forma de imprimir ni de saber por qué, y no hay camino alternativo.
 * · **Ofrecer uno que falla cuesta un clic y un mensaje.** `BotonDescargarEtiqueta`
 *   muestra en línea el error que devuelve el backend, así que la persona lee lo
 *   que pasó y sigue.
 *
 * Entonces solo se esconde donde **sabemos** que ML no la da. Todo lo demás
 * —incluido un estado que ML invente mañana— se ofrece, y que conteste ML.
 *
 * ⚠️ **Esto NO reemplaza el manejo del error, lo necesita.** El estado que
 * tenemos es el de la última sincronización, no el de este segundo: un envío
 * puede pasar a `shipped` entre nuestro sondeo y el clic. La ruta sigue
 * manejando su fallo; lo que cambia es que ya no es el camino normal.
 *
 * -----------------------------------------------------------------------------
 * SAME-DAY NO TIENE ESTE PROBLEMA
 * -----------------------------------------------------------------------------
 * Su etiqueta la genera Rutax con su propio QR y **se puede regenerar siempre**.
 * Lo único que la limita es el estado terminal, y eso por sentido —no se imprime
 * la etiqueta de un pedido cancelado— no porque falle.
 */

/**
 * Los estados de ML en los que la etiqueta ya NO se puede pedir.
 *
 * ⚠️ **Lista de negados, no de permitidos, y es deliberado** (ver arriba). Son
 * los estados en que el envío ya dejó las manos del seller: `/shipment_labels`
 * responde error y no hay nada que reintentar.
 *
 * ⚠️ **`handling` NO está acá, y ese es el punto entero del cambio.** Verificado
 * contra producción: ML entrega la etiqueta de un envío en `handling`. Volver a
 * meterlo reintroduce el bug.
 */
const ESTADOS_ML_SIN_ETIQUETA: readonly string[] = [
  "shipped",
  "delivered",
  "not_delivered",
  "cancelled",
];

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

export type MotivoSinEtiqueta = "terminal" | "sin_envio_ml" | "ya_salio";

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

  if (p.estadoMl && ESTADOS_ML_SIN_ETIQUETA.includes(p.estadoMl)) {
    return {
      disponible: false,
      motivo: "ya_salio",
      frase:
        "El bulto ya salió: Mercado Libre deja de entregar la etiqueta cuando el envío está en camino.",
    };
  }

  // Todo lo demás se ofrece: `handling`, `ready_to_ship`, un `estado_ml` que
  // todavía no sincronizamos (null) y cualquier estado que ML agregue después.
  // Si ML dice que no, el botón muestra su mensaje.
  return { disponible: true };
}

/** Atajo para los sitios que solo necesitan saber si mostrar el botón. */
export function puedeImprimirEtiqueta(p: PedidoParaEtiqueta): boolean {
  return disponibilidadEtiqueta(p).disponible;
}
