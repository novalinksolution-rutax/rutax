/**
 * Geometría comunal de la Torre — cartografía estática, separada del conteo.
 * =============================================================================
 *
 * ⚠️ **La forma de la ciudad NO depende de que haya pedidos.** Ésta es la
 * corrección que la Vía C trae del QA visual: en el prototipo, el estado
 * «sin pedidos» borraba las comunas del mapa, porque los polígonos se derivaban
 * de la lista que devuelve el composer. Un domingo la pantalla quedaba en blanco
 * y parecía rota, cuando lo correcto es «la ciudad sigue ahí y hoy no hay nada
 * que repartir» (`lenguaje-visual-v2.md` §6).
 *
 * Por eso son dos cosas distintas y se cargan por separado:
 *   · **Geometría** — las 52 comunas de la RM, DPA 2023, versionadas en
 *     `public/mapas/`. Cambian cuando la SUBDERE publica una DPA nueva.
 *   · **Carga** — la fracción del día por comuna, que llega del composer y se
 *     pega encima como propiedades.
 *
 * El TopoJSON es COMUNAL y nunca viene disuelto por zona: cada courier agrupa
 * sus comunas distinto, así que un archivo pre-disuelto congelaría la
 * agrupación de un tenant para todos los demás. Ver `scripts/mapa/README.md`.
 */

import { feature } from 'topojson-client';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import type { Topology, GeometryCollection } from 'topojson-specification';
import { CAPA_TOPOJSON, RUTA_TOPOJSON_COMUNAS } from './mapa/config';
import { claveComuna } from './comunas';

export type GeometriaComuna = Feature<Polygon | MultiPolygon, { comuna: string; cut: string }>;

/** Caja envolvente en el formato que espera MapLibre: `[[oeste,sur],[este,norte]]`. */
export type LimitesComuna = [[number, number], [number, number]];

/**
 * La caja envolvente de una comuna.
 *
 * Existe para que entrar en una comuna la **encuadre** en vez de volar a un zoom
 * fijo. Las comunas de la RM van de 7 km² (Independencia) a casi 200 (Pudahuel):
 * con un zoom único, la chica queda perdida en medio de sus vecinas y de la
 * grande solo se ve un pedazo, sin bordes a la vista y sin saber dónde estás.
 */
export function limitesDe(geometria: GeometriaComuna): LimitesComuna {
  let oeste = Infinity;
  let sur = Infinity;
  let este = -Infinity;
  let norte = -Infinity;

  // Un `MultiPolygon` envuelve una dimensión más que un `Polygon`; se aplana a
  // la lista de anillos en los dos casos y se recorre igual.
  const poligonos =
    geometria.geometry.type === 'Polygon'
      ? [geometria.geometry.coordinates]
      : geometria.geometry.coordinates;

  for (const poligono of poligonos) {
    // Solo el anillo exterior: los agujeros están dentro por definición.
    for (const [long, lat] of poligono[0]) {
      if (long < oeste) oeste = long;
      if (long > este) este = long;
      if (lat < sur) sur = lat;
      if (lat > norte) norte = lat;
    }
  }

  return [
    [oeste, sur],
    [este, norte],
  ];
}

/** Índice `clave normalizada → geometría`, para emparejar con lo que trae el composer. */
export type MapaGeometrias = ReadonlyMap<string, GeometriaComuna>;

/**
 * Carga la geometría comunal y la indexa por nombre normalizado.
 *
 * El emparejamiento va por clave normalizada —sin acentos, en minúsculas— y no
 * por el nombre crudo: la DPA escribe «Ñuñoa» y un pedido puede traer «NUNOA».
 * Lo que **no** resuelve es un cambio de nombre en la DPA; si eso pasara, la
 * comuna perdería su polígono en silencio. Es un riesgo conocido y documentado
 * en `scripts/mapa/README.md`.
 */
export async function cargarGeometriaComunal(senal?: AbortSignal): Promise<MapaGeometrias> {
  const respuesta = await fetch(RUTA_TOPOJSON_COMUNAS, { signal: senal, cache: 'force-cache' });
  if (!respuesta.ok) {
    throw new Error(`No se pudo cargar la geometría comunal (HTTP ${respuesta.status})`);
  }

  const topologia = (await respuesta.json()) as Topology;
  const capa = topologia.objects[CAPA_TOPOJSON] as GeometryCollection<{
    comuna: string;
    cut: string;
  }>;
  if (!capa) {
    throw new Error(`El TopoJSON no trae la capa «${CAPA_TOPOJSON}»`);
  }

  const coleccion = feature(topologia, capa);
  const indice = new Map<string, GeometriaComuna>();
  for (const f of coleccion.features) {
    const nombre = f.properties?.comuna;
    if (!nombre) continue;
    indice.set(claveComuna(nombre), f as GeometriaComuna);
  }
  return indice;
}
