/**
 * Estilo del mapa — basemap acromático mínimo + capas del módulo.
 * ===========================================================================
 *
 * EL BASEMAP NO ES EL MAPA. Aquí el plano urbano tiene un solo trabajo:
 * que el coordinador reconozca en un vistazo dónde está mirando. Tres cosas
 * bastan para eso —el río y las lagunas, las grandes áreas verdes y los ejes
 * estructurantes— y todo lo demás compite con el dato que sí importa. Por eso
 * NO hay etiquetas de lugar, ni edificios, ni relieve, ni límites de OSM, ni
 * color: los tres elementos van en grises de contraste muy bajo sobre Papel.
 *
 * Consecuencia práctica de no tener una sola capa `symbol` con texto: el
 * estilo no necesita `glyphs`, así que no hay PBFs de fuente que publicar ni
 * mantener. Todo el texto del mapa vive en la capa HTML, exactamente como
 * manda el handoff («SVG solo geometría, HTML todo el texto» — aquí, «vector
 * solo geometría»).
 *
 * ORDEN DE PINTADO (de abajo a arriba):
 *   Papel → agua → áreas verdes → ejes → relleno de zona (trama de riesgo) →
 *   borde de zona → comunas → capas activas → marcas operativas.
 * Las capas activas van SOBRE el riesgo a propósito: son el evento que
 * explica la trama, no un fondo.
 */

// Los tipos del estilo NO los reexporta `maplibre-gl` (solo exporta runtime):
// viven en el paquete de la especificación, declarado como devDependency
// porque estos imports son de tipo y se borran al compilar.
//
// ⚠️ Su versión tiene que seguir a la de `maplibre-gl`, no ir por libre: es el
// contrato del runtime que la valida. Hoy maplibre-gl 5.24 pide
// `@maplibre/maplibre-gl-style-spec ^24.8.1`, y eso es lo que hay declarado.
import type {
  StyleSpecification,
  LayerSpecification,
  GeoJSONSourceSpecification,
} from "@maplibre/maplibre-gl-style-spec";
import { ESCALA_RIESGO } from "../riesgo";
import { ID_TRAMA_PUNTOS, idTrama } from "./tramas";

/** Grises del plano. Contraste bajísimo contra Papel #f3f2f2, a propósito. */
const AGUA = "#e3e1e1";
const VERDE = "#eceaea";
const EJE = "#dedbdb";
const PAPEL = "#f3f2f2";
const TINTA = "#201e1d";
const SENAL = "#ec3013";
/** Gris medio del lenguaje visual de la Torre, para lo ya resuelto. */
const INK_500 = "#8a8785";

/** Kinds de `landuse` que cuentan como área verde. */
const KINDS_VERDES = [
  "park",
  "forest",
  "wood",
  "nature_reserve",
  "protected_area",
  "grass",
  "garden",
  "golf_course",
  "recreation_ground",
  "cemetery",
  "scrub",
  "zoo",
];

/** Kinds de `roads` que cuentan como eje estructurante. */
const KINDS_EJES = ["highway", "major_road"];

export const IDS_FUENTES = {
  basemap: "basemap",
  zonas: "tc-zonas",
  comunas: "tc-comunas",
  clima: "tc-clima",
  aire: "tc-aire",
  conductores: "tc-conductores",
  pedidos: "tc-pedidos",
  marcas: "tc-marcas",
} as const;

/** Capas que el control de capas enciende y apaga, por id de `CapaMapa`. */
export const CAPAS_POR_ID: Record<string, string[]> = {
  riesgo: ["zonas-relleno", "zonas-borde"],
  clima: ["clima-relleno", "clima-borde"],
  aire: ["aire-relleno", "aire-borde"],
  conductores: ["conductores-punto", "conductores-sin-senal"],
  // Dos capas: los abiertos llenos, los cerrados en contorno. Ninguna dibuja
  // TEXTO — la dirección del destinatario no va en el mapa (ver `PedidoEnMapa`).
  pedidos: ["pedidos-abiertos", "pedidos-cerrados"],
  comunas: ["comunas-borde"],
};

/** Fuente GeoJSON vacía: los datos llegan luego con `setData()`. */
function fuenteVacia(): GeoJSONSourceSpecification {
  return { type: "geojson", data: { type: "FeatureCollection", features: [] } };
}

