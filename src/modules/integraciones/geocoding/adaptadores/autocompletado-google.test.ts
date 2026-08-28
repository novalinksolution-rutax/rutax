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

describe("AutocompletadoGoogle · «calle y número», compuesto y no recortado", () => {
  function detalle(componentes: Array<{ longText: string; types: string[] }>) {
    return responder(200, {
      formattedAddress: "LARGA, con comuna, región y país",
      location: { latitude: -33.4, longitude: -70.6 },
      addressComponents: componentes,
    });
  }

  it("compone route + street_number, en el orden chileno", () => {
    // En Chile el número va DESPUÉS de la calle. Google los entrega separados,
    // así que el orden lo decide el adaptador, no el texto.
    vi.stubGlobal(
      "fetch",
      detalle([
        { longText: "5001", types: ["street_number"] },
        { longText: "Los Militares", types: ["route"] },
        { longText: "Las Condes", types: ["administrative_area_level_3"] },
      ]),
    );
    return expect(
      new AutocompletadoGoogle(LLAVE).resolver({ id: "p1", sesion: "s1" }),
    ).resolves.toMatchObject({ direccionCorta: "Los Militares 5001", comuna: "Las Condes" });
  });

  /**
   * 🔴 La contraprueba de la decisión: NO se recorta el texto largo por comas.
   *
   * Una dirección con una coma en la calle —«Camino El Alba, Km 2»— haría que
   * un recorte guardara «Camino El Alba» y perdiera el kilómetro. Fallaría en
   * silencio y solo en las direcciones raras, que son justo las que el
   * conductor no encuentra.
   */
  it("una calle CON coma sobrevive entera", () => {
    vi.stubGlobal(
      "fetch",
      detalle([
        { longText: "Camino El Alba, Km 2", types: ["route"] },
        { longText: "Lo Barnechea", types: ["administrative_area_level_3"] },
      ]),
    );
    return expect(
      new AutocompletadoGoogle(LLAVE).resolver({ id: "p1", sesion: "s1" }),
    ).resolves.toMatchObject({ direccionCorta: "Camino El Alba, Km 2" });
  });

  it("una calle sin número no inventa uno", () => {
    vi.stubGlobal("fetch", detalle([{ longText: "Los Militares", types: ["route"] }]));
    return expect(
      new AutocompletadoGoogle(LLAVE).resolver({ id: "p1", sesion: "s1" }),
    ).resolves.toMatchObject({ direccionCorta: "Los Militares" });
  });

  it("sin calle devuelve null: decide quien llama, no el adaptador", () => {
    // El caso del lugar con nombre propio («Mall Parque Arauco»). Devolver la
    // dirección larga acá metería la comuna y el país en el campo, que es
    // exactamente lo que se quiso evitar.
    vi.stubGlobal(
      "fetch",
      detalle([{ longText: "Las Condes", types: ["administrative_area_level_3"] }]),
    );
    return expect(
      new AutocompletadoGoogle(LLAVE).resolver({ id: "p1", sesion: "s1" }),
    ).resolves.toMatchObject({ direccionCorta: null, comuna: "Las Condes" });
  });

  it("la larga se conserva igual: es el dato crudo del proveedor", () => {
    vi.stubGlobal(
      "fetch",
      detalle([
        { longText: "5001", types: ["street_number"] },
        { longText: "Los Militares", types: ["route"] },
      ]),
    );
    return expect(
      new AutocompletadoGoogle(LLAVE).resolver({ id: "p1", sesion: "s1" }),
    ).resolves.toMatchObject({ direccion: "LARGA, con comuna, región y país" });
  });
});

