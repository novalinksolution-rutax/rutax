/**
 * Webhook de Resend — verificación de firma y normalización del evento.
 * =============================================================================
 * Resend firma sus webhooks con **Svix**, un esquema distinto del de Fintoc y
 * del de Mercado Libre (que directamente no firma). Se implementa a mano en vez
 * de sumar la dependencia `svix`: son ~30 líneas de HMAC y el proyecto ya tiene
 * el mismo patrón hecho para Fintoc.
 *
 * ESQUEMA SVIX (los tres headers son obligatorios):
 *   svix-id         identificador único del intento de entrega
 *   svix-timestamp  epoch en SEGUNDOS
 *   svix-signature  una o más firmas separadas por espacio: `v1,<base64> v1,<base64>`
 *                   (hay varias durante una rotación de secreto — basta que UNA calce)
 *
 * El contenido firmado es `{svix-id}.{svix-timestamp}.{cuerpoCrudo}` y la clave
 * es el secreto SIN el prefijo `whsec_`, decodificado de base64.
 *
 * ANTI-REPLAY: se rechaza un timestamp fuera de ±5 min (la tolerancia que usa
 * Svix). Sin esto, capturar una petición válida permitiría re-enviarla para
 * siempre.
 *
 * REGLAS DE DEPENDENCIAS (hoja del grafo): solo Node crypto y tipos propios.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** Tolerancia anti-replay, en segundos. Mismo valor que usa Svix. */
const TOLERANCIA_SEGUNDOS = 5 * 60;

export interface VerificarFirmaResendInput {
  /** Cuerpo CRUDO de la request (los bytes exactos, sin re-serializar). */
  cuerpoCrudo: string;
  svixId: string;
  svixTimestamp: string;
  svixSignature: string;
  /** Secreto del endpoint, con o sin el prefijo `whsec_`. */
  secreto: string;
  /** Inyectable para pruebas; por defecto, ahora. Epoch en SEGUNDOS. */
  ahoraSegundos?: number;
}

/** Comparación en tiempo constante, tolerante a largos distintos. */
function igualesEnTiempoConstante(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * `true` sii alguna de las firmas del header calza y el timestamp está dentro
 * de la tolerancia. Cualquier ausencia, formato raro o error de decodificación
 * devuelve `false` — nunca lanza: un webhook malformado no debe tumbar la ruta.
 */
export function verificarFirmaWebhookResend(input: VerificarFirmaResendInput): boolean {
  try {
    const { cuerpoCrudo, svixId, svixTimestamp, svixSignature, secreto } = input;
    if (!cuerpoCrudo || !svixId || !svixTimestamp || !svixSignature || !secreto) {
      return false;
    }

    // Anti-replay.
    const ts = Number.parseInt(svixTimestamp, 10);
    if (!Number.isFinite(ts)) return false;
    const ahora = input.ahoraSegundos ?? Math.floor(Date.now() / 1000);
    if (Math.abs(ahora - ts) > TOLERANCIA_SEGUNDOS) return false;

    // La clave es el secreto SIN prefijo, decodificado de base64.
    const secretoSinPrefijo = secreto.startsWith("whsec_") ? secreto.slice("whsec_".length) : secreto;
    const clave = Buffer.from(secretoSinPrefijo, "base64");
    if (clave.length === 0) return false;

    const contenidoFirmado = `${svixId}.${svixTimestamp}.${cuerpoCrudo}`;
    const esperada = createHmac("sha256", clave).update(contenidoFirmado, "utf8").digest("base64");

    // El header puede traer varias firmas (rotación de secreto): basta una.
    for (const entrada of svixSignature.split(" ")) {
      const [version, valor] = entrada.split(",");
      if (version !== "v1" || !valor) continue;
      if (igualesEnTiempoConstante(valor, esperada)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

// -----------------------------------------------------------------------------
// Normalización del evento
// -----------------------------------------------------------------------------

/** Estados de entrega que este sistema entiende. Espeja el CHECK de la BD. */
export type EstadoEntregaEmail = "entregado" | "rebotado" | "marcado_spam";

export interface EventoEntregaEmail {
  /** Id del mensaje en el proveedor — la clave para encontrar la invitación. */
  proveedorId: string;
  estado: EstadoEntregaEmail;
  /** Descripción saneada, o `null` si el proveedor no la trae. */
  motivo: string | null;
}

/** Solo estos tres tipos mueven el estado; el resto (`email.sent`, `email.opened`,
 *  `email.clicked`) se ignora deliberadamente: no aportan nada accionable y
 *  seguir aperturas es rastreo del destinatario que nadie pidió. */
const MAPA_TIPOS: Record<string, EstadoEntregaEmail> = {
  "email.delivered": "entregado",
  "email.bounced": "rebotado",
  "email.complained": "marcado_spam",
};

/** Recorta y sanea el motivo — nunca dejamos entrar un texto sin límite. */
function sanearMotivo(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const limpio = valor.trim().replace(/\s+/g, " ").slice(0, 300);
  return limpio.length > 0 ? limpio : null;
}

/**
 * Extrae lo mínimo accionable del payload. Devuelve `null` si el evento no es
 * uno de los tres que nos interesan o si le falta el id del mensaje — en ambos
 * casos el llamador responde 200 e ignora (un 4xx haría que Resend reintente
 * eternamente un evento que nunca vamos a querer).
 */
export function normalizarEventoWebhookResend(payload: unknown): EventoEntregaEmail | null {
  if (typeof payload !== "object" || payload === null) return null;
  const raiz = payload as Record<string, unknown>;

  const estado = typeof raiz.type === "string" ? MAPA_TIPOS[raiz.type] : undefined;
  if (!estado) return null;

  const datos = (raiz.data ?? {}) as Record<string, unknown>;
  const proveedorId = typeof datos.email_id === "string" ? datos.email_id : null;
  if (!proveedorId) return null;

  // Resend acomoda la razón en distintos lugares según el tipo de evento.
  const bounce = (datos.bounce ?? {}) as Record<string, unknown>;
  const motivo =
    sanearMotivo(bounce.message) ??
    sanearMotivo(bounce.subType) ??
    sanearMotivo(bounce.type) ??
    sanearMotivo(datos.reason);

  return { proveedorId, estado, motivo };
}
