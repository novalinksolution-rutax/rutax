/**
 * Geometría del mapa — y el contrato del activo cartográfico.
 *
 * Este archivo cubre dos cosas que fallan calladas:
 *
 * 1. EL SIGNO DEL CENTROIDE. El área con signo tiene dos formas clásicas del
 *    cordón de zapato —trapezoidal y de producto cruzado— con el MISMO valor
 *    absoluto y el signo OPUESTO. Mezclarlas espeja el centroide respecto del
 *    origen y, en Santiago, lo manda al hemisferio contrario. No lo detecta el
 *    typecheck (son números), no lo detecta un test de "devuelve dos números",
 *    y en pantalla se ve como placas proyectadas a decenas de miles de píxeles.
 *
 * 2. EL EMPAREJAMIENTO DE NOMBRES. Las zonas del courier se dibujan buscando
 *    sus comunas por nombre dentro del TopoJSON de la DPA. Si el activo se
 *    regenera con otra capa, otro campo u otra ortografía, la zona pierde su
 *    geometría EN SILENCIO: no hay error, simplemente deja de haber polígono.
 *    Por eso el test lee el archivo real de `public/mapas/`, no una maqueta.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Topology } from "topojson-specification";
import type { MultiPolygon, Polygon } from "geojson";
import { COMUNAS_RM } from "@/lib/ui/comunas-rm";
import type { Zona } from "../../_fixture/estado-torre";
import { ZONAS } from "../../_fixture/estado-torre";
import {
  cajaEnvolvente,
  centroideVisual,
  circuloGeodesico,
  claveComuna,
  geometriaDeComunas,
  geometriaDeZonas,
} from "./geometria";

const TOPOLOGIA = JSON.parse(
  readFileSync(resolve("public/mapas/comunas-rm.topojson.json"), "utf8"),
) as Topology;

/** Cuadrado con vértices en sentido horario, centrado en (10, 20). */
const CUADRADO: Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [5, 15],
      [5, 25],
      [15, 25],
      [15, 15],
      [5, 15],
    ],
  ],
};

describe("centroideVisual", () => {
  it("devuelve el centro de un cuadrado", () => {
    const [x, y] = centroideVisual(CUADRADO);
    expect(x).toBeCloseTo(10, 6);
    expect(y).toBeCloseTo(20, 6);
  });

  it("da el mismo centro con el anillo recorrido al revés", () => {
    const invertido: Polygon = {
      type: "Polygon",
      coordinates: [[...CUADRADO.coordinates[0]].reverse()],
    };
    const [x, y] = centroideVisual(invertido);
    expect(x).toBeCloseTo(10, 6);
    expect(y).toBeCloseTo(20, 6);
  });

  it("NO espeja el signo: un polígono en Santiago queda en Santiago", () => {
    // Regresión exacta del bug: mezclar la forma trapezoidal del área con el
    // centroide de producto cruzado devolvía (70,6 · 33,4) — en el hemisferio
    // opuesto, a medio mundo de distancia.
    const santiago: Polygon = {
      type: "Polygon",
      coordinates: [
        [
          [-70.7, -33.5],
          [-70.7, -33.4],
          [-70.6, -33.4],
          [-70.6, -33.5],
          [-70.7, -33.5],
        ],
      ],
    };
    const [long, lat] = centroideVisual(santiago);
    expect(long).toBeLessThan(0);
    expect(lat).toBeLessThan(0);
    expect(long).toBeCloseTo(-70.65, 6);
    expect(lat).toBeCloseTo(-33.45, 6);
  });

  it("elige la pieza mayor de un multipolígono, no el hueco entre piezas", () => {
    // Una pieza grande en el origen y una diminuta muy lejos. El centroide
    // global caería entre las dos, en el vacío; la placa tiene que ir sobre el
    // cuerpo principal.
    const disperso: MultiPolygon = {
      type: "MultiPolygon",
      coordinates: [
        CUADRADO.coordinates,
        [
          [
            [100, 100],
            [100, 100.1],
            [100.1, 100.1],
            [100.1, 100],
            [100, 100],
          ],
        ],
      ],
    };
    const [x, y] = centroideVisual(disperso);
    expect(x).toBeCloseTo(10, 6);
    expect(y).toBeCloseTo(20, 6);
  });
});

describe("claveComuna", () => {
  it("ignora acentos, caja y espacios sobrantes", () => {
    expect(claveComuna(" Ñuñoa ")).toBe(claveComuna("NUNOA"));
    expect(claveComuna("Peñalolén")).toBe(claveComuna("penalolen"));
    expect(claveComuna("Estación Central")).toBe("estacion central");
  });

  it("no confunde comunas distintas de nombre parecido", () => {
    expect(claveComuna("San Miguel")).not.toBe(claveComuna("San Ramón"));
  });
});

