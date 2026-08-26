import { afterEach, describe, expect, it, vi } from "vitest";

import { AutocompletadoGoogle, ErrorProveedorAutocompletado } from "./autocompletado-google";

const LLAVE = "llave-de-prueba";

function responder(estado: number, cuerpo: unknown = {}) {
  return vi.fn().mockResolvedValue({
    ok: estado >= 200 && estado < 300,
    status: estado,
    json: async () => cuerpo,
  } as unknown as Response);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AutocompletadoGoogle · el rechazo del proveedor NO es «sin resultados»", () => {
  /**
   * 🔴 La red del defecto del 26-08-2026.
   *
   * El adaptador devolvía `null` ante cualquier respuesta no-OK y los dos
   * métodos lo traducían a lista vacía. O sea que el fallo MÁS PROBABLE de
   * todos —403 porque la Places API (New) no está habilitada en el proyecto de
   * Google, o porque la llave está restringida a otra API— se veía en pantalla
   * como «esa dirección no existe».
   *
   * Habilitar la Geocoding API no habilita ésta: son dos productos distintos.
   * Sin esta distinción, el día que alguien conecte Google en producción va a
   * ver un campo que no sugiere nada y no va a tener forma de saber por qué.
   */
  it("un 403 se propaga con su código, en vez de devolver lista vacía", async () => {
    vi.stubGlobal("fetch", responder(403));
    const adaptador = new AutocompletadoGoogle(LLAVE);

    await expect(
      adaptador.sugerir({ consulta: "Av. Providencia 1234", sesion: "s1" }),
    ).rejects.toBeInstanceOf(ErrorProveedorAutocompletado);

    // El código tiene que sobrevivir: es lo único que distingue «no habilitada»
    // (403) de «cuota agotada» (429) cuando alguien lea el log.
    await expect(
      adaptador.sugerir({ consulta: "Av. Providencia 1234", sesion: "s1" }),
    ).rejects.toMatchObject({ estado: 403 });
  });

  it("un 429 también, y con su propio código", async () => {
    vi.stubGlobal("fetch", responder(429));
    await expect(
      new AutocompletadoGoogle(LLAVE).sugerir({ consulta: "Los Militares 5000", sesion: "s1" }),
    ).rejects.toMatchObject({ estado: 429 });
  });

  it("una respuesta OK sin sugerencias SÍ es lista vacía: eso es «no hay»", async () => {
    // La contraprueba. Sin ella, «todo lanza» pasaría igual de verde y la
    // pantalla diría «no pudimos buscar» cuando la dirección simplemente no
    // existe.
    vi.stubGlobal("fetch", responder(200, { suggestions: [] }));
    await expect(
      new AutocompletadoGoogle(LLAVE).sugerir({ consulta: "Calle que no existe", sesion: "s1" }),
    ).resolves.toEqual([]);
  });

  it("menos de tres letras no llega a la red: la sesión se cobra igual", async () => {
    const fetchFalso = responder(200, { suggestions: [] });
    vi.stubGlobal("fetch", fetchFalso);
    await expect(
      new AutocompletadoGoogle(LLAVE).sugerir({ consulta: "Av", sesion: "s1" }),
    ).resolves.toEqual([]);
    expect(fetchFalso).not.toHaveBeenCalled();
  });
});

describe("AutocompletadoGoogle · lo que viaja en la petición", () => {
  it("la llave va en cabecera y NUNCA en la URL", async () => {
    // Regla del proyecto: esta llave no aparece en logs ni en URLs, y una URL
    // termina en cualquier log de proxy.
    const fetchFalso = responder(200, { suggestions: [] });
    vi.stubGlobal("fetch", fetchFalso);
    await new AutocompletadoGoogle(LLAVE).sugerir({ consulta: "Av. Matta 100", sesion: "s1" });

    const [url, init] = fetchFalso.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain(LLAVE);
    expect((init.headers as Record<string, string>)["X-Goog-Api-Key"]).toBe(LLAVE);
  });

  it("restringe a Chile y comparte el token de sesión", async () => {
    // `includedRegionCodes` RESTRINGE; `regionCode` solo sesga. Un courier de
    // Santiago que ve «Providencia, Buenos Aires» tiene una forma nueva de
    // equivocarse, y el error se descubre con el conductor ya en la calle.
    // Y sin el token compartido, cada tecla es una consulta facturada.
    const fetchFalso = responder(200, { suggestions: [] });
    vi.stubGlobal("fetch", fetchFalso);
    await new AutocompletadoGoogle(LLAVE).sugerir({ consulta: "Av. Matta 100", sesion: "tok-1" });

    const cuerpo = JSON.parse(
      (fetchFalso.mock.calls[0] as [string, RequestInit])[1].body as string,
    );
    expect(cuerpo.includedRegionCodes).toEqual(["cl"]);
    expect(cuerpo.sessionToken).toBe("tok-1");
  });
});

describe("AutocompletadoGoogle · resolver", () => {
  it("saca la comuna de administrative_area_level_3", async () => {
    vi.stubGlobal(
      "fetch",
      responder(200, {
        formattedAddress: "Av. Providencia 1234, Providencia, Región Metropolitana",
        location: { latitude: -33.42, longitude: -70.61 },
        addressComponents: [
          { longText: "Providencia", types: ["administrative_area_level_3"] },
          { longText: "Santiago", types: ["administrative_area_level_2"] },
        ],
      }),
    );

    await expect(
      new AutocompletadoGoogle(LLAVE).resolver({ id: "place-1", sesion: "s1" }),
    ).resolves.toMatchObject({ comuna: "Providencia", lat: -33.42, long: -70.61 });
  });

  it("ante un fallo devuelve null y NO lanza: el campo conserva lo elegido", async () => {
    // A diferencia de `sugerir`, acá hay camino de vuelta: el texto que la
    // persona eligió se conserva y el job de geocoding resuelve la coordenada
    // después. Propagar dejaría el formulario sin la dirección que sí se eligió.
    vi.stubGlobal("fetch", responder(403));
    await expect(
      new AutocompletadoGoogle(LLAVE).resolver({ id: "place-1", sesion: "s1" }),
    ).resolves.toBeNull();
  });
});
