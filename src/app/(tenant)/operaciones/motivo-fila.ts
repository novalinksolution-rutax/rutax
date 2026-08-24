/**
 * El motivo de una fila: por qué este pedido está como está.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * ⚠️ LA COLUMNA «MOTIVO» NO ERA LO QUE EL TABLERO DIBUJA
 * -----------------------------------------------------------------------------
 * En el código, «Motivo» mostraba **solo los distintivos de geocodificación** —
 * dirección no ubicada, fuera de cobertura, sin tarifa de zona—. En el tablero,
 * las dos filas que llevan motivo son otras: un «No entregado · Nadie recibió» y
 * un «Cancelado · Seller canceló».
 *
 * Son tres fuentes distintas para una misma pregunta, y la columna tiene que
 * contestarla entera:
 *
 * · **cancelado** → el motivo que escribió quien canceló (`motivo_cancelacion`,
 *   obligatorio y de ≥10 caracteres, así que siempre hay texto).
 * · **con incidencia abierta** → el tipo de la incidencia («Destinatario
 *   ausente»), que es el «nadie recibió» del tablero dicho con la palabra que ya
 *   usa el resto del producto.
 * · **problema de dirección** → los distintivos de geo, como antes.
 *
 * El orden importa y no es alfabético: **se responde el problema más terminal
 * primero**. Un pedido cancelado con la dirección mal ubicada ya no se va a
 * entregar, así que decir «Fuera de cobertura» sería contestar la pregunta de
 * ayer.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ ESTO VIVE APARTE Y NO DENTRO DE LA CELDA
 * -----------------------------------------------------------------------------
 * Lo usan **dos** superficies con formas distintas: la celda de escritorio, que
 * lo pinta como distintivos, y la ficha de teléfono, que lo pone como texto en
 * la línea monoespaciada cuando la columna se cayó. Si la regla viviera dentro
 * de una de las dos, la otra la reimplementaría —y se separarían el día que
 * alguien agregue un cuarto caso.
 */

import type { Pedido, TipoIncidencia } from "@/modules/operacion/tipos";
import {
  traducirCoberturaEstado,
  traducirGeoEstado,
  traducirTipoIncidencia,
} from "@/lib/ui/traduccion-estados";

export type OrigenMotivo = "cancelacion" | "incidencia" | "geo" | "cobertura";

export interface MotivoFila {
  /** De dónde salió, para decidir el tono con que se pinta. */
  origen: OrigenMotivo;
  /** Ya legible en español. */
  texto: string;
}

/**
 * El motivo de este pedido, o `null` si no hay ninguno que contar.
 *
 * `tipoIncidencia` es el de la incidencia **abierta o en gestión** más reciente;
 * una incidencia ya resuelta no es un motivo del presente.
 */
export function motivoDeFila(
  pedido: Pick<Pedido, "estado" | "motivoCancelacion" | "geoEstado" | "coberturaEstado">,
  tipoIncidencia?: TipoIncidencia | null,
): MotivoFila | null {
  // 1 · Cancelado gana siempre: es el estado terminal y su motivo es obligatorio.
  if (pedido.estado === "cancelado") {
    const escrito = pedido.motivoCancelacion?.trim();
    return { origen: "cancelacion", texto: escrito || "Cancelado sin motivo registrado" };
  }

  // 2 · Una incidencia viva explica por qué no se entregó, que es lo que el
  //     coordinador está buscando cuando barre la columna.
  if (tipoIncidencia) {
    return { origen: "incidencia", texto: traducirTipoIncidencia(tipoIncidencia) };
  }

  // 3 · Y si no, el problema de dirección, que es el que impide salir a ruta.
  if (pedido.geoEstado === "no_resuelto" || pedido.geoEstado === "fuera_cobertura") {
    return { origen: "geo", texto: traducirGeoEstado(pedido.geoEstado) };
  }
  if (
    pedido.coberturaEstado === "sin_tarifa_zona" ||
    pedido.coberturaEstado === "requiere_revision"
  ) {
    return { origen: "cobertura", texto: traducirCoberturaEstado(pedido.coberturaEstado) };
  }

  return null;
}

/**
 * La línea monoespaciada que va **bajo el destinatario** y recupera lo que se
 * cayó al angostarse la pantalla.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ EL SELLER NO ENTRA, Y ES DELIBERADO
 * -----------------------------------------------------------------------------
 * La regla del tablero dice que las cuatro columnas que caen «reaparecen bajo el
 * destinatario», y nombra al seller entre ellas. Pero **ninguno de los dos
 * dibujos —ni el de tablet ni el de teléfono— lo pone ahí**: la tablet muestra
 * `RX-7K2M-9PQR · Ñuñoa` y el teléfono `RX-7K2M-9PQR · Ñuñoa · R. Muñoz`.
 *
 * Se sigue el dibujo, y la razón sostiene la decisión: **el seller es un eje de
 * filtro, no un identificador de fila**. Nadie barre cincuenta filas leyendo de
 * qué seller es cada una; se filtra por seller y se mira el resto. Meterlo haría
 * de cuatro elementos una línea de teléfono que el dibujo resolvió con tres.
 *
 * La comuna cede el sitio al motivo cuando lo hay: si un pedido no se entregó,
 * saber por qué manda sobre saber dónde.
 */
export function lineaSecundaria(campos: {
  codigo: string | null;
  comuna: string | null;
  /** Solo cuando la columna CONDUCTOR se cayó. */
  conductor?: string | null;
  motivo?: MotivoFila | null;
}): string[] {
  const partes: string[] = [];
  if (campos.codigo) partes.push(campos.codigo);
  if (campos.motivo) partes.push(campos.motivo.texto);
  else if (campos.comuna) partes.push(campos.comuna);
  if (campos.conductor) partes.push(campos.conductor);
  return partes;
}

/**
 * `Francisco Javier Castro López` → `F. Castro`.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ SE ABREVIA EL CONDUCTOR Y NO EL DESTINATARIO
 * -----------------------------------------------------------------------------
 * En la ficha de 390 px la línea de abajo lleva tres cosas y el nombre completo
 * del conductor se come el resto: medido con datos reales, quedaba
 * `RX-BARR-0008 · Peñalolén · Francisco…` — o sea, **el conductor desaparecía**.
 * Truncado no informa de nada; abreviado sí.
 *
 * ⚠️ **Al destinatario NO se le toca.** Es el nombre con el que se confirma una
 * entrega en la puerta y con el que se busca, y el escritorio lo muestra entero:
 * abreviarlo solo en el teléfono haría que la misma fila se llamara distinto
 * según el aparato. El tablero lo dibuja abreviado; acá pesa más que las dos
 * superficies digan lo mismo.
 *
 * Se toma **la primera palabra como nombre y la siguiente como apellido**, que
 * es lo que funciona en Chile: `Francisco Javier Castro López` es nombre
 * compuesto + dos apellidos, y el apellido que se usa al hablar es el primero.
 */
export function nombreCortoConductor(nombre: string | null | undefined): string | null {
  const partes = (nombre ?? "").trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return null;
  if (partes.length === 1) return partes[0];
  // Con dos palabras ya está corto: `Rodrigo Muñoz` no gana nada como `R. Muñoz`
  // si cabe entero. Se abrevia desde tres, que es cuando estorba.
  if (partes.length === 2) return partes.join(" ");
  const apellido = partes.length >= 4 ? partes[2] : partes[1];
  return `${partes[0].charAt(0).toUpperCase()}. ${apellido}`;
}
