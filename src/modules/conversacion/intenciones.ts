/**
 * Enrutador de intenciones — §8 del documento de alcance. SIN IA, a propósito:
 * las cuatro reglas son deterministas y en este orden.
 *
 * 1. ¿Es una baja? NO se evalúa acá: `conversacion` no recibe el evento si
 *    `pideBaja === true` (lo impone la ausencia del evento — ver
 *    `EventoMensajeWhatsAppRecibido` en `src/lib/inngest/eventos.ts`).
 * 2. ¿Trae uno o más códigos? → el envoltorio de `parser.ts`. Hasta
 *    `TOPE_CODIGOS_POR_MENSAJE` se consultan; el resto se cuenta en
 *    `sobrante` y NUNCA se recorta en silencio (§ mejora "varios códigos").
 * 3. ¿Calza con una intención conocida? → hoy solo "retiro", normalizado
 *    igual que la baja (mayúsculas, sin tildes, sin puntuación).
 * 4. Nada calza → menú de botones. El fallo NUNCA es un «no te entendí» a secas.
 */

import { reconocerCodigosEnMensaje, type CodigoReconocido } from "./parser";

/**
 * Un mensaje con 5 códigos es UNA consulta, no cinco — el tope de abuso (§9)
 * cuenta mensajes entrantes, no códigos. Este tope es de "cuántos pedidos
 * respondemos en la misma respuesta", nada más.
 */
export const TOPE_CODIGOS_POR_MENSAJE = 5;

export type Intencion =
  | { tipo: "consulta_pedido"; codigos: CodigoReconocido[]; sobrante: number }
  | { tipo: "retiro_del_dia" }
  | { tipo: "menu" };

/** Marcas diacríticas combinantes que deja sueltas `normalize("NFD")`. */
const DIACRITICOS = /[̀-ͯ]/g;

/** Mayúsculas, sin tildes, sin puntuación, espacios colapsados — mismo criterio que `esSolicitudDeBaja`. */
function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(DIACRITICOS, "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Palabras con las que el seller pregunta por el retiro del día. */
const PALABRAS_RETIRO = new Set(["RETIRO", "RETIROS"]);

/** Cuántas palabras puede tener el mensaje para seguir contando como esa intención. */
const MAX_PALABRAS_INTENCION = 4;

function esIntencionRetiro(texto: string): boolean {
  const normalizado = normalizarTexto(texto);
  if (normalizado.length === 0) return false;

  const palabras = normalizado.split(" ");
  if (palabras.length > MAX_PALABRAS_INTENCION) return false;

  return palabras.some((p) => PALABRAS_RETIRO.has(p));
}

/**
 * Determina qué intención tiene el mensaje. Nunca lanza.
 *
 * `texto === null` (el mensaje no era de texto — audio, imagen, ubicación) cae
 * directo al menú: no hay nada que interpretar.
 */
export function determinarIntencion(texto: string | null): Intencion {
  if (!texto) return { tipo: "menu" };

  const codigos = reconocerCodigosEnMensaje(texto);
  if (codigos.length > 0) {
    return {
      tipo: "consulta_pedido",
      codigos: codigos.slice(0, TOPE_CODIGOS_POR_MENSAJE),
      sobrante: Math.max(0, codigos.length - TOPE_CODIGOS_POR_MENSAJE),
    };
  }

  if (esIntencionRetiro(texto)) return { tipo: "retiro_del_dia" };

  return { tipo: "menu" };
}
