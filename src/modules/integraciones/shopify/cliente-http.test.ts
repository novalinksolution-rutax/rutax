/**
 * Cliente HTTP de Shopify.
 *
 * Estas pruebas existen por las tres trampas que documenta `cliente-http.ts` y
 * que no comparte con el adaptador de Mercado Libre: el 200 que en realidad es
 * un fallo, el límite de tasa por puntos, y el dominio de tienda que escribe el
 * seller. Las tres fallan de manera silenciosa si nadie las mira.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  peticionShopify,
  normalizarShopDomain,
  esShopDomainValido,
  esperaPorBalde,
  ErrorHttpShopify,
  ErrorGraphqlShopify,
  ErrorShopDomainInvalido,
} from "./cliente-http";

const SIN_REINTENTOS = { maxIntentos: 1 };
const TIENDA = "mi-tienda.myshopify.com";

function respuesta(cuerpo: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(cuerpo), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("normalizarShopDomain", () => {
  it("acepta el dominio tal cual", () => {
    expect(normalizarShopDomain("mi-tienda.myshopify.com")).toBe("mi-tienda.myshopify.com");
  });

  it("tolera lo que el seller realmente pega: esquema, ruta, mayúsculas y espacios", () => {
    expect(normalizarShopDomain("  https://Mi-Tienda.myshopify.com/admin/orders  ")).toBe(
      "mi-tienda.myshopify.com",
    );
  });

  it("completa el sufijo cuando pega solo el handle", () => {
    expect(normalizarShopDomain("mi-tienda")).toBe("mi-tienda.myshopify.com");
  });

  it("rechaza cualquier host que no sea myshopify.com", () => {
    // Es la barrera anti-SSRF: sin ella, un dominio pegado en el formulario
    // haría que Rutax entregue el token de la tienda al host que le indiquen.
    expect(normalizarShopDomain("evil.example.com")).toBe(null);
    expect(normalizarShopDomain("mi-tienda.myshopify.com.evil.com")).toBe(null);
    expect(normalizarShopDomain("localhost:3000")).toBe(null);
    expect(esShopDomainValido("MI-TIENDA.myshopify.com")).toBe(false);
  });
});

describe("esperaPorBalde", () => {
  it("calcula cuánto tarda el balde en reponer los puntos que faltan", () => {
    // Faltan 100 puntos y se reponen 50 por segundo → 2 s.
    expect(
      esperaPorBalde({ maximumAvailable: 1000, currentlyAvailable: 100, restoreRate: 50 }, 200),
    ).toBe(2000);
  });

  it("no espera si el balde ya alcanza", () => {
    expect(
      esperaPorBalde({ maximumAvailable: 1000, currentlyAvailable: 900, restoreRate: 50 }, 200),
    ).toBeUndefined();
  });

  it("se topa en 10 s: más que eso es bloquear un job por una consulta muy cara", () => {
    expect(
      esperaPorBalde({ maximumAvailable: 1000, currentlyAvailable: 0, restoreRate: 1 }, 900),
    ).toBe(10_000);
  });
});

describe("peticionShopify", () => {
  it("valida el dominio ANTES de construir la URL o tocar la red", async () => {
    const fetchFalso = vi.fn();
    vi.stubGlobal("fetch", fetchFalso);

    await expect(
      peticionShopify({
        shopDomain: "evil.example.com",
        accessToken: "shpat_secreto",
        consulta: "{ shop { name } }",
      }),
    ).rejects.toBeInstanceOf(ErrorShopDomainInvalido);

    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it("manda el token en el header y NUNCA en la URL ni en el cuerpo", async () => {
    const fetchFalso = vi.fn().mockResolvedValue(respuesta({ data: { shop: { name: "X" } } }));
    vi.stubGlobal("fetch", fetchFalso);

    await peticionShopify({
      shopDomain: TIENDA,
      accessToken: "shpat_secreto",
      consulta: "{ shop { name } }",
      opcionesReintento: SIN_REINTENTOS,
    });

    const [url, init] = fetchFalso.mock.calls[0];
    expect(url).toBe(`https://${TIENDA}/admin/api/2026-01/graphql.json`);
    expect(url).not.toContain("shpat_secreto");
    expect(init.body).not.toContain("shpat_secreto");
    expect(init.headers["x-shopify-access-token"]).toBe("shpat_secreto");
  });

  it("desempaqueta `data` cuando todo sale bien", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(respuesta({ data: { shop: { name: "Mi Tienda" } } })),
    );

    const data = await peticionShopify<{ shop: { name: string } }>({
      shopDomain: TIENDA,
      accessToken: "t",
      consulta: "{ shop { name } }",
      opcionesReintento: SIN_REINTENTOS,
    });

    expect(data.shop.name).toBe("Mi Tienda");
  });

  // --- [TRAMPA 1] 200 con `errors` --------------------------------------------

  it("un HTTP 200 con `errors` es un FALLO, no un éxito con data vacía", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        respuesta({
          errors: [{ message: "Field 'noExiste' doesn't exist", extensions: { code: "undefinedField" } }],
        }),
      ),
    );

    await expect(
      peticionShopify({
        shopDomain: TIENDA,
        accessToken: "t",
        consulta: "{ noExiste }",
        opcionesReintento: SIN_REINTENTOS,
      }),
    ).rejects.toBeInstanceOf(ErrorGraphqlShopify);
  });

  it("un error de esquema NO es reintentable: preguntar de nuevo da lo mismo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        respuesta({ errors: [{ message: "no", extensions: { code: "undefinedField" } }] }),
      ),
    );

    const error = await peticionShopify({
      shopDomain: TIENDA,
      accessToken: "t",
      consulta: "{ x }",
      opcionesReintento: SIN_REINTENTOS,
    }).catch((e) => e);

    expect(error).toBeInstanceOf(ErrorGraphqlShopify);
    expect((error as ErrorGraphqlShopify).reintentable).toBeUndefined();
  });

  it("una respuesta 200 sin `data` ni `errors` tampoco pasa por buena", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuesta({})));

    await expect(
      peticionShopify({
        shopDomain: TIENDA,
        accessToken: "t",
        consulta: "{ x }",
        opcionesReintento: SIN_REINTENTOS,
      }),
    ).rejects.toBeInstanceOf(ErrorGraphqlShopify);
  });

  // --- [TRAMPA 2] el balde de puntos ------------------------------------------

  it("THROTTLED sí es reintentable, y la espera sale del estado del balde", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        respuesta({
          errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }],
          extensions: {
            cost: {
              requestedQueryCost: 300,
              throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 100, restoreRate: 50 },
            },
          },
        }),
      ),
    );

    const error = await peticionShopify({
      shopDomain: TIENDA,
      accessToken: "t",
      consulta: "{ x }",
      opcionesReintento: SIN_REINTENTOS,
    }).catch((e) => e);

    expect(error).toBeInstanceOf(ErrorGraphqlShopify);
    expect((error as ErrorGraphqlShopify).reintentable).toBe(true);
    // Faltan 200 puntos a 50/s → 4 s, no un backoff a ciegas.
    expect((error as ErrorGraphqlShopify).retryAfterMs).toBe(4000);
  });

  it("reintenta tras un THROTTLED y devuelve el resultado de la segunda vuelta", async () => {
    const fetchFalso = vi
      .fn()
      .mockResolvedValueOnce(
        respuesta({ errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] }),
      )
      .mockResolvedValueOnce(respuesta({ data: { ok: true } }));
    vi.stubGlobal("fetch", fetchFalso);

    const data = await peticionShopify<{ ok: boolean }>({
      shopDomain: TIENDA,
      accessToken: "t",
      consulta: "{ x }",
      opcionesReintento: { maxIntentos: 2, dormir: async () => {} },
    });

    expect(data.ok).toBe(true);
    expect(fetchFalso).toHaveBeenCalledTimes(2);
  });

  // --- Transporte --------------------------------------------------------------

  it("un 401 es definitivo (token revocado): no se reintenta", async () => {
    const fetchFalso = vi.fn().mockResolvedValue(respuesta({ errors: "Unauthorized" }, { status: 401 }));
    vi.stubGlobal("fetch", fetchFalso);

    const error = await peticionShopify({
      shopDomain: TIENDA,
      accessToken: "t",
      consulta: "{ x }",
      opcionesReintento: { maxIntentos: 3, dormir: async () => {} },
    }).catch((e) => e);

    expect(error).toBeInstanceOf(ErrorHttpShopify);
    expect((error as ErrorHttpShopify).status).toBe(401);
    expect((error as ErrorHttpShopify).reintentable).toBeUndefined();
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it("un 429 respeta el Retry-After del proveedor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(respuesta({}, { status: 429, headers: { "retry-after": "3" } })),
    );

    const error = await peticionShopify({
      shopDomain: TIENDA,
      accessToken: "t",
      consulta: "{ x }",
      opcionesReintento: SIN_REINTENTOS,
    }).catch((e) => e);

    expect((error as ErrorHttpShopify).reintentable).toBe(true);
    expect((error as ErrorHttpShopify).retryAfterMs).toBe(3000);
  });
});
