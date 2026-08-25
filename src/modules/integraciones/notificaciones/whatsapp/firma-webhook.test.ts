/**
 * Pruebas de la firma y el handshake del webhook de WhatsApp.
 *
 * Es la única barrera entre internet y las escrituras del webhook: sin firma
 * válida, cualquiera podría marcar mensajes como entregados o —peor— revocar el
 * consentimiento de contactos ajenos mandando un "BAJA" falso.
 */

import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verificarFirmaWebhookWhatsApp, resolverHandshakeWebhook } from "./firma-webhook";

const APP_SECRET = "un-app-secret-de-prueba";

function firmar(cuerpo: string, secreto = APP_SECRET): string {
  return `sha256=${createHmac("sha256", secreto).update(cuerpo, "utf8").digest("hex")}`;
}

describe("verificarFirmaWebhookWhatsApp", () => {
  const cuerpo = JSON.stringify({ object: "whatsapp_business_account", entry: [] });

  it("acepta una firma correcta", () => {
    expect(
      verificarFirmaWebhookWhatsApp({
        cuerpoCrudo: cuerpo,
        cabeceraFirma: firmar(cuerpo),
        appSecret: APP_SECRET,
      }),
    ).toBe(true);
  });

  it("rechaza si el cuerpo cambió aunque sea un byte", () => {
    const firma = firmar(cuerpo);
    expect(
      verificarFirmaWebhookWhatsApp({
        cuerpoCrudo: cuerpo + " ",
        cabeceraFirma: firma,
        appSecret: APP_SECRET,
      }),
    ).toBe(false);
  });

  it("rechaza una firma hecha con otro secreto", () => {
    expect(
      verificarFirmaWebhookWhatsApp({
        cuerpoCrudo: cuerpo,
        cabeceraFirma: firmar(cuerpo, "otro-secreto"),
        appSecret: APP_SECRET,
      }),
    ).toBe(false);
  });

  it("exige el prefijo sha256= — no acepta el hex pelado", () => {
    // Tolerar ambas formas dejaría que un cliente eligiera el algoritmo.
    const hexPelado = firmar(cuerpo).slice("sha256=".length);
    expect(
      verificarFirmaWebhookWhatsApp({
        cuerpoCrudo: cuerpo,
        cabeceraFirma: hexPelado,
        appSecret: APP_SECRET,
      }),
    ).toBe(false);
  });

  it("acepta la firma en mayúsculas (el hex no distingue caja)", () => {
    const firma = firmar(cuerpo).toUpperCase().replace("SHA256=", "sha256=");
    expect(
      verificarFirmaWebhookWhatsApp({
        cuerpoCrudo: cuerpo,
        cabeceraFirma: firma,
        appSecret: APP_SECRET,
      }),
    ).toBe(true);
  });

  it("FALLA CERRADO sin secreto configurado", () => {
    expect(
      verificarFirmaWebhookWhatsApp({
        cuerpoCrudo: cuerpo,
        cabeceraFirma: firmar(cuerpo),
        appSecret: "",
      }),
    ).toBe(false);
  });

  it.each([
    ["cuerpo vacío", { cuerpoCrudo: "", cabeceraFirma: firmar(""), appSecret: APP_SECRET }],
    ["sin cabecera", { cuerpoCrudo: cuerpo, cabeceraFirma: "", appSecret: APP_SECRET }],
    ["cabecera basura", { cuerpoCrudo: cuerpo, cabeceraFirma: "sha256=", appSecret: APP_SECRET }],
  ])("rechaza sin lanzar: %s", (_caso, entrada) => {
    expect(() => verificarFirmaWebhookWhatsApp(entrada)).not.toThrow();
    expect(verificarFirmaWebhookWhatsApp(entrada)).toBe(false);
  });
});

describe("resolverHandshakeWebhook", () => {
  const base = { modo: "subscribe", token: "token-esperado", tokenEsperado: "token-esperado" };

  it("devuelve el challenge cuando todo calza", () => {
    expect(resolverHandshakeWebhook({ ...base, challenge: "1158201444" })).toBe("1158201444");
  });

  it("rechaza un token distinto", () => {
    expect(resolverHandshakeWebhook({ ...base, token: "otro", challenge: "123" })).toBeNull();
  });

  it("rechaza un modo distinto de subscribe", () => {
    expect(resolverHandshakeWebhook({ ...base, modo: "unsubscribe", challenge: "123" })).toBeNull();
  });

  it("FALLA CERRADO si no hay token configurado — un token vacío no valida a nadie", () => {
    expect(
      resolverHandshakeWebhook({ modo: "subscribe", token: "", challenge: "123", tokenEsperado: "" }),
    ).toBeNull();
  });

  it("rechaza sin challenge", () => {
    expect(resolverHandshakeWebhook({ ...base, challenge: null })).toBeNull();
  });
});
