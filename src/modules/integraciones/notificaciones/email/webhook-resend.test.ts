import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  normalizarEventoWebhookResend,
  verificarFirmaWebhookResend,
} from "./webhook-resend";

// -----------------------------------------------------------------------------
// Helper: firma un cuerpo igual que lo haría Svix, para poder probar el camino
// feliz sin depender de una captura real.
// -----------------------------------------------------------------------------
const SECRETO = "whsec_" + Buffer.from("clave-de-prueba-para-svix-1234567").toString("base64");
const AHORA = 1_800_000_000; // epoch fijo: los tests no pueden depender del reloj

function firmar(cuerpo: string, id = "msg_1", ts = String(AHORA), secreto = SECRETO): string {
  const clave = Buffer.from(secreto.slice("whsec_".length), "base64");
  return "v1," + createHmac("sha256", clave).update(`${id}.${ts}.${cuerpo}`, "utf8").digest("base64");
}

const CUERPO = JSON.stringify({ type: "email.bounced", data: { email_id: "abc-123" } });

describe("verificarFirmaWebhookResend", () => {
  it("acepta una firma válida dentro de la tolerancia", () => {
    expect(
      verificarFirmaWebhookResend({
        cuerpoCrudo: CUERPO,
        svixId: "msg_1",
        svixTimestamp: String(AHORA),
        svixSignature: firmar(CUERPO),
        secreto: SECRETO,
        ahoraSegundos: AHORA,
      }),
    ).toBe(true);
  });

  it("acepta si UNA de varias firmas calza (rotación de secreto)", () => {
    const header = `v1,firmaVieja= ${firmar(CUERPO)}`;
    expect(
      verificarFirmaWebhookResend({
        cuerpoCrudo: CUERPO,
        svixId: "msg_1",
        svixTimestamp: String(AHORA),
        svixSignature: header,
        secreto: SECRETO,
        ahoraSegundos: AHORA,
      }),
    ).toBe(true);
  });

  it("rechaza si el cuerpo cambió aunque sea un byte", () => {
    expect(
      verificarFirmaWebhookResend({
        cuerpoCrudo: CUERPO + " ",
        svixId: "msg_1",
        svixTimestamp: String(AHORA),
        svixSignature: firmar(CUERPO),
        secreto: SECRETO,
        ahoraSegundos: AHORA,
      }),
    ).toBe(false);
  });

  it("rechaza si el svix-id no es el que se firmó (no se puede reusar la firma)", () => {
    expect(
      verificarFirmaWebhookResend({
        cuerpoCrudo: CUERPO,
        svixId: "msg_OTRO",
        svixTimestamp: String(AHORA),
        svixSignature: firmar(CUERPO),
        secreto: SECRETO,
        ahoraSegundos: AHORA,
      }),
    ).toBe(false);
  });

  it("rechaza un replay fuera de la tolerancia de 5 minutos", () => {
    expect(
      verificarFirmaWebhookResend({
        cuerpoCrudo: CUERPO,
        svixId: "msg_1",
        svixTimestamp: String(AHORA),
        svixSignature: firmar(CUERPO),
        secreto: SECRETO,
        ahoraSegundos: AHORA + 301,
      }),
    ).toBe(false);
  });

  it("tolera desfase de reloj en ambos sentidos dentro de los 5 minutos", () => {
    const base = {
      cuerpoCrudo: CUERPO,
      svixId: "msg_1",
      svixTimestamp: String(AHORA),
      svixSignature: firmar(CUERPO),
      secreto: SECRETO,
    };
    // Nuestro reloj atrasado respecto del de Resend, y adelantado.
    expect(verificarFirmaWebhookResend({ ...base, ahoraSegundos: AHORA - 299 })).toBe(true);
    expect(verificarFirmaWebhookResend({ ...base, ahoraSegundos: AHORA + 299 })).toBe(true);
    // Justo afuera, por ambos lados.
    expect(verificarFirmaWebhookResend({ ...base, ahoraSegundos: AHORA - 301 })).toBe(false);
    expect(verificarFirmaWebhookResend({ ...base, ahoraSegundos: AHORA + 301 })).toBe(false);
  });

  it("rechaza con otro secreto", () => {
    const otro = "whsec_" + Buffer.from("otra-clave-distinta-de-la-real-99").toString("base64");
    expect(
      verificarFirmaWebhookResend({
        cuerpoCrudo: CUERPO,
        svixId: "msg_1",
        svixTimestamp: String(AHORA),
        svixSignature: firmar(CUERPO),
        secreto: otro,
        ahoraSegundos: AHORA,
      }),
    ).toBe(false);
  });

  it("fail-closed ante headers o secreto ausentes — nunca lanza", () => {
    const base = {
      cuerpoCrudo: CUERPO,
      svixId: "msg_1",
      svixTimestamp: String(AHORA),
      svixSignature: firmar(CUERPO),
      secreto: SECRETO,
      ahoraSegundos: AHORA,
    };
    expect(verificarFirmaWebhookResend({ ...base, svixId: "" })).toBe(false);
    expect(verificarFirmaWebhookResend({ ...base, svixTimestamp: "" })).toBe(false);
    expect(verificarFirmaWebhookResend({ ...base, svixSignature: "" })).toBe(false);
    expect(verificarFirmaWebhookResend({ ...base, secreto: "" })).toBe(false);
    expect(verificarFirmaWebhookResend({ ...base, svixTimestamp: "no-es-numero" })).toBe(false);
    expect(verificarFirmaWebhookResend({ ...base, svixSignature: "basura-sin-formato" })).toBe(false);
  });

  it("tolera el secreto sin el prefijo whsec_", () => {
    expect(
      verificarFirmaWebhookResend({
        cuerpoCrudo: CUERPO,
        svixId: "msg_1",
        svixTimestamp: String(AHORA),
        svixSignature: firmar(CUERPO),
        secreto: SECRETO.slice("whsec_".length),
        ahoraSegundos: AHORA,
      }),
    ).toBe(true);
  });
});

