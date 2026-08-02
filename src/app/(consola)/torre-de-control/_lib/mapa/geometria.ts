/**
 * Geometría del mapa: de comunas DPA 2023 a las zonas del courier.
 * ===========================================================================
 *
 * La disolución comuna→zona se hace AQUÍ, en el cliente, y no en el build.
 * La razón es de producto, no de rendimiento: las zonas son del tenant
 * (`identidad.zonas` + `zona_comunas`) y cada courier agrupa distinto. Un
 * TopoJSON pre-disuelto congelaría la agrupación de un courier para todos los
 * demás, que es justo lo que el módulo no puede hacer.
 *
 * `topojson-client.merge()` es lo que hace esto barato: comparte los arcos de
 * la topología, así que fusionar comunas vecinas ELIMINA la frontera interior
 * en vez de superponer dos trazos. Con GeoJSON suelto habría que hacer una
 * unión geométrica real (y arrastrar una librería de topología entera).
 */

import { merge, feature } from "topojson-client";
import type {
  Topology,
  GeometryCollection,
  Polygon as TopoPolygon,
  MultiPolygon as TopoMultiPolygon,
} from "topojson-specification";
import type { Feature, MultiPolygon, Polygon, Position } from "geojson";
import type { Zona } from "../../_fixture/estado-torre";
import { escalonDeRiesgo } from "../riesgo";
import { CAPA_TOPOJSON, RUTA_TOPOJSON_COMUNAS } from "./config";

export interface PropsZona {
  zonaId: string;
  nombre: string;
  riesgo: number;
  /** Paso 1-5 de la escala: es lo que elige la trama en el estilo. */
  paso: number;
  critico: boolean;
}

export interface PropsComuna {
  comuna: string;
  cut: string;
  /** `null` si la comuna no pertenece a ninguna zona del courier. */
  zonaId: string | null;
}

export type ColeccionZonas = GeoJSON.FeatureCollection<MultiPolygon, PropsZona>;
export type ColeccionComunas = GeoJSON.FeatureCollection<Polygon | MultiPolygon, PropsComuna>;

/**
 * Clave de comparación de nombres de comuna.
 *
 * Se normaliza en local y no con el helper de `integraciones/geocoding` a
 * propósito: importar un módulo de integraciones desde una pantalla invertiría
 * el sentido de flecha que el proyecto ordena. Aquí basta con acentos y caja
 * porque los dos lados vienen del MISMO catálogo canónico (`COMUNAS_RM`, que
 * cuadra nombre a nombre con las 52 comunas de la DPA 2023 — verificado).
 */