describe("AutocompletadoGoogle · una comuna suelta no es una dirección", () => {
  /** Arma una predicción con la forma real de la API nueva. */
  function prediccion(principal: string, secundaria: string, types: string[] | undefined) {
    return {
      placePrediction: {
        placeId: `id-${principal}`,
        structuredFormat: { mainText: { text: principal }, secondaryText: { text: secundaria } },
        ...(types ? { types } : {}),
      },
    };
  }

  it("🔴 descarta la comuna suelta: «pucon» ya no propone «Pucón, Chile»", async () => {
    // El caso que lo motivó: se podía elegir una comuna entera como dirección de
    // una bodega o de una factura.
    vi.stubGlobal(
      "fetch",
      responder(200, {
        suggestions: [prediccion("Pucón", "Chile", ["locality", "political"])],
      }),
    );
    await expect(
      new AutocompletadoGoogle(LLAVE).sugerir({ consulta: "pucon", sesion: "s1" }),
    ).resolves.toEqual([]);
  });

  it("descarta región, país y código postal", async () => {
    vi.stubGlobal(
      "fetch",
      responder(200, {
        suggestions: [
          prediccion("Región Metropolitana", "Chile", ["administrative_area_level_1", "political"]),
          prediccion("Chile", "", ["country", "political"]),
          prediccion("7550000", "Las Condes", ["postal_code"]),
        ],
      }),
    );
    await expect(
      new AutocompletadoGoogle(LLAVE).sugerir({ consulta: "region", sesion: "s1" }),
    ).resolves.toEqual([]);
  });

  it("🔴 CONSERVA una dirección de calle (contraprueba)", async () => {
    // Sin esto, un filtro que descartara TODO pasaría las pruebas de arriba y
    // dejaría el buscador mudo.
    vi.stubGlobal(
      "fetch",
      responder(200, {
        suggestions: [
          prediccion("Los Militares 5001", "Las Condes, Chile", ["street_address"]),
        ],
      }),
    );
    const r = await new AutocompletadoGoogle(LLAVE).sugerir({
      consulta: "Los Militares",
      sesion: "s1",
    });
    expect(r).toHaveLength(1);
    expect(r[0].principal).toBe("Los Militares 5001");
  });

  it("🔴 CONSERVA un lugar con nombre propio, aunque traiga tipos administrativos", async () => {
    // «Mall Parque Arauco» es una dirección legítima y el propio CampoDireccion
    // cuenta con ella. Lo que se descarta es lo que no tiene NADA más que
    // administrativo.
    vi.stubGlobal(
      "fetch",
      responder(200, {
        suggestions: [
          prediccion("Mall Parque Arauco", "Las Condes, Chile", [
            "shopping_mall",
            "establishment",
            "point_of_interest",
            "political",
          ]),
        ],
      }),
    );
    await expect(
      new AutocompletadoGoogle(LLAVE).sugerir({ consulta: "parque arauco", sesion: "s1" }),
    ).resolves.toHaveLength(1);
  });

  it("🔴 sin `types` NO descarta nada: el filtro falla ABIERTO", async () => {
    // Es la decisión de diseño. Si Google dejara de mandar `types` —o los mandara
    // con otro nombre— una lista de permitidos habría vaciado el buscador en
    // silencio. Acá lo peor que pasa es que se cuele una sugerencia de más.
    vi.stubGlobal(
      "fetch",
      responder(200, {
        suggestions: [prediccion("Los Militares 5001", "Las Condes, Chile", undefined)],
      }),
    );
    await expect(
      new AutocompletadoGoogle(LLAVE).sugerir({ consulta: "Los Militares", sesion: "s1" }),
    ).resolves.toHaveLength(1);
  });

  it("de una lista mixta se queda solo con lo direccionable", async () => {
    vi.stubGlobal(
      "fetch",
      responder(200, {
        suggestions: [
          prediccion("Pucón", "Chile", ["locality", "political"]),
          prediccion("Av. Bernardo O'Higgins 123", "Pucón, Chile", ["street_address"]),
        ],
      }),
    );
    const r = await new AutocompletadoGoogle(LLAVE).sugerir({ consulta: "pucon", sesion: "s1" });
    expect(r.map((x) => x.principal)).toEqual(["Av. Bernardo O'Higgins 123"]);
  });
});
