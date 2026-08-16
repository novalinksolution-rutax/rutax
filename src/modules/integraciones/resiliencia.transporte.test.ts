/**
 * Clasificación de fallos de transporte.
 *
 * Esto decide si un job se rinde o vuelve a intentar, y la línea es fina: hay
 * que reintentar el corte de red y NO reintentar el bug de programación, aunque
 * `fetch` reporte los dos como `TypeError`. Una clasificación demasiado
 * generosa esconde bugs propios detrás de cuatro reintentos; una demasiado
 * estricta tumba un job por un DNS lento, que es justo lo que pasaba en ML y
 * Shopify hasta el 2026-08-16.
 */

import { describe, it, expect, vi } from "vitest";
import {
  esFalloDeTransporte,
  ejecutarPeticionDeRed,
  ErrorRedIntegracion,
  reintentarConBackoff,
  esErrorReintentable,
} from "./resiliencia";

/** `fetch` de undici: `TypeError: fetch failed` con el error real en `cause`. */
function falloDeRed(codigo: string): TypeError {
  const causa = Object.assign(new Error(`getaddrinfo ${codigo} api.ejemplo.cl`), { code: codigo });
  return Object.assign(new TypeError("fetch failed"), { cause: causa });
}

describe("esFalloDeTransporte", () => {
  it.each([
    "ECONNRESET",
    "ECONNREFUSED",
    "ENOTFOUND",
    "EAI_AGAIN",
    "ETIMEDOUT",
    "EHOSTUNREACH",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_SOCKET",
  ])("reconoce el corte de red %s", (codigo) => {
    expect(esFalloDeTransporte(falloDeRed(codigo))).toBe(true);
  });

  it("reconoce el `fetch failed` de undici aunque no traiga código", () => {
    expect(esFalloDeTransporte(new TypeError("fetch failed"))).toBe(true);
  });

  it("reconoce el `Failed to fetch` del navegador", () => {
    expect(esFalloDeTransporte(new TypeError("Failed to fetch"))).toBe(true);
  });

  // --- Lo que NO debe pasar por fallo de red ---------------------------------

  it("un bug de programación NO es fallo de red", () => {
    // Reintentarlo cuatro veces esconde el bug y no arregla nada.
    expect(esFalloDeTransporte(new TypeError("x.map is not a function"))).toBe(false);
    expect(esFalloDeTransporte(new TypeError("Cannot read properties of undefined"))).toBe(false);
  });

  it("una URL mal construida NO es fallo de red", () => {
    // `fetch` también la reporta como TypeError, pero sigue inválida al cuarto
    // intento: es un error nuestro disfrazado de problema de conectividad.
    expect(esFalloDeTransporte(new TypeError("Failed to parse URL from undefined"))).toBe(false);
    expect(esFalloDeTransporte(new TypeError("Invalid URL"))).toBe(false);
  });

  it("un código de sistema que no es de red NO cuenta", () => {
    expect(esFalloDeTransporte(Object.assign(new Error("no existe"), { code: "ENOENT" }))).toBe(false);
  });

  it("lo que no es un Error no cuenta", () => {
    expect(esFalloDeTransporte("fetch failed")).toBe(false);
    expect(esFalloDeTransporte(null)).toBe(false);
    expect(esFalloDeTransporte(undefined)).toBe(false);
  });
});

describe("ejecutarPeticionDeRed", () => {
  it("deja pasar la respuesta cuando todo va bien", async () => {
    const r = new Response("ok");
    await expect(ejecutarPeticionDeRed("Proveedor", "ctx", async () => r)).resolves.toBe(r);
  });

  it("convierte el corte de red en un error MARCADO como reintentable", async () => {
    const error = await ejecutarPeticionDeRed("Mercado Libre", "/orders/search", async () => {
      throw falloDeRed("ECONNRESET");
    }).catch((e) => e);

    expect(error).toBeInstanceOf(ErrorRedIntegracion);
    expect(esErrorReintentable(error)).toBe(true);
    expect(error.proveedor).toBe("Mercado Libre");
    expect(error.message).toContain("/orders/search");
    // La causa original se conserva para poder diagnosticar.
    expect((error as ErrorRedIntegracion).cause).toBeDefined();
  });

  it("relanza INTACTO lo que no es fallo de transporte", async () => {
    const bug = new TypeError("x.map is not a function");
    const error = await ejecutarPeticionDeRed("Shopify", "ctx", async () => {
      throw bug;
    }).catch((e) => e);

    expect(error).toBe(bug);
    expect(esErrorReintentable(error)).toBe(false);
  });

  it("el backoff SÍ reintenta el error que produce, y termina resolviendo", async () => {
    // La prueba de que las dos piezas encajan: sin la marca, `reintentarConBackoff`
    // se rendía al primer intento — que era el bug.
    const ejecutar = vi
      .fn()
      .mockRejectedValueOnce(falloDeRed("ECONNREFUSED"))
      .mockResolvedValueOnce(new Response("ok"));

    const respuesta = await reintentarConBackoff(
      () => ejecutarPeticionDeRed("Falabella", "GetOrders", ejecutar),
      { maxIntentos: 3, dormir: async () => {} },
    );

    expect(respuesta.status).toBe(200);
    expect(ejecutar).toHaveBeenCalledTimes(2);
  });

  it("el backoff NO reintenta un bug de programación", async () => {
    const ejecutar = vi.fn().mockRejectedValue(new TypeError("x.map is not a function"));

    await expect(
      reintentarConBackoff(() => ejecutarPeticionDeRed("Falabella", "GetOrders", ejecutar), {
        maxIntentos: 3,
        dormir: async () => {},
      }),
    ).rejects.toThrow("x.map is not a function");

    expect(ejecutar).toHaveBeenCalledTimes(1);
  });
});