export function claveComuna(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

/** Descarga la geometría comunal versionada. Lanza si no está disponible. */
export async function cargarTopologiaComunas(signal?: AbortSignal): Promise<Topology> {
  const respuesta = await fetch(RUTA_TOPOJSON_COMUNAS, { signal, cache: "force-cache" });
  if (!respuesta.ok) {
    throw new Error(`No se pudo cargar la geometría comunal (HTTP ${respuesta.status})`);
  }
  return (await respuesta.json()) as Topology;
}

/**
 * Geometría topológica de una comuna. La colección de TopoJSON admite en teoría
 * cualquier tipo (incluido el objeto nulo), pero esta capa la genera el script
 * de cartografía desde un shapefile de polígonos: se acota el tipo aquí y las
 * demás formas se descartan, en vez de arrastrar la unión por todo el archivo.
 */
type GeometriaComuna = TopoPolygon<PropsComuna> | TopoMultiPolygon<PropsComuna>;

function geometriasDe(topologia: Topology): GeometriaComuna[] {
  const capa = topologia.objects[CAPA_TOPOJSON] as GeometryCollection<PropsComuna> | undefined;
  return (capa?.geometries ?? []).filter(
    (g): g is GeometriaComuna => g.type === "Polygon" || g.type === "MultiPolygon",
  );
}

/** Índice clave-de-comuna → geometría topológica. */
function indexarComunas(topologia: Topology): Map<string, GeometriaComuna> {
  const indice = new Map<string, GeometriaComuna>();
  for (const geometria of geometriasDe(topologia)) {
    const nombre = geometria.properties?.comuna;
    if (nombre) indice.set(claveComuna(nombre), geometria);
  }
  return indice;
}

/**
 * Zonas del courier como polígonos: una feature por zona, con las comunas
 * fusionadas y la frontera interior eliminada.
 *
 * Una zona cuyas comunas no estén en la DPA (o que no tenga comunas asignadas)
 * NO produce feature — pero tampoco desaparece del tablero: su placa se sigue
 * dibujando sobre `zona.centro`, y la lista de zonas la muestra igual. Un mapa
 * que se traga una zona entera mentiría sobre la carga real, que es lo mismo
 * que prohíbe la regla 5 para los pedidos sin geocodificar.
 */
export function geometriaDeZonas(topologia: Topology, zonas: Zona[]): ColeccionZonas {
  const indice = indexarComunas(topologia);
  const features: ColeccionZonas["features"] = [];

  for (const zona of zonas) {
    const piezas = zona.comunas
      .map((comuna) => indice.get(claveComuna(comuna)))
      .filter((g): g is GeometriaComuna => g !== undefined);
    if (piezas.length === 0) continue;

    const escalon = escalonDeRiesgo(zona.riesgo);
    features.push({
      type: "Feature",
      id: zona.id,
      geometry: merge(topologia, piezas),
      properties: {
        zonaId: zona.id,
        nombre: zona.nombre,
        riesgo: zona.riesgo,
        paso: escalon.paso,
        critico: escalon.paso === 5,
      },
    });
  }

  return { type: "FeatureCollection", features };
}

/**
 * Comunas sueltas, con la zona a la que pertenecen (o `null`). Alimenta el
 * nivel de zoom «comunas» y la capa homónima.
 */
export function geometriaDeComunas(topologia: Topology, zonas: Zona[]): ColeccionComunas {
  const zonaPorComuna = new Map<string, string>();
  for (const zona of zonas) {
    for (const comuna of zona.comunas) zonaPorComuna.set(claveComuna(comuna), zona.id);
  }

  const features: ColeccionComunas["features"] = geometriasDe(topologia).map((geometria) => {
    // `feature()` devuelve `Feature | FeatureCollection` porque acepta también
    // colecciones; aquí siempre se le pasa UNA geometría, así que es un Feature.
    const convertida = feature(topologia, geometria) as Feature<
      Polygon | MultiPolygon,
      PropsComuna
    >;
    const nombre = convertida.properties?.comuna ?? "";
    return {
      type: "Feature",
      id: convertida.properties?.cut,
      geometry: convertida.geometry,
      properties: {
        comuna: nombre,
        cut: convertida.properties?.cut ?? "",
        zonaId: zonaPorComuna.get(claveComuna(nombre)) ?? null,
      },
    };
  });

  return { type: "FeatureCollection", features };
}

/**
 * Producto cruzado del segmento `j→i`. Es el término común del área con signo y
 * del centroide, y por eso está factorizado: las dos fórmulas TIENEN que usar
 * la misma convención de signo. La variante trapezoidal del cordón de zapato
 * —`(xⱼ+xᵢ)(yⱼ−yᵢ)`— da el mismo valor absoluto pero el signo OPUESTO, y
 * mezclarla con el centroide de producto cruzado espeja el resultado respecto
 * del origen: en Santiago, un centroide en (−70,6, −33,4) sale en (70,6, 33,4),
 * o sea en China. Pasó, y solo se vio en pantalla — las placas de zona
 * aparecían proyectadas a decenas de miles de píxeles del lienzo.
 */
function cruz(anillo: Position[], j: number, i: number): number {
  return anillo[j][0] * anillo[i][1] - anillo[i][0] * anillo[j][1];
}

/** Área con signo de un anillo (cordón de zapato, forma de producto cruzado). */
function areaConSigno(anillo: Position[]): number {
  let suma = 0;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i, i += 1) {
    suma += cruz(anillo, j, i);
  }
  return suma / 2;
}

