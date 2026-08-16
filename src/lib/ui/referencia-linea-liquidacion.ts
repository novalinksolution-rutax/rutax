/**
 * Qué mostrar en la columna "Pedido" de una línea de liquidación.
 *
 * =============================================================================
 * POR QUÉ ES UN HELPER Y NO UN `?.` EN CADA PANTALLA
 * =============================================================================
 * Desde la etapa 8, una línea de liquidación puede colgar de una VISITA A
 * BODEGA en vez de un pedido, y su `pedidoId` es `null`. Cuatro lugares
 * mostraban ese id con `pedidoId.slice(0, 8)`:
 *
 * · el PDF de liquidación — y ahí no era cosmético. La excepción caía dentro
 *   del `try` del job, que solo hace `logger.error`, así que la liquidación
 *   quedaba en `borrador` PARA SIEMPRE, sin totales y sin documento. Es el
 *   papel con el que el conductor discute su plata.
 * · el detalle de la liquidación (Server Component → 500 en toda la pantalla).
 * · la ficha del conductor.
 * · las pantallas de cobro — esas quedan a salvo porque `lineas_cobro` no se
 *   tocó, pero comparten la forma.
 *
 * Un `?.` disperso en cada una habría resuelto el crash y dejado la pregunta de
 * producto sin responder: qué *dice* la fila de un retiro. Acá se responde una
 * sola vez.
 */

import type { LineaLiquidacion } from "@/modules/dinero/tipos";

export interface ReferenciaLinea {
  /** Texto de la celda. */
  etiqueta: string;
  /** Destino del enlace, o `null` si la fila no lleva a ninguna parte. */
  href: string | null;
  /** Texto largo para el `title`; `null` cuando la etiqueta se basta sola. */
  titulo: string | null;
}

export function referenciaLineaLiquidacion(
  linea: Pick<LineaLiquidacion, "pedidoId" | "tipoHecho">,
): ReferenciaLinea {
  if (linea.tipoHecho === "retiro_bodega") {
    return {
      // No se muestra el id de la visita: al coordinador no le dice nada y el
      // `concepto` de la línea ya trae la bodega y el seller en palabras.
      etiqueta: "Retiro en bodega",
      href: null,
      titulo: "Pago por visitar la bodega a retirar. No corresponde a un pedido.",
    };
  }

  // Defensa por si una línea de entrega llegara sin pedido: no debería pasar
  // —el CHECK `lineas_liq_hecho_coherente` lo prohíbe en la base— pero mostrar
  // un guion es infinitamente mejor que tumbar la pantalla o el PDF.
  if (!linea.pedidoId) {
    return { etiqueta: "—", href: null, titulo: "Línea sin pedido asociado." };
  }

  return {
    etiqueta: `#${linea.pedidoId.slice(0, 8)}…`,
    href: `/operaciones/${linea.pedidoId}`,
    titulo: linea.pedidoId,
  };
}
