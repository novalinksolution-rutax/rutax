/**
 * Pruebas de `verificarFirmaHookSupabase` (Standard Webhooks, Send SMS hook).
 *
 * Foco: una firma legítima calza; cualquier manipulación —cuerpo, id, timestamp,
 * secreto— la invalida; el timestamp fuera de tolerancia se rechaza (anti-replay);
 * y varias firmas en el header valen si UNA calza (rotación de secreto).
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { verificarFirmaHookSupabase } from "./verificar-hook-standard-webhooks";

/** Secreto de prueba: base64 con el prefijo que Supabase muestra en el panel. */
const CLAVE_BYTES = Buffer.from("clave-secreta-de-prueba-para-el-hmac", "utf8");
const SECRETO = `v1,whsec_${CLAVE_BYTES.toString("base64")}`;

const AHORA = 1_700_000_000; // epoch fijo para las pruebas

function firmar(id: string, ts: number, cuerpo: string, clave = CLAVE_BYTES): string {
  const contenido = `${id}.${ts}.${cuerpo}`;
  return `v1,${createHmac("sha256", clave).update(contenido, "utf8").digest("base64")}`;
}

const CUERPO = JSON.stringify({ user: { phone: "+56947095571" }, sms: { otp: "123456" } });

describe("verificarFirmaHookSupabase", () => {
  it("acepta una firma legítima dentro de la tolerancia", () => {
    const ok = verificarFirmaHookSupabase({
      cuerpoCrudo: CUERPO,
      webhookId: "msg_1",
      webhookTimestamp: String(AHORA),
      webhookSignature: firmar("msg_1", AHORA, CUERPO),
      secreto: SECRETO,
      ahoraSegundos: AHORA,
    });
    expect(ok).toBe(true);
  });

  it("rechaza si el cuerpo fue manipulado (la firma ya no calza)", () => {
    const ok = verificarFirmaHookSupabase({
      cuerpoCrudo: CUERPO.replace("123456", "999999"),
      webhookId: "msg_1",
      webhookTimestamp: String(AHORA),
      webhookSignature: firmar("msg_1", AHORA, CUERPO),
      secreto: SECRETO,
      ahoraSegundos: AHORA,
    });
    expect(ok).toBe(false);
  });

  it("rechaza una firma hecha con OTRO secreto", () => {
    const ok = verificarFirmaHookSupabase({
      cuerpoCrudo: CUERPO,
      webhookId: "msg_1",
      webhookTimestamp: String(AHORA),
      webhookSignature: firmar("msg_1", AHORA, CUERPO, Buffer.from("otra-clave", "utf8")),
      secreto: SECRETO,
      ahoraSegundos: AHORA,
    });
    expect(ok).toBe(false);
  });

  it("rechaza un timestamp fuera de la tolerancia (anti-replay)", () => {
    const viejo = AHORA - 6 * 60; // 6 min > 5 min de tolerancia
    const ok = verificarFirmaHookSupabase({
      cuerpoCrudo: CUERPO,
      webhookId: "msg_1",
      webhookTimestamp: String(viejo),
      webhookSignature: firmar("msg_1", viejo, CUERPO),
      secreto: SECRETO,
      ahoraSegundos: AHORA,
    });
    expect(ok).toBe(false);
  });

  it("rechaza si falta cualquier header", () => {
    const base = {
      cuerpoCrudo: CUERPO,
      webhookId: "msg_1",
      webhookTimestamp: String(AHORA),
      webhookSignature: firmar("msg_1", AHORA, CUERPO),
      secreto: SECRETO,
      ahoraSegundos: AHORA,
    };
    expect(verificarFirmaHookSupabase({ ...base, webhookId: null })).toBe(false);
    expect(verificarFirmaHookSupabase({ ...base, webhookTimestamp: null })).toBe(false);
    expect(verificarFirmaHookSupabase({ ...base, webhookSignature: null })).toBe(false);
    expect(verificarFirmaHookSupabase({ ...base, secreto: "" })).toBe(false);
  });

  it("acepta si UNA de varias firmas del header calza (rotación de secreto)", () => {
    const firmaBuena = firmar("msg_1", AHORA, CUERPO);
    const firmaVieja = firmar("msg_1", AHORA, CUERPO, Buffer.from("secreto-anterior", "utf8"));
    const ok = verificarFirmaHookSupabase({
      cuerpoCrudo: CUERPO,
      webhookId: "msg_1",
      webhookTimestamp: String(AHORA),
      webhookSignature: `${firmaVieja} ${firmaBuena}`,
      secreto: SECRETO,
      ahoraSegundos: AHORA,
    });
    expect(ok).toBe(true);
  });

  it("tolera el secreto sin el prefijo `v1,` (solo `whsec_`)", () => {
    const ok = verificarFirmaHookSupabase({
      cuerpoCrudo: CUERPO,
      webhookId: "msg_1",
      webhookTimestamp: String(AHORA),
      webhookSignature: firmar("msg_1", AHORA, CUERPO),
      secreto: `whsec_${CLAVE_BYTES.toString("base64")}`,
      ahoraSegundos: AHORA,
    });
    expect(ok).toBe(true);
  });
});