/**
 * Punto donde plantar la placa de la zona.
 *
 * Centroide del anillo exterior MÁS GRANDE, no de la geometría completa. Con
 * multipolígonos —que es lo normal aquí: una zona con un enclave, o una comuna
 * con una isla— el centroide global cae en el vacío entre las piezas, y la
 * placa termina sobre una zona vecina. Tomar la pieza mayor la deja siempre
 * sobre el cuerpo principal de la zona, que es lo que el usuario lee como
 * «aquí».
 */
export function centroideVisual(geometria: Polygon | MultiPolygon): [number, number] {
  const anillos: Position[][] =
    geometria.type === "Polygon"
      ? [geometria.coordinates[0]]
      : geometria.coordinates.map((poligono) => poligono[0]);

  let mejorAnillo: Position[] | null = null;
  let mejorArea = 0;
  for (const anillo of anillos) {
    const area = Math.abs(areaConSigno(anillo));
    if (area > mejorArea) {
      mejorArea = area;
      mejorAnillo = anillo;
    }
  }
  if (!mejorAnillo) return [0, 0];

  const area = areaConSigno(mejorAnillo);
  if (area === 0) {
    // Anillo degenerado: el centro de su caja es lo mejor disponible.
    const lons = mejorAnillo.map((p) => p[0]);
    const lats = mejorAnillo.map((p) => p[1]);
    return [(Math.min(...lons) + Math.max(...lons)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
  }

  let x = 0;
  let y = 0;
  for (let i = 0, j = mejorAnillo.length - 1; i < mejorAnillo.length; j = i, i += 1) {
    const c = cruz(mejorAnillo, j, i);
    x += (mejorAnillo[j][0] + mejorAnillo[i][0]) * c;
    y += (mejorAnillo[j][1] + mejorAnillo[i][1]) * c;
  }
  return [x / (6 * area), y / (6 * area)];
}

/** Radio medio de la Tierra, en metros (esfera WGS84). */
const RADIO_TIERRA_M = 6_371_008.8;

/**
 * Círculo de radio métrico como polígono en coordenadas geográficas.
 *
 * Las capas de lluvia, aire, eventos y marcas operativas se especifican con un
 * radio EN METROS. Dibujarlas con `circle` de MapLibre obligaría a convertir
 * metros a píxeles con una interpolación exponencial sobre el zoom, y aun así
 * el `circle` no acepta ni `fill-pattern` (el punteado que pide el handoff) ni
 * un trazo discontinuo. Como polígono, el radio queda anclado al terreno —que
 * es lo que significa «8 mm/h sobre este radio»— y las capas `fill`/`line`
 * dan patrón y `dasharray` gratis.
 */
export function circuloGeodesico(
  centro: { lat: number; long: number },
  radioMetros: number,
  pasos = 72,
): Polygon {
  const latRad = (centro.lat * Math.PI) / 180;
  const dLat = ((radioMetros / RADIO_TIERRA_M) * 180) / Math.PI;
  const dLon = dLat / Math.max(Math.cos(latRad), 1e-6);

  const anillo: Position[] = [];
  for (let i = 0; i <= pasos; i += 1) {
    const angulo = (i / pasos) * 2 * Math.PI;
    anillo.push([centro.long + dLon * Math.cos(angulo), centro.lat + dLat * Math.sin(angulo)]);
  }
  return { type: "Polygon", coordinates: [anillo] };
}

/** Caja envolvente `[oeste, sur, este, norte]`, o `null` si no hay geometría. */
export function cajaEnvolvente(
  coleccion: ColeccionZonas | ColeccionComunas,
): [number, number, number, number] | null {
  let oeste = Infinity;
  let sur = Infinity;
  let este = -Infinity;
  let norte = -Infinity;

  const recorrer = (posiciones: Position[]) => {
    for (const [lon, lat] of posiciones) {
      if (lon < oeste) oeste = lon;
      if (lon > este) este = lon;
      if (lat < sur) sur = lat;
      if (lat > norte) norte = lat;
    }
  };

  for (const f of coleccion.features) {
    const poligonos =
      f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poligono of poligonos) for (const anillo of poligono) recorrer(anillo);
  }

  return Number.isFinite(oeste) ? [oeste, sur, este, norte] : null;
}
