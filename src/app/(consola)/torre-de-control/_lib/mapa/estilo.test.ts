/**
 * El estilo del mapa se valida contra la especificación, no contra el gusto.
 *
 * Por qué existe este test: un estilo inválido NO lanza. MapLibre lo rechaza en
 * silencio, `getStyle()` devuelve `null`, el evento `load` nunca se dispara y,
 * como todo el cableado de datos cuelga de ese evento, el mapa se queda en
 * blanco sin un solo error en consola. Se perdió una tarde así. `validateStyleMin`
 * convierte eso en un fallo de test con el nombre exacto de la propiedad mala.
 */

import { describe, it, expect } from "vitest";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { construirEstilo, CAPAS_POR_ID } from "./estilo";

describe("construirEstilo", () => {
  it("produce un estilo válido con basemap", () => {
    const errores = validateStyleMin(
      construirEstilo({ urlBasemap: "https://ejemplo.test/rm.pmtiles", sinZonas: false }),
    );
    expect(errores.map((e) => `${e.message}`)).toEqual([]);
  });

  it("produce un estilo válido sin basemap publicado", () => {
    const errores = validateStyleMin(construirEstilo({ urlBasemap: null, sinZonas: false }));
    expect(errores.map((e) => `${e.message}`)).toEqual([]);
  });

  it("produce un estilo válido en el estado sin_zonas", () => {
    const errores = validateStyleMin(construirEstilo({ urlBasemap: null, sinZonas: true }));
    expect(errores.map((e) => `${e.message}`)).toEqual([]);
  });

  it("no declara glyphs ni sprite: el estilo no tiene una sola capa de texto", () => {
    const estilo = construirEstilo({ urlBasemap: null, sinZonas: false });
    expect(estilo.glyphs).toBeUndefined();
    expect(estilo.sprite).toBeUndefined();
    expect(estilo.layers.some((c) => c.type === "symbol" && "text-field" in (c.layout ?? {}))).toBe(
      false,
    );
  });

  it("sin basemap no quedan capas huérfanas apuntando a una fuente inexistente", () => {
    const estilo = construirEstilo({ urlBasemap: null, sinZonas: false });
    const fuentes = new Set(Object.keys(estilo.sources));
    for (const capa of estilo.layers) {
      if ("source" in capa && capa.source) expect(fuentes.has(capa.source)).toBe(true);
    }
  });

  it("cada capa que el control enciende existe en el estilo", () => {
    const estilo = construirEstilo({ urlBasemap: null, sinZonas: false });
    const ids = new Set(estilo.layers.map((c) => c.id));
    for (const [capa, capasEstilo] of Object.entries(CAPAS_POR_ID)) {
      for (const id of capasEstilo) {
        expect(ids.has(id), `${capa} → ${id}`).toBe(true);
      }
    }
  });
});