/** Capas del basemap. Vacío si el PMTiles no está publicado. */
function capasBasemap(hayBasemap: boolean): LayerSpecification[] {
  if (!hayBasemap) return [];
  return [
    {
      id: "base-agua",
      type: "fill",
      source: IDS_FUENTES.basemap,
      "source-layer": "water",
      paint: { "fill-color": AGUA },
    },
    {
      id: "base-verde",
      type: "fill",
      source: IDS_FUENTES.basemap,
      "source-layer": "landuse",
      filter: ["in", ["get", "kind"], ["literal", KINDS_VERDES]],
      paint: { "fill-color": VERDE },
    },
    {
      id: "base-ejes",
      type: "line",
      source: IDS_FUENTES.basemap,
      "source-layer": "roads",
      filter: ["in", ["get", "kind"], ["literal", KINDS_EJES]],
      paint: {
        "line-color": EJE,
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.4, 11, 0.8, 14, 1.6, 16, 2.4],
      },
    },
  ];
}

/**
 * `fill-pattern` según el paso de riesgo de la feature. Se construye desde
 * `ESCALA_RIESGO` para que añadir o mover un escalón no exija tocar el estilo.
 */
function expresionTrama(): unknown[] {
  const casos: unknown[] = ["match", ["get", "paso"]];
  for (const escalon of ESCALA_RIESGO) casos.push(escalon.paso, idTrama(escalon.paso));
  casos.push(idTrama(1)); // por defecto: calmo
  return casos;
}

export interface OpcionesEstilo {
  urlBasemap: string | null;
  /**
   * `true` cuando el courier no ha configurado zonas: el handoff pide relleno
   * plano y trazo discontinuo sobre las 5 macro-zonas de la RM, para que se lea
   * como un ejemplo y no como su operación.
   */
  sinZonas: boolean;
}

