/**
 * Webhook de WhatsApp — verificación del handshake y de la firma.
 * =============================================================================
 * Meta usa un esquema propio, distinto del de Svix (Resend) y del de Fintoc, y
 * distinto de ML —que directamente no firma—:
 *
 *   · **Handshake (GET)**: Meta llama una vez con `hub.mode=subscribe`,
 *     `hub.verify_token` y `hub.challenge`. Hay que devolver el challenge **en
 *     texto plano** si el token calza. Un JSON acá hace fallar la verificación
 *     con un mensaje que no explica nada.
 *
 *   · **Eventos (POST)**: header `X-Hub-Signature-256: sha256=<hex>`, que es un
 *     HMAC-SHA256 del **cuerpo crudo** con el **App Secret** como clave.
 *
 * ⚠️ NO HAY ANTI-REPLAY. A diferencia de Svix y Fintoc, Meta no firma un
 * timestamp, así que no hay nada contra qué comprobar la frescura: una petición
 * capturada se puede reproducir indefinidamente y la firma seguirá siendo
 * válida. Eso NO se puede arreglar desde acá — se acota aguas abajo haciendo
 * que reproducir un evento sea inofensivo: los acuses solo avanzan el estado
 * (nunca lo retroceden) y son idempotentes por `meta_message_id`.
 *
 * REGLAS DE DEPENDENCIAS (hoja del grafo): solo Node crypto.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** Comparación en tiempo constante, tolerante a largos distintos. */
function igualesEnTiempoConstante(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export interface VerificarFirmaWhatsAppInput {
  /** Cuerpo CRUDO de la request: los bytes exactos, sin re-serializar. */
  cuerpoCrudo: string;
  /** Contenido del header `X-Hub-Signature-256` (con el prefijo `sha256=`). */
  cabeceraFirma: string;
  /** App Secret de la app de Meta. */
  appSecret: string;
}

/**
 * `true` sii la firma del header calza con el HMAC del cuerpo.
 *
 * Nunca lanza: un webhook malformado no debe tumbar la ruta. Cualquier
 * ausencia, formato raro o error de decodificación devuelve `false`.
 */
export function verificarFirmaWebhookWhatsApp(input: VerificarFirmaWhatsAppInput): boolean {
  try {
    const { cuerpoCrudo, cabeceraFirma, appSecret } = input;
    if (!cuerpoCrudo || !cabeceraFirma || !appSecret) return false;

    // El header viene SIEMPRE como `sha256=<hex>`. Se exige el prefijo en vez
    // de tolerar el hex pelado: aceptar ambas formas abriría la puerta a que un
    // cliente mande un algoritmo distinto y nosotros lo comparemos igual.
    if (!cabeceraFirma.startsWith("sha256=")) return false;
    const firmaRecibida = cabeceraFirma.slice("sha256=".length).trim().toLowerCase();
    if (firmaRecibida.length === 0) return false;

    const esperada = createHmac("sha256", appSecret).update(cuerpoCrudo, "utf8").digest("hex");

    return igualesEnTiempoConstante(firmaRecibida, esperada);
  } catch {
    return false;
  }
}

export interface VerificarHandshakeInput {
  /** `hub.mode` de la query string. */
  modo: string | null;
  /** `hub.verify_token` de la query string. */
  token: string | null;
  /** `hub.challenge` de la query string. */
  challenge: string | null;
  /** El valor esperado (`WHATSAPP_VERIFY_TOKEN`). */
  tokenEsperado: string;
}

/**
 * Resuelve el handshake de verificación del webhook.
 *
 * Devuelve el challenge a devolver EN TEXTO PLANO, o `null` si la petición no
 * es un handshake válido (y entonces el llamador responde 403, que es lo que
 * Meta espera).
 *
 * La comparación del token es en tiempo constante: es un secreto compartido y
 * compararlo con `===` filtra su largo y su prefijo por temporización.
 */
export function resolverHandshakeWebhook(input: VerificarHandshakeInput): string | null {
  const { modo, token, challenge, tokenEsperado } = input;

  if (!tokenEsperado) return null;
  if (modo !== "subscribe") return null;
  if (!token || !challenge) return null;
  if (!igualesEnTiempoConstante(token, tokenEsperado)) return null;

  return challenge;
}
