/**
 * Pruebas de resiliencia del registro de Webhook Endpoints de Fintoc.
 *
 * Lo que se fija acá:
 *  - El contrato verificado contra la doc oficial (método, ruta, `enabled_events`,
 *    `secret` solo en la creación).
 *  - Que el borrado del endpoint anterior sea de verdad "best effort": una caída
 *    de red o un 500 del proveedor NO puede tumbar la conexión bancaria, porque el
 *    `link_token` que se está guardando en el mismo request no se puede recuperar.
 *  - Que la secret key de la organización nunca salga en un mensaje de error.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorPagosProveedor } from "../errores";
import { borrarWebhookEndpointsDeUrl, registrarWebhookEndpointCobranza } from "./webhook-endpoints";

const BASE = "https://api.fintoc.test/v1";
const SECRET_KEY = "sk_test_NO_DEBE_APARECER_EN_ERRORES";
const URL_ENDPOINT = "https://rutax.io/api/webhooks/fintoc/t-1";

function respuesta(cuerpo: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => cuerpo,
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("registrarWebhookEndpointCobranza", () => {
  it("hace POST /webhook_endpoints con enabled_events y devuelve id + secret", async () => {
    const fetchMock = vi.fn(async () =>
      respuesta({ id: "we_1", secret: "whsec_abc" }, 201),
    );
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await registrarWebhookEndpointCobranza({
      secretKey: SECRET_KEY,
      url: URL_ENDPOINT,
      baseUrl: BASE,
    });

    expect(resultado).toEqual({ id: "we_1", secret: "whsec_abc" });

    const [url, opciones] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}/webhook_endpoints`);
    expect(opciones.method).toBe("POST");
    // Auth verificada en vivo: la secret key va DIRECTA, sin "Bearer".
    expect((opciones.headers as Record<string, string>).Authorization).toBe(SECRET_KEY);
    expect(JSON.parse(opciones.body as string)).toMatchObject({
      url: URL_ENDPOINT,
      enabled_events: ["transfer.inbound.succeeded"],
    });
  });

  it("un 4xx del proveedor lanza ErrorPagosProveedor SIN la secret key en el mensaje", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respuesta({ error: { message: "url must be https" } }, 422)),
    );

    const promesa = registrarWebhookEndpointCobranza({
      secretKey: SECRET_KEY,
      url: "http://insegura",
      baseUrl: BASE,
    });

    await expect(promesa).rejects.toThrow(ErrorPagosProveedor);
    await expect(promesa).rejects.toThrow(/url must be https/);
    await expect(promesa).rejects.not.toThrow(/sk_test/);
  });

  it("un 201 sin `secret` es un fallo del proveedor, no un éxito a medias", async () => {
    // La doc dice que el secret solo viene en la creación: sin él el endpoint es
    // inútil y quedarse callado dejaría una conexión que nunca valida firma.
    vi.stubGlobal("fetch", vi.fn(async () => respuesta({ id: "we_1" }, 201)));

    await expect(
      registrarWebhookEndpointCobranza({ secretKey: SECRET_KEY, url: URL_ENDPOINT, baseUrl: BASE }),
    ).rejects.toThrow(ErrorPagosProveedor);
  });
});

describe("borrarWebhookEndpointsDeUrl", () => {
  it("borra solo los de la MISMA url y deja en paz los de otros tenants", async () => {
    const fetchMock = vi.fn(async (url: string, opciones?: RequestInit) => {
      if (opciones?.method === "DELETE") return respuesta(null, 204);
      return respuesta([
        { id: "we_mio", url: URL_ENDPOINT },
        { id: "we_ajeno", url: "https://rutax.io/api/webhooks/fintoc/t-2" },
      ]);
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    expect(
      await borrarWebhookEndpointsDeUrl({ secretKey: SECRET_KEY, url: URL_ENDPOINT, baseUrl: BASE }),
    ).toBe(1);

    const borrados = fetchMock.mock.calls.filter(
      ([, o]) => (o as RequestInit | undefined)?.method === "DELETE",
    );
    expect(borrados).toHaveLength(1);
    expect(borrados[0]?.[0]).toBe(`${BASE}/webhook_endpoints/we_mio`);
  });

  it("tolera la colección envuelta en `data`", async () => {
    const fetchMock = vi.fn(async (_url: string, opciones?: RequestInit) =>
      opciones?.method === "DELETE"
        ? respuesta(null, 204)
        : respuesta({ data: [{ id: "we_mio", url: URL_ENDPOINT }] }),
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    expect(
      await borrarWebhookEndpointsDeUrl({ secretKey: SECRET_KEY, url: URL_ENDPOINT, baseUrl: BASE }),
    ).toBe(1);
  });

  it("un 404 al borrar cuenta como borrado (ya no estorba)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, opciones?: RequestInit) =>
        opciones?.method === "DELETE"
          ? respuesta({ error: { message: "not found" } }, 404)
          : respuesta([{ id: "we_mio", url: URL_ENDPOINT }]),
      ) as unknown as typeof fetch,
    );

    expect(
      await borrarWebhookEndpointsDeUrl({ secretKey: SECRET_KEY, url: URL_ENDPOINT, baseUrl: BASE }),
    ).toBe(1);
  });

  it("NO lanza si el listado se cae: la conexión bancaria no puede depender de esto", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNRESET");
      }),
    );

    await expect(
      borrarWebhookEndpointsDeUrl({ secretKey: SECRET_KEY, url: URL_ENDPOINT, baseUrl: BASE }),
    ).resolves.toBe(0);
  });

  it("NO lanza si el DELETE se cae a mitad de camino", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, opciones?: RequestInit) => {
        if (opciones?.method === "DELETE") throw new Error("ETIMEDOUT");
        return respuesta([{ id: "we_mio", url: URL_ENDPOINT }]);
      }) as unknown as typeof fetch,
    );

    await expect(
      borrarWebhookEndpointsDeUrl({ secretKey: SECRET_KEY, url: URL_ENDPOINT, baseUrl: BASE }),
    ).resolves.toBe(0);
  });

  it("un 500 en el listado no borra nada y devuelve 0", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuesta({ error: {} }, 500)));

    expect(
      await borrarWebhookEndpointsDeUrl({ secretKey: SECRET_KEY, url: URL_ENDPOINT, baseUrl: BASE }),
    ).toBe(0);
  });
});
