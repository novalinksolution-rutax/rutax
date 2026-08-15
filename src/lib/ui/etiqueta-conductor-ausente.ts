/**
 * Qué decir en la columna CONDUCTOR cuando un pedido no tiene conductor.
 *
 * =============================================================================
 * POR QUÉ NO ALCANZA CON "SIN ASIGNAR"
 * =============================================================================
 * "Sin asignar" en ámbar es un aviso de que FALTA algo por hacer. En un pedido
 * que ya terminó eso es sencillamente falso: nadie va a asignarlo nunca.
 *
 * Peor todavía en un Flex entregado, que es donde se vio en producción el
 * 2026-08-15: el paquete LLEGÓ. Solo que no lo llevó un conductor del courier
 * —el seller lo despachó por su cuenta, o lo repartió otro, y Mercado Envíos
 * nos informó el estado final—. La columna tiene que responder "quién lo
 * llevó", no "qué te falta".
 *
 * =============================================================================
 * TRES LECTURAS, Y LA DIFERENCIA IMPORTA
 * =============================================================================
 * · vivo, sin conductor      → "Sin asignar", ámbar. Sigue siendo acción.
 * · entregado, sin conductor → "Fuera de Rutax". Se entregó, no fuimos
 *                              nosotros. Que no genere liquidación es correcto:
 *                              no hay a quién pagarle.
 * · terminó sin entregarse   → un guion. Cancelado o devuelto sin conductor no
 *                              lo llevó NADIE, y decir "fuera de Rutax" ahí
 *                              afirmaría una entrega que no ocurrió.
 *
 * `fallido` NO cuenta como terminal acá, a propósito: no está en
 * `ESTADOS_TERMINALES` porque sí admite transición —se puede reintentar— así
 * que sigue mereciendo el ámbar. La lista se importa de `operacion/tipos` en
 * vez de reescribirse: es exactamente la clase de lista espejo que se
 * desincroniza sin que nada falle.
 */

import { ESTADOS_TERMINALES, type EstadoPedido } from "@/modules/operacion/tipos";

export interface EtiquetaConductorAusente {
  texto: string;
  /** `pendiente` se pinta en ámbar (hay acción); `neutro` en gris (no la hay). */
  tono: "pendiente" | "neutro";
  /** Explicación para el `title`; `null` cuando el texto se basta solo. */
  detalle: string | null;
}

export function etiquetaConductorAusente(estado: EstadoPedido): EtiquetaConductorAusente {
  if (!ESTADOS_TERMINALES.includes(estado)) {
    return { texto: "Sin asignar", tono: "pendiente", detalle: null };
  }

  if (estado === "entregado" || estado === "entregado_manual") {
    return {
      texto: "Fuera de Rutax",
      tono: "neutro",
      detalle:
        "Se entregó sin pasar por Rutax: ningún conductor tuyo lo tomó. En Flex el estado lo informa Mercado Envíos.",
    };
  }

  return {
    texto: "—",
    tono: "neutro",
    detalle: "Terminó sin que ningún conductor lo tomara.",
  };
}
