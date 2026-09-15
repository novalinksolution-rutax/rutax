/**
 * Pruebas de `POST /api/hooks/send-sms` (Send SMS hook de Supabase, F4.b).
 *
 * Foco:
 *   - Sin secreto configurado → 500, sin mandar nada (fail-closed).
 *   - Firma inválida → 401, sin llamar al puerto.
 *   - Payload sin `otp` / `phone` → 400 (con firma válida), sin llamar al puerto.
 *   - Camino feliz → 200 y se llama al puerto con la plantilla de autenticación,
 *     el código como variable y `esPlantillaAutenticacion: true`.
 *   - Fallo del envío → status ≥400 (502 reintentable / 422 permanente).
 *
 * La firma NO se mockea: se calcula una real, para ejercitar de verdad la
 * verificación Standard Webhooks del endpoint.
 */
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rate-limit", () => ({
  consumirRateLimit: vi.fn(async () => ({ permitido: true, reintentarEnSegundos: 0 })),
}));

vi.mock("@/lib/observabilidad", () => ({
  capturarMensaje: vi.fn(async () => undefined),
}));

const enviarPlantillaMock = vi.fn();
vi.mock("@/modules/integraciones/notificaciones/whatsapp", () => ({
  obtenerPuertoWhatsApp: vi.fn(() => ({ enviarPlantilla: enviarPlantillaMock })),
  obtenerPlantilla: vi.fn(() => ({
    nombre: "codigo_acceso_conductor",
    idioma: "es",
    variables: ["codigo"],
    esAutenticacion: true,
  })),
}));

import { POST } from "./route";

const CLAVE_BYTES = Buffer.from("clave-secreta-de-prueba-para-el-hmac", "utf8");
const SECRETO = `v1,whsec_${CLAVE_BYTES.toString("base64")}`;

function firmar(id: string, ts: number, cuerpo: string): string {
  return `v1,${createHmac("sha256", CLAVE_BYTES).update(`${id}.${ts}.${cuerpo}`, "utf8").digest("base64")}`;
}

function crearRequest(cuerpo: string, opciones?: { firmar?: boolean }) {
  const id = "msg_1";
  const ts = Math.floor(Date.now() / 1000);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opciones?.firmar !== false) {
    headers["webhook-id"] = id;
    headers["webhook-timestamp"] = String(ts);
    headers["webhook-signature"] = firmar(id, ts, cuerpo);
  }
  return new Request("http://localhost/api/hooks/send-sms", { method: "POST", headers, body: cuerpo }) as unknown as import("next/server").NextRequest;
}

const PAYLOAD_OK = JSON.stringify({ user: { phone: "+56947095571" }, sms: { otp: "482913" } });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SUPABASE_SEND_SMS_HOOK_SECRET = SECRETO;
  enviarPlantillaMock.mockResolvedValue({ enviado: true, modo: "real", metaMessageId: "wamid.X", reintentable: false });
});

afterEach(() => {
  delete process.env.SUPABASE_SEND_SMS_HOOK_SECRET;
});

describe("POST /api/hooks/send-sms", () => {
  it("sin secreto configurado → 500 y no manda nada", async () => {
    delete process.env.SUPABASE_SEND_SMS_HOOK_SECRET;
    const respuesta = await POST(crearRequest(PAYLOAD_OK));
    expect(respuesta.status).toBe(500);
    expect(enviarPlantillaMock).not.toHaveBeenCalled();
  });

  it("firma inválida → 401, sin llamar al puerto", async () => {
    const respuesta = await POST(crearRequest(PAYLOAD_OK, { firmar: false }));
    expect(respuesta.status).toBe(401);
    expect(enviarPlantillaMock).not.toHaveBeenCalled();
  });

  it("payload sin otp → 400 (con firma válida), sin llamar al puerto", async () => {
    const cuerpo = JSON.stringify({ user: { phone: "+56947095571" }, sms: {} });
    const respuesta = await POST(crearRequest(cuerpo));
    expect(respuesta.status).toBe(400);
    expect(enviarPlantillaMock).not.toHaveBeenCalled();
  });

  it("payload sin phone → 400, sin llamar al puerto", async () => {
    const cuerpo = JSON.stringify({ user: {}, sms: { otp: "482913" } });
    const respuesta = await POST(crearRequest(cuerpo));
    expect(respuesta.status).toBe(400);
    expect(enviarPlantillaMock).not.toHaveBeenCalled();
  });

  it("camino feliz → 200 y envía la plantilla de autenticación con el código", async () => {
    const respuesta = await POST(crearRequest(PAYLOAD_OK));
    expect(respuesta.status).toBe(200);

    expect(enviarPlantillaMock).toHaveBeenCalledTimes(1);
    const args = enviarPlantillaMock.mock.calls[0][0];
    expect(args).toMatchObject({
      telefonoE164: "56947095571",
      nombrePlantilla: "codigo_acceso_conductor",
      idioma: "es",
      variables: ["482913"],
      esPlantillaAutenticacion: true,
    });
  });

  it("envío fallido reintentable → 502", async () => {
    enviarPlantillaMock.mockResolvedValue({ enviado: false, modo: "real", reintentable: true, errorDescripcion: "429" });
    const respuesta = await POST(crearRequest(PAYLOAD_OK));
    expect(respuesta.status).toBe(502);
  });

  it("envío fallido permanente → 422", async () => {
    enviarPlantillaMock.mockResolvedValue({ enviado: false, modo: "real", reintentable: false, errorDescripcion: "plantilla" });
    const respuesta = await POST(crearRequest(PAYLOAD_OK));
    expect(respuesta.status).toBe(422);
  });
});