export function construirEstilo({ urlBasemap, sinZonas }: OpcionesEstilo): StyleSpecification {
  const hayBasemap = urlBasemap !== null;

  const estilo: StyleSpecification = {
    version: 8,
    // Sin `glyphs` ni `sprite`: el estilo no tiene una sola capa de texto y las
    // imágenes (tramas, punteado, rombo) se registran en caliente con addImage.
    sources: {
      ...(hayBasemap
        ? {
            [IDS_FUENTES.basemap]: {
              type: "vector",
              url: `pmtiles://${urlBasemap}`,
              attribution: "© OpenStreetMap",
            },
          }
        : {}),
      [IDS_FUENTES.zonas]: fuenteVacia(),
      [IDS_FUENTES.comunas]: fuenteVacia(),
      [IDS_FUENTES.clima]: fuenteVacia(),
      [IDS_FUENTES.aire]: fuenteVacia(),
      [IDS_FUENTES.conductores]: fuenteVacia(),
      [IDS_FUENTES.pedidos]: fuenteVacia(),
      [IDS_FUENTES.marcas]: fuenteVacia(),
    },
    layers: [
      { id: "fondo", type: "background", paint: { "background-color": PAPEL } },
      ...capasBasemap(hayBasemap),

      // --- Riesgo -----------------------------------------------------------
      // La trama es OPACA (lleva su propio fondo), así que el relleno baja a
      // 0.86: lo justo para que los ejes del plano se adivinen bajo la zona sin
      // que la densidad de la trama —el canal primario del riesgo— se lave. Con
      // relleno opaco el basemap no se vería justo donde más se necesita, que es
      // dentro de la zona; sin trama, el riesgo dejaría de leerse.
      // Con una zona seleccionada las demás caen a 0.18 (README §4).
      {
        id: "zonas-relleno",
        type: "fill",
        source: IDS_FUENTES.zonas,
        paint: {
          ...(sinZonas
            ? { "fill-color": "#eae7e7" }
            : { "fill-pattern": expresionTrama() as never }),
          "fill-opacity": [
            "case",
            ["boolean", ["feature-state", "atenuada"], false],
            0.18,
            sinZonas ? 1 : 0.86,
          ],
        },
      },
      {
        id: "zonas-borde",
        type: "line",
        source: IDS_FUENTES.zonas,
        paint: sinZonas
          ? { "line-color": TINTA, "line-width": 1, "line-dasharray": [7, 5] }
          : {
              "line-color": [
                "case",
                ["boolean", ["feature-state", "seleccionada"], false],
                TINTA,
                ["boolean", ["get", "critico"], false],
                SENAL,
                "rgba(32,30,29,0.5)",
              ],
              "line-width": [
                "case",
                ["boolean", ["feature-state", "seleccionada"], false],
                3,
                ["boolean", ["get", "critico"], false],
                2,
                1,
              ],
              "line-opacity": [
                "case",
                ["boolean", ["feature-state", "atenuada"], false],
                0.3,
                1,
              ],
            },
      },

      // --- Comunas (nivel de zoom «comunas» y capa homónima) -----------------
      {
        id: "comunas-borde",
        type: "line",
        source: IDS_FUENTES.comunas,
        layout: { visibility: "none" },
        paint: { "line-color": "rgba(32,30,29,0.28)", "line-width": 0.8 },
      },

      // --- Lluvia -----------------------------------------------------------
      {
        id: "clima-relleno",
        type: "fill",
        source: IDS_FUENTES.clima,
        layout: { visibility: "none" },
        paint: { "fill-pattern": ID_TRAMA_PUNTOS },
      },
      {
        id: "clima-borde",
        type: "line",
        source: IDS_FUENTES.clima,
        layout: { visibility: "none" },
        paint: { "line-color": TINTA, "line-width": 2, "line-dasharray": [4.5, 3] },
      },

      // --- Aire -------------------------------------------------------------
      {
        id: "aire-relleno",
        type: "fill",
        source: IDS_FUENTES.aire,
        layout: { visibility: "none" },
        paint: { "fill-pattern": ID_TRAMA_PUNTOS },
      },
      {
        id: "aire-borde",
        type: "line",
        source: IDS_FUENTES.aire,
        layout: { visibility: "none" },
        paint: { "line-color": TINTA, "line-width": 2, "line-dasharray": [4.5, 3] },
      },

      // --- Pedidos (nivel 3) --------------------------------------------------
      // Punto pequeño y sin etiqueta: son cientos, y el dato personal se queda
      // fuera del mapa a propósito.
      {
        id: "pedidos-cerrados",
        type: "circle",
        source: IDS_FUENTES.pedidos,
        layout: { visibility: "none" },
        filter: ["==", ["get", "cerrado"], true],
        paint: {
          "circle-radius": 2.5,
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-width": 1,
          "circle-stroke-color": INK_500,
        },
      },
      {
        id: "pedidos-abiertos",
        type: "circle",
        source: IDS_FUENTES.pedidos,
        layout: { visibility: "none" },
        filter: ["!=", ["get", "cerrado"], true],
        paint: {
          "circle-radius": 3,
          "circle-color": TINTA,
          "circle-stroke-width": 0.75,
          "circle-stroke-color": PAPEL,
        },
      },

      // --- Conductores ------------------------------------------------------
      {
        id: "conductores-punto",
        type: "circle",
        source: IDS_FUENTES.conductores,
        layout: { visibility: "none" },
        filter: ["!=", ["get", "estado"], "sin_senal"],
        paint: {
          "circle-radius": 6,
          "circle-color": TINTA,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": PAPEL,
        },
      },
      {
        id: "conductores-sin-senal",
        type: "circle",
        source: IDS_FUENTES.conductores,
        layout: { visibility: "none" },
        filter: ["==", ["get", "estado"], "sin_senal"],
        paint: {
          "circle-radius": 5,
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-width": 1.5,
          "circle-stroke-color": TINTA,
        },
      },

      // --- Marcas operativas ------------------------------------------------
      // NUNCA se apagan y no cuentan contra el tope de 2 capas: son una
      // anotación del usuario, no una fuente de datos (README §4).
      {
        id: "marcas-radio",
        type: "line",
        source: IDS_FUENTES.marcas,
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "line-color": TINTA, "line-width": 1.5, "line-dasharray": [2, 2] },
      },
      {
        id: "marcas-punto",
        type: "circle",
        source: IDS_FUENTES.marcas,
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": 4,
          "circle-color": [
            "case",
            ["boolean", ["get", "provisional"], false],
            "rgba(0,0,0,0)",
            TINTA,
          ],
          "circle-stroke-width": 2,
          "circle-stroke-color": TINTA,
        },
      },
    ],
  };

  return estilo;
}
