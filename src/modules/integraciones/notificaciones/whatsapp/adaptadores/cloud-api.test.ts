/**
 * Pruebas del adaptador REAL de WhatsApp — foco en el componente de BOTÓN de las
 * plantillas de AUTENTICACIÓN (F4.b).
 *
 * Lo que se fija:
 *   - Con `esPlantillaAutenticacion`, el payload lleva DOS componentes: el
 *     `body` con el código y un `button` (`sub_type: "url"`, `index: "0"`) con
 *     el MISMO código. Es el requisito de Meta para el botón «Copiar código».
 *   - Sin la marca, NO se agrega botón (una utility normal no lo lleva).
 *   - El token viaja solo en Authorization y nunca en el body.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { CloudApiWhatsAppAdapter } from "./cloud-api";

const CONFIG = { accessToken: "token-secreto-de-prueba", phoneNumberId: "1183097731563783", version: "v25.0" };

function stubFetchOk() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ messages: [{ id: "wamid.ABC" }] }),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function bodyEnviado(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const init = fetchMock.mock.calls[0][1] as RequestInit;
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

describe("CloudApiWhatsAppAdapter — plantilla de autenticación", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("arma el componente de botón con el mismo código que el cuerpo", async () => {
    const fetchMock = stubFetchOk();
    const adaptador = new CloudApiWhatsAppAdapter(CONFIG);

    const resultado = await adaptador.enviarPlantilla({
      telefonoE164: "56947095571",
      nombrePlantilla: "codigo_acceso_conductor",
      idioma: "es",
      variables: ["482913"],
      esPlantillaAutenticacion: true,
    });

    expect(resultado.enviado).toBe(true);

    const cuerpo = bodyEnviado(fetchMock);
    const template = cuerpo.template as { components: Array<Record<string, unknown>> };
    expect(template.components).toHaveLength(2);

    const [body, boton] = template.components;
    expect(body).toEqual({ type: "body", parameters: [{ type: "text", text: "482913" }] });
    expect(boton).toEqual({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: "482913" }],
    });
  });

  it("NO agrega botón para una plantilla normal (utility)", async () => {
    const fetchMock = stubFetchOk();
    const adaptador = new CloudApiWhatsAppAdapter(CONFIG);

    await adaptador.enviarPlantilla({
      telefonoE164: "56947095571",
      nombrePlantilla: "notificacion_retiro_pedidos",
      idioma: "es",
      variables: ["Ana", "12", "Bodega Centro", "Pedro"],
      // sin esPlantillaAutenticacion
    });

    const cuerpo = bodyEnviado(fetchMock);
    const template = cuerpo.template as { components: Array<Record<string, unknown>> };
    expect(template.components).toHaveLength(1);
    expect(template.components[0].type).toBe("body");
  });

  it("el token nunca viaja en el body", async () => {
    const fetchMock = stubFetchOk();
    const adaptador = new CloudApiWhatsAppAdapter(CONFIG);

    await adaptador.enviarPlantilla({
      telefonoE164: "56947095571",
      nombrePlantilla: "codigo_acceso_conductor",
      idioma: "es",
      variables: ["482913"],
      esPlantillaAutenticacion: true,
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token-secreto-de-prueba");
    expect(init.body as string).not.toContain("token-secreto-de-prueba");
  });
});
