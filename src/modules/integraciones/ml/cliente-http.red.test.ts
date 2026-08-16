/**
 * Un corte de red en el cliente de Mercado Libre se reintenta.
 *
 * Hasta el 2026-08-16 no se reintentaba: `fetch` lanza el fallo de transporte
 * como un `TypeError` pelado, sin la marca que `reintentarConBackoff` exige, así
 * que un DNS lento o un socket cortado tumbaba el job entero aunque el backoff
 * estuviera puesto. Esta prueba es la que impide que vuelva a pasar.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { peticionMl, peticionBinariaMl, ErrorHttpMl } from "./cliente-http";
import { ErrorRedIntegracion, esErrorReintentable } from "../resiliencia";

const SIN_DORMIR = { dormir: async () => {} };

/** `fetch` de undici ante un corte real: `TypeError` con el motivo en `cause`. */
function falloDeRed(codigo = "ECONNRESET"): TypeError {
  const causa = Object.assign(new Error(`connect ${codigo}`), { code: codigo });
  return Object.assign(new TypeError("fetch failed"), { cause: causa });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("peticionMl ante un corte de red", () => {
  it("reintenta y sale adelante cuando la red vuelve", async () => {
    const fetchFalso = vi
      .fn()
      .mockRejectedValueOnce(falloDeRed())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 1 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchFalso);

    const data = await peticionMl<{ id: number }>({
      metodo: "GET",
      ruta: "/orders/search",
      accessToken: "t",
      opcionesReintento: { maxIntentos: 3, ...SIN_DORMIR },
    });

    expect(data.id).toBe(1);
    expect(fetchFalso).toHaveBeenCalledTimes(2);
  });

  it("si la red no vuelve, el error final está marcado como reintentable y nombra la ruta", async () => {
    const fetchFalso = vi.fn().mockRejectedValue(falloDeRed("ENOTFOUND"));
    vi.stubGlobal("fetch", fetchFalso);

    const error = await peticionMl({
      metodo: "GET",
      ruta: "/shipments/123",
      accessToken: "secreto",
      opcionesReintento: { maxIntentos: 2, ...SIN_DORMIR },
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ErrorRedIntegracion);
    expect(esErrorReintentable(error)).toBe(true);
    expect((error as Error).message).toContain("/shipments/123");
    // El token NUNCA aparece en el mensaje de error.
    expect((error as Error).message).not.toContain("secreto");
    expect(fetchFalso).toHaveBeenCalledTimes(2);
  });

  it("peticionBinariaMl (etiquetas) también reintenta", async () => {
    const fetchFalso = vi
      .fn()
      .mockRejectedValueOnce(falloDeRed())
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "application/pdf" },
        }),
      );
    vi.stubGlobal("fetch", fetchFalso);

    const r = await peticionBinariaMl({
      metodo: "GET",
      ruta: "/shipment_labels",
      accessToken: "t",
      opcionesReintento: { maxIntentos: 3, ...SIN_DORMIR },
    });

    expect(r.contentType).toContain("pdf");
    expect(fetchFalso).toHaveBeenCalledTimes(2);
  });

  it("un 401 sigue SIN reintentarse: la regla vieja no se aflojó", async () => {
    const fetchFalso = vi.fn().mockResolvedValue(new Response("{}", { status: 401 }));
    vi.stubGlobal("fetch", fetchFalso);

    const error = await peticionMl({
      metodo: "GET",
      ruta: "/users/me",
      accessToken: "t",
      opcionesReintento: { maxIntentos: 4, ...SIN_DORMIR },
    }).catch((e) => e);

    expect(error).toBeInstanceOf(ErrorHttpMl);
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it("una URL mal construida no se reintenta: es un bug, no la red", async () => {
    const fetchFalso = vi.fn().mockRejectedValue(new TypeError("Failed to parse URL from undefined"));
    vi.stubGlobal("fetch", fetchFalso);

    await expect(
      peticionMl({
        metodo: "GET",
        ruta: "/x",
        accessToken: "t",
        opcionesReintento: { maxIntentos: 4, ...SIN_DORMIR },
      }),
    ).rejects.toThrow(/parse URL/i);

    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });
});
