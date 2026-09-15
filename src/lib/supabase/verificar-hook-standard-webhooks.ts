/**
 * Verificación de firma de los Auth Hooks de Supabase (Standard Webhooks).
 * =============================================================================
 * Supabase firma sus Auth Hooks HTTPS —entre ellos el **Send SMS Hook**— con el
 * esquema **Standard Webhooks** (el mismo de Svix; ver `webhook-resend.ts`, que
 * ya lo implementa para Resend). Los tres headers son obligatorios y llevan el
 * prefijo `webhook-` (NO `svix-`):
 *
 *   webhook-id         identificador único del intento de entrega
 *   webhook-timestamp  epoch en SEGUNDOS
 *   webhook-signature  una o más firmas separadas por espacio:
 *                      `v1,<base64> v1,<base64>` — hay varias durante una
 *                      rotación de secreto; basta que UNA calce.
 *
 * El contenido firmado es `{webhook-id}.{webhook-timestamp}.{cuerpoCrudo}` y la
 * clave del HMAC-SHA256 es el secreto SIN el prefijo `whsec_` (y sin el `v1,`
 * que Supabase antepone en el panel), decodificado de base64.
 *
 * Se implementa a mano en vez de sumar la dependencia `standardwebhooks`: son
 * ~30 líneas y el repo ya tiene el patrón idéntico para Resend y Fintoc.
 *
 * ANTI-REPLAY: se rechaza un timestamp fuera de ±5 min (la tolerancia de la
 * spec). Sin esto, capturar una petición válida permitiría re-enviarla para
 * siempre.
 *
 * Doc oficial: https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook
 * Spec: https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md
 *
 * REGLAS DE DEPENDENCIAS (hoja del grafo): solo Node crypto.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** Tolerancia anti-replay, en segundos. Mismo valor que la spec de Standard Webhooks. */
const TOLERANCIA_SEGUNDOS = 5 * 60;

export interface VerificarFirmaHookInput {
  /** Cuerpo CRUDO de la request (los bytes exactos, sin re-serializar). */
  cuerpoCrudo: string;
  /** Header `webhook-id`. */
  webhookId: string | null;
  /** Header `webhook-timestamp` (epoch en segundos). */
  webhookTimestamp: string | null;
  /** Header `webhook-signature` (una o más firmas `v1,<base64>`). */
  webhookSignature: string | null;
  /** Secreto del hook, con o sin el prefijo `v1,whsec_` / `whsec_`. */
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
 * `true` sii alguna de las firmas del header calza y el timestamp está dentro de
 * la tolerancia. Cualquier ausencia, formato raro o error de decodificación
 * devuelve `false` — nunca lanza: un webhook malformado no debe tumbar la ruta.
 */
export function verificarFirmaHookSupabase(input: VerificarFirmaHookInput): boolean {
  try {
    const { cuerpoCrudo, webhookId, webhookTimestamp, webhookSignature, secreto } = input;
    if (!cuerpoCrudo || !webhookId || !webhookTimestamp || !webhookSignature || !secreto) {
      return false;
    }

    // Anti-replay.
    const ts = Number.parseInt(webhookTimestamp, 10);
    if (!Number.isFinite(ts)) return false;
    const ahora = input.ahoraSegundos ?? Math.floor(Date.now() / 1000);
    if (Math.abs(ahora - ts) > TOLERANCIA_SEGUNDOS) return false;

    // La clave es el secreto SIN prefijo, decodificado de base64. Supabase lo
    // muestra en el panel como `v1,whsec_<base64>`; toleramos ambas formas.
    let secretoSinPrefijo = secreto.startsWith("v1,") ? secreto.slice("v1,".length) : secreto;
    if (secretoSinPrefijo.startsWith("whsec_")) {
      secretoSinPrefijo = secretoSinPrefijo.slice("whsec_".length);
    }
    const clave = Buffer.from(secretoSinPrefijo, "base64");
    if (clave.length === 0) return false;

    const contenidoFirmado = `${webhookId}.${webhookTimestamp}.${cuerpoCrudo}`;
    const esperada = createHmac("sha256", clave).update(contenidoFirmado, "utf8").digest("base64");

    // El header puede traer varias firmas (rotación de secreto): basta una.
    for (const entrada of webhookSignature.split(" ")) {
      const [version, valor] = entrada.split(",");
      if (version !== "v1" || !valor) continue;
      if (igualesEnTiempoConstante(valor, esperada)) return true;
    }
    return false;
  } catch {
    return false;
  }
}