describe("normalizarEventoWebhookResend", () => {
  it("mapea los tres tipos accionables", () => {
    const casos = [
      ["email.delivered", "entregado"],
      ["email.bounced", "rebotado"],
      ["email.complained", "marcado_spam"],
    ] as const;
    for (const [tipo, esperado] of casos) {
      const r = normalizarEventoWebhookResend({ type: tipo, data: { email_id: "id-1" } });
      expect(r?.estado).toBe(esperado);
      expect(r?.proveedorId).toBe("id-1");
    }
  });

  it("ignora los eventos que no aportan nada accionable", () => {
    for (const tipo of ["email.sent", "email.opened", "email.clicked", "contact.created"]) {
      expect(normalizarEventoWebhookResend({ type: tipo, data: { email_id: "id-1" } })).toBeNull();
    }
  });

  it("ignora un evento sin email_id — sin él no hay a qué invitación atribuirlo", () => {
    expect(normalizarEventoWebhookResend({ type: "email.bounced", data: {} })).toBeNull();
    expect(normalizarEventoWebhookResend({ type: "email.bounced" })).toBeNull();
  });

  it("no revienta con payloads basura", () => {
    for (const basura of [null, undefined, 42, "texto", []]) {
      expect(normalizarEventoWebhookResend(basura)).toBeNull();
    }
  });

  it("extrae el motivo del rebote y lo sanea", () => {
    const r = normalizarEventoWebhookResend({
      type: "email.bounced",
      data: { email_id: "id-1", bounce: { message: "  The   recipient   does not exist  " } },
    });
    expect(r?.motivo).toBe("The recipient does not exist");
  });

  it("cae a subType/type cuando no hay message", () => {
    const r = normalizarEventoWebhookResend({
      type: "email.bounced",
      data: { email_id: "id-1", bounce: { subType: "MailboxFull" } },
    });
    expect(r?.motivo).toBe("MailboxFull");
  });

  it("recorta un motivo desmedido en vez de guardarlo entero", () => {
    const r = normalizarEventoWebhookResend({
      type: "email.bounced",
      data: { email_id: "id-1", bounce: { message: "x".repeat(1000) } },
    });
    expect(r?.motivo).toHaveLength(300);
  });

  it("motivo null cuando el proveedor no explica nada", () => {
    const r = normalizarEventoWebhookResend({ type: "email.bounced", data: { email_id: "id-1" } });
    expect(r?.motivo).toBeNull();
  });
});
