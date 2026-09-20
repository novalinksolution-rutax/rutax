/**
 * Enrutador de intenciones — §8 del documento de alcance. SIN IA, a propósito:
 * las cuatro reglas son deterministas y en este orden.
 *
 * 1. ¿Es una baja? NO se evalúa acá: `conversacion` no recibe el evento si
 *    `pideBaja === true` (lo impone la ausencia del evento — ver
 *    `EventoMensajeWhatsAppRecibido` en `src/lib/inngest/eventos.ts`).
 * 2. ¿Trae uno o más códigos? → el envoltorio de `parser.ts`.
 * 3. ¿Calza con una intención conocida? → hoy solo "retiro", normalizado
 *    igual que la baja (mayúsculas, sin tildes, sin puntuación).
 * 4. Nada calza → menú de botones. El fallo NUNCA es un «no te entendí» a secas.
 */

import { primerCodigoReconocido, type CodigoReconocido } from "./parser";

export type Intencion =
  | { tipo: "consulta_pedido"; codigo: CodigoReconocido }
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

  const codigo = primerCodigoReconocido(texto);
  if (codigo) return { tipo: "consulta_pedido", codigo };

  if (esIntencionRetiro(texto)) return { tipo: "retiro_del_dia" };

  return { tipo: "menu" };
}
