/**
 * Pruebas del gate sandbox/real de WhatsApp.
 *
 * Es la barrera que impide gastar plata sin querer: cada conversación se cobra
 * a la tarjeta que Rutax tiene registrada en Meta. El default TIENE que ser el
 * que no envía, y una configuración a medias tiene que quedarse en sandbox en
 * vez de fallar a mitad de camino.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { obtenerPuertoWhatsApp, whatsappSandboxActivo, whatsappConfigurado } from "./fabrica-whatsapp";
import { StubWhatsAppAdapter } from "./adaptadores/stub";
import { CloudApiWhatsAppAdapter } from "./adaptadores/cloud-api";

const VARIABLES = [
  "WHATSAPP_SANDBOX_MODE",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_API_VERSION",
] as const;

let original: Record<string, string | undefined>;

beforeEach(() => {
  original = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]));
  for (const v of VARIABLES) delete process.env[v];
});

afterEach(() => {
  for (const v of VARIABLES) {
    if (original[v] === undefined) delete process.env[v];
    else process.env[v] = original[v];
  }
});

describe("whatsappSandboxActivo — solo el literal 'false' lo desactiva", () => {
  it("sin la variable, sandbox activo", () => {
    expect(whatsappSandboxActivo()).toBe(true);
  });

  it.each(["true", "TRUE", "0", "", "no", "False"])('"%s" mantiene sandbox', (valor) => {
    process.env.WHATSAPP_SANDBOX_MODE = valor;
    expect(whatsappSandboxActivo()).toBe(true);
  });

  it('solo "false" exacto lo desactiva', () => {
    process.env.WHATSAPP_SANDBOX_MODE = "false";
    expect(whatsappSandboxActivo()).toBe(false);
  });
});

describe("obtenerPuertoWhatsApp — el gate necesita las TRES condiciones", () => {
  it("sin nada configurado → stub", () => {
    expect(obtenerPuertoWhatsApp()).toBeInstanceOf(StubWhatsAppAdapter);
  });

  it("con credenciales pero SIN abrir el gate → stub", () => {
    process.env.WHATSAPP_ACCESS_TOKEN = "token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "118309731563783";
    expect(obtenerPuertoWhatsApp()).toBeInstanceOf(StubWhatsAppAdapter);
  });

  it("con el gate abierto pero SIN token → stub (no falla a medio camino)", () => {
    process.env.WHATSAPP_SANDBOX_MODE = "false";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "118309731563783";
    expect(obtenerPuertoWhatsApp()).toBeInstanceOf(StubWhatsAppAdapter);
  });

  it("con el gate abierto pero SIN phone number id → stub", () => {
    process.env.WHATSAPP_SANDBOX_MODE = "false";
    process.env.WHATSAPP_ACCESS_TOKEN = "token";
    expect(obtenerPuertoWhatsApp()).toBeInstanceOf(StubWhatsAppAdapter);
  });

  it("con las tres condiciones → adaptador real", () => {
    process.env.WHATSAPP_SANDBOX_MODE = "false";
    process.env.WHATSAPP_ACCESS_TOKEN = "token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "118309731563783";
    expect(obtenerPuertoWhatsApp()).toBeInstanceOf(CloudApiWhatsAppAdapter);
  });
});

describe("whatsappConfigurado", () => {
  it("distingue 'falta configuración' de 'estoy en sandbox'", () => {
    expect(whatsappConfigurado()).toBe(false);
    process.env.WHATSAPP_ACCESS_TOKEN = "token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "118309731563783";
    expect(whatsappConfigurado()).toBe(true);
    // …y aun así sigue en sandbox, que es el punto.
    expect(whatsappSandboxActivo()).toBe(true);
  });
});

describe("StubWhatsAppAdapter", () => {
  it("nunca dice que envió, y no pide reintento", async () => {
    const resultado = await new StubWhatsAppAdapter().enviarPlantilla({
      telefonoE164: "56947095571",
      nombrePlantilla: "hello_world",
      idioma: "en_US",
      variables: [],
    });
    expect(resultado.enviado).toBe(false);
    expect(resultado.modo).toBe("stub");
    // Reintentar el stub daría cuatro vueltas en cada corrida de desarrollo.
    expect(resultado.reintentable).toBe(false);
  });
});
