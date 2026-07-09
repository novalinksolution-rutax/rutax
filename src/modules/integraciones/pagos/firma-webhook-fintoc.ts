/**
 * Verificación de firma de webhooks entrantes de Fintoc — FUENTE ÚNICA.
 * =============================================================================
 *
 * Esquema de firma `Fintoc-Signature` (VERIFICADO CONTRA DOC OFICIAL, jul 2026):
 * https://docs.fintoc.com/docs/webhooks-validating
 *  - Header `Fintoc-Signature`, formato `t=<unix_ts>,v1=<hmac_hex>`.
 *  - Mensaje firmado = `"<timestamp>.<raw_body>"` (el timestamp del header + '.'
 *    + el cuerpo CRUDO de la request, NO el JSON re-serializado).
 *  - HMAC-SHA256 con el secreto del Webhook Endpoint; digest en hex.
 *  - Tolerancia anti-replay recomendada por la doc: 5 min (300 s).
 *  - Comparación de tiempo constante (`timingSafeEqual`) para no filtrar la firma
 *    esperada vía timing.
 *
 * Este módulo es DELIBERADAMENTE agnóstico del origen del secreto: sirve tanto al
 * webhook de COBRANZA (secreto POR-TENANT) como al de PAYOUT saliente (secreto de
 * ORG). El llamador resuelve QUÉ secreto usar; la matemática de verificación es la
 * misma. Así el código de firma vive en un solo lugar (no se duplica por flujo).
 *
 * SEGURIDAD: el secreto NUNCA se loguea ni entra en el resultado. La función solo
 * devuelve `true`/`false` — jamás lanza con el secreto en el mensaje.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Tolerancia anti-replay del timestamp del webhook, en segundos. Default del SDK
 * oficial de Fintoc y recomendación de la doc (5 minutos). Un evento con
 * timestamp fuera de `±TOLERANCIA_FIRMA_SEGUNDOS` respecto de ahora se rechaza.
 */
export const TOLERANCIA_FIRMA_SEGUNDOS = 300;

export interface VerificarFirmaWebhookFintocArgs {
  /**
   * Cuerpo CRUDO de la request (bytes tal cual llegaron, como string UTF-8). La
   * firma se calcula sobre el raw body — re-serializar el JSON rompería la firma.
   */
  cuerpoCrudo: string;
  /** Valor del header `Fintoc-Signature` (formato `t=<ts>,v1=<hex>`). */
  firmaHeader: string;
  /** Secreto del Webhook Endpoint, YA DESCIFRADO. NUNCA se loguea ni va en errores. */
  secreto: string;
}

/**
 * Verifica la firma `Fintoc-Signature` sobre `<timestamp>.<cuerpoCrudo>` con
 * HMAC-SHA256 y el `secreto`. Devuelve `true` si la firma calza Y el timestamp
 * está dentro de la tolerancia anti-replay; `false` en cualquier otro caso
 * (header ausente/malformado, timestamp fuera de ventana, firma que no cuadra).
 *
 * NO lanza: cualquier entrada inválida cae a `false` (fail-closed).
 */
export function verificarFirmaWebhookFintoc(args: VerificarFirmaWebhookFintocArgs): boolean {
  const partes = parsearHeaderFirma(args.firmaHeader);
  if (!partes) return false;
  const { timestamp, firmaRecibida } = partes;

  // Anti-replay: el timestamp del header debe estar dentro de la tolerancia.
  const ahoraSeg = Math.floor(Date.now() / 1000);
  if (Math.abs(ahoraSeg - timestamp) > TOLERANCIA_FIRMA_SEGUNDOS) return false;

  // Mensaje firmado = "<timestamp>.<raw_body>" (verificado contra doc oficial).
  const mensaje = `${timestamp}.${args.cuerpoCrudo}`;
  const firmaEsperada = createHmac("sha256", args.secreto).update(mensaje, "utf8").digest("hex");

  return comparacionTiempoConstante(firmaEsperada, firmaRecibida);
}

/**
 * Parsea el header `Fintoc-Signature` (`t=<ts>,v1=<hex>`). Devuelve `null` si el
 * formato no calza (header ausente, sin `t` o sin `v1`, timestamp no numérico) —
 * el llamador trata `null` como firma inválida.
 */
function parsearHeaderFirma(header: string): { timestamp: number; firmaRecibida: string } | null {
  if (!header || typeof header !== "string") return null;
  let timestamp: number | null = null;
  let firmaRecibida: string | null = null;

  for (const segmento of header.split(",")) {
    const i = segmento.indexOf("=");
    if (i === -1) continue;
    const clave = segmento.slice(0, i).trim();
    const valor = segmento.slice(i + 1).trim();
    if (clave === "t") {
      const n = Number(valor);
      if (Number.isFinite(n)) timestamp = n;
    } else if (clave === "v1") {
      firmaRecibida = valor;
    }
  }

  if (timestamp === null || !firmaRecibida) return null;
  return { timestamp, firmaRecibida };
}

/**
 * Comparación de hex de tiempo constante. Si las longitudes difieren,
 * `timingSafeEqual` lanzaría — se cubre devolviendo `false` (longitudes distintas
 * ⇒ firmas distintas). Nunca se filtra la firma esperada vía timing.
 */
function comparacionTiempoConstante(esperada: string, recibida: string): boolean {
  const a = Buffer.from(esperada, "utf8");
  const b = Buffer.from(recibida, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