describe("el activo cartográfico de public/mapas", () => {
  it("trae las 52 comunas de la Región Metropolitana", () => {
    const comunas = geometriaDeComunas(TOPOLOGIA, []);
    expect(comunas.features).toHaveLength(52);
  });

  it("cada comuna del catálogo del producto tiene geometría", () => {
    const enMapa = new Set(
      geometriaDeComunas(TOPOLOGIA, []).features.map((f) => claveComuna(f.properties.comuna)),
    );
    const sinGeometria = COMUNAS_RM.filter((c) => !enMapa.has(claveComuna(c)));
    expect(sinGeometria).toEqual([]);
  });

  it("toda la geometría cae dentro de la Región Metropolitana", () => {
    const caja = cajaEnvolvente(geometriaDeComunas(TOPOLOGIA, []));
    expect(caja).not.toBeNull();
    const [oeste, sur, este, norte] = caja!;
    expect(oeste).toBeGreaterThan(-72);
    expect(este).toBeLessThan(-69.5);
    expect(sur).toBeGreaterThan(-34.5);
    expect(norte).toBeLessThan(-32.5);
  });
});

describe("geometriaDeZonas", () => {
  it("dibuja todas las zonas de la fixture y las deja en Santiago", () => {
    const zonas = geometriaDeZonas(TOPOLOGIA, ZONAS);
    expect(zonas.features).toHaveLength(ZONAS.length);

    for (const feature of zonas.features) {
      const [long, lat] = centroideVisual(feature.geometry);
      expect(long, feature.properties.nombre).toBeGreaterThan(-71.5);
      expect(long, feature.properties.nombre).toBeLessThan(-70);
      expect(lat, feature.properties.nombre).toBeGreaterThan(-34);
      expect(lat, feature.properties.nombre).toBeLessThan(-33);
    }
  });

  it("lleva el paso de la escala de riesgo, que es lo que elige la trama", () => {
    const zonas = geometriaDeZonas(TOPOLOGIA, ZONAS);
    for (const feature of zonas.features) {
      expect(feature.properties.paso).toBeGreaterThanOrEqual(1);
      expect(feature.properties.paso).toBeLessThanOrEqual(5);
      expect(feature.properties.critico).toBe(feature.properties.riesgo >= 76);
    }
  });

  it("omite la zona cuyas comunas no existen en la DPA, sin lanzar", () => {
    const inventada: Zona = { ...ZONAS[0], id: "zona-fantasma", comunas: ["Valparaíso"] };
    const zonas = geometriaDeZonas(TOPOLOGIA, [inventada]);
    expect(zonas.features).toHaveLength(0);
  });

  it("asigna cada comuna a la zona que la declara", () => {
    const comunas = geometriaDeComunas(TOPOLOGIA, ZONAS);
    const zonaEsperada = new Map(
      ZONAS.flatMap((z) => z.comunas.map((c) => [claveComuna(c), z.id] as const)),
    );
    for (const f of comunas.features) {
      expect(f.properties.zonaId, f.properties.comuna).toBe(
        zonaEsperada.get(claveComuna(f.properties.comuna)) ?? null,
      );
    }
    // Las 5 zonas de la fixture reparten la RM entera, así que aquí no queda
    // ninguna comuna huérfana. La rama `null` se prueba abajo, con un courier
    // que solo opera parte de la región.
    expect(comunas.features.every((f) => f.properties.zonaId !== null)).toBe(true);
  });

  it("deja en null la comuna que ninguna zona reclama", () => {
    const soloUna: Zona = { ...ZONAS[0], comunas: ["Santiago"] };
    const comunas = geometriaDeComunas(TOPOLOGIA, [soloUna]);
    const asignadas = comunas.features.filter((f) => f.properties.zonaId !== null);
    expect(asignadas).toHaveLength(1);
    expect(asignadas[0].properties.comuna).toBe("Santiago");
  });
});

describe("circuloGeodesico", () => {
  it("cierra el anillo", () => {
    const circulo = circuloGeodesico({ lat: -33.45, long: -70.65 }, 5000);
    const anillo = circulo.coordinates[0];
    expect(anillo[0]).toEqual(anillo[anillo.length - 1]);
  });

  it("el radio norte-sur corresponde a los metros pedidos", () => {
    const centro = { lat: -33.45, long: -70.65 };
    const circulo = circuloGeodesico(centro, 10_000);
    const lats = circulo.coordinates[0].map((p) => p[1]);
    // 10 km ≈ 0,0899° de latitud (radio terrestre medio).
    expect(Math.max(...lats) - centro.lat).toBeCloseTo(0.0899, 3);
  });

  it("compensa la convergencia de meridianos: más grados de longitud que de latitud", () => {
    const centro = { lat: -33.45, long: -70.65 };
    const anillo = circuloGeodesico(centro, 10_000).coordinates[0];
    const dLat = Math.max(...anillo.map((p) => p[1])) - centro.lat;
    const dLon = Math.max(...anillo.map((p) => p[0])) - centro.long;
    expect(dLon).toBeGreaterThan(dLat);
    expect(dLon / dLat).toBeCloseTo(1 / Math.cos((centro.lat * Math.PI) / 180), 3);
  });
});
