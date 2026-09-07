/**
 * Un punto al azar DENTRO de una comuna de la RM.
 * =============================================================================
 *
 * Solo para la herramienta de QA que crea pedidos same-day de prueba: en vez de
 * una dirección ficticia (que el geocodificador no puede ubicar), se le pone al
 * pedido una coordenada real dispersa por la comuna, para que el motor de ruteo
 * y el mapa del circuito la tomen como cualquier pedido real.
 *
 * Usa la MISMA geometría comunal DPA 2023 que la Torre
 * (`public/mapas/comunas-rm.topojson.json`), importada estáticamente para que
 * viaje dentro de la función serverless (no depende de leer `public/` en disco
 * en producción). El muestreo es por rechazo dentro de la caja envolvente, con
 * prueba de punto-en-polígono (regla par-impar, respeta agujeros).
 */

import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { Feature, Polygon, MultiPolygon } from "geojson";
// Ruta relativa a `public/` — fuera de `src/`, a propósito: es el mismo archivo
// versionado que consume la Torre; no se duplica.
import topoRaw from "../../../public/mapas/comunas-rm.topojson.json";

type Geo = Feature<Polygon | MultiPolygon, { comuna: string; cut: string }>;

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^comuna de /, "")
    .trim();
}

let indice: Map<string, Geo> | null = null;

function cargarIndice(): Map<string, Geo> {
  if (indice) return indice;
  const topo = topoRaw as unknown as Topology;
  const capa = topo.objects.comunas as GeometryCollection<{ comuna: string; cut: string }>;
  const coleccion = feature(topo, capa);
  const m = new Map<string, Geo>();
  for (const f of coleccion.features) {
    const nombre = f.properties?.comuna;
    if (nombre) m.set(normalizar(nombre), f as Geo);
  }
  indice = m;
  return m;
}

/** Anillos (long,lat) de un feature Polygon o MultiPolygon, agrupados por polígono. */
function poligonosDe(geo: Geo): number[][][][] {
  return geo.geometry.type === "Polygon"
    ? [geo.geometry.coordinates]
    : geo.geometry.coordinates;
}

/** Ray casting par-impar sobre un anillo. */
function enAnillo(anillo: number[][], long: number, lat: number): boolean {
  let dentro = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const [xi, yi] = anillo[i];
    const [xj, yj] = anillo[j];
    const cruza = yi > lat !== yj > lat && long < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (cruza) dentro = !dentro;
  }
  return dentro;
}

/** Dentro de un polígono = dentro del anillo exterior y fuera de sus agujeros. */
function enPoligono(poligono: number[][][], long: number, lat: number): boolean {
  if (!enAnillo(poligono[0], long, lat)) return false;
  for (let k = 1; k < poligono.length; k++) {
    if (enAnillo(poligono[k], long, lat)) return false; // cae en un agujero
  }
  return true;
}

function cajaEnvolvente(geo: Geo): { oeste: number; sur: number; este: number; norte: number } {
  let oeste = Infinity,
    sur = Infinity,
    este = -Infinity,
    norte = -Infinity;
  for (const pol of poligonosDe(geo)) {
    for (const [long, lat] of pol[0]) {
      if (long < oeste) oeste = long;
      if (long > este) este = long;
      if (lat < sur) sur = lat;
      if (lat > norte) norte = lat;
    }
  }
  return { oeste, sur, este, norte };
}

export interface Coordenada {
  lat: number;
  long: number;
}

/**
 * Devuelve una coordenada al azar dentro de la comuna, o `null` si la comuna no
 * está en el catálogo geográfico. Con hasta 80 intentos por rechazo alcanza a
 * cualquier comuna de la RM; si por una forma muy irregular no acierta, cae al
 * centro de la caja envolvente (siempre dentro de la RM, suficiente para QA).
 */
export function puntoAleatorioEnComuna(comuna: string): Coordenada | null {
  const geo = cargarIndice().get(normalizar(comuna));
  if (!geo) return null;

  const { oeste, sur, este, norte } = cajaEnvolvente(geo);
  const poligonos = poligonosDe(geo);

  for (let intento = 0; intento < 80; intento++) {
    const long = oeste + Math.random() * (este - oeste);
    const lat = sur + Math.random() * (norte - sur);
    if (poligonos.some((p) => enPoligono(p, long, lat))) {
      return { lat, long };
    }
  }
  return { lat: (sur + norte) / 2, long: (oeste + este) / 2 };
}
