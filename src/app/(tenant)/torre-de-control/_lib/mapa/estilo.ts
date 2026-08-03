/**
 * Estilo del mapa de la Torre v2 — plano urbano con nombre propio.
 * =============================================================================
 *
 * **QUÉ CAMBIÓ RESPECTO DE LA v1, Y POR QUÉ.** La v1 declaraba que «el basemap
 * no es el mapa»: plano acromático, tres capas, y **ni una sola etiqueta**. Era
 * coherente con una consola de riesgo por zona, donde el plano solo tenía que
 * decir «esto es Santiago». La v2 hace zoom hasta el pedido individual y **no
 * muestra la dirección** (muestra el código de envío, `alcance-v2.md` §F3), así
 * que la calle de abajo es lo único que ubica el punto. Sin nombres de calle, el
 * nivel 3 del zoom no sirve para nada.
 *
 * De ahí las tres decisiones de este archivo:
 *   1. **Etiquetas encendidas**, en tres escalones: comuna/barrio, eje
 *      estructurante y calle local. Exige `glyphs`, que la v1 no necesitaba.
 *   2. **Jerarquía vial de cuatro anchos.** Es la mitad de lo que hace que un
 *      plano se lea «fino» al estilo Uber/Rappi: no es color, es que una
 *      autopista y un pasaje no se dibujen igual.
 *   3. **Dos temas sobre las MISMAS tiles.** Es un segundo objeto de estilo, no
 *      un segundo basemap: el archivo PMTiles no se duplica.
 *
 * Colores y umbrales de zoom: `paleta.ts`. Fuentes de datos: `config.ts`.
 * Decisión de producto y wireframes: `docs/torre-de-control/lenguaje-visual-v2.md`.
 *
 * -----------------------------------------------------------------------------
 * ORDEN DE PINTADO (de abajo a arriba) — es parte del diseño, no del azar
 * -----------------------------------------------------------------------------
 *   tierra → suelo (verde, equipamiento) → agua → edificios → vías (borde y
 *   relleno, de menor a mayor) → límites → etiquetas del plano →
 *   ‖ dato operativo ‖ → velo → carga por comuna → borde de comuna →
 *   agrupaciones → puntos (entregado, pendiente, en ruta, corte, INCIDENCIA) →
 *   `+N` de agrupados.
 *
 * La incidencia es la última MARCA que se pinta: es lo único accionable de la
 * pantalla y no puede quedar tapada por un punto entregado. Encima solo va el
 * `+N`, que es texto sobre el propio punto — una etiqueta rotula, no tapa. Sin
 * glifos ese `+N` no existe y lo sustituye un anillo, que va por DEBAJO de los
 * puntos justamente para no romper esta regla (ver `capasDatos`).
 */

// Los tipos del estilo NO los reexporta `maplibre-gl` (solo exporta runtime):
// viven en el paquete de la especificación, declarado como devDependency porque
// estos imports son de tipo y se borran al compilar.
//
// ⚠️ Su versión sigue a la de `maplibre-gl`, no va por libre: es el contrato del
// runtime que la valida. `maplibre-gl` está clavado en 5.24.0 EXACTO — la 6.x
// carga su Web Worker como archivo suelto y Turbopack no resuelve ese patrón
// dentro de `node_modules`; falla mudo, con el lienzo en blanco y la consola
// limpia.
import type { LayerSpecification, StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { paletaDe, type PaletaMapa, type TemaMapa } from './paleta';

// =============================================================================
// Identificadores — el contrato con la pantalla
// =============================================================================

export const IDS_FUENTES = {
  /** El PMTiles de la RM (esquema Protomaps v4). */
  basemap: 'basemap',
  /** Polígonos comunales DPA 2023, con la carga del día en sus propiedades. */
  comunas: 'tc-comunas',
  /** Agrupaciones del nivel 2. */
  agrupaciones: 'tc-agrupaciones',
  /**
   * Pedidos individuales del nivel 3.
   *
   * ⚠️ **Los pedidos se quedan acá y no se promueven a anclas HTML, nunca.**
   * Está medido (`docs/arquitectura/mapa-torre-v2.md` §2): 600 anclas HTML
   * cuestan 31,77 ms/frame (≈31 fps); por la fuente GeoJSON los dibuja la GPU y
   * el costo desaparece. La capa HTML es solo para las ~32 placas de comuna.
   */
  puntos: 'tc-puntos',
} as const;

export const IDS_CAPAS = {
  velo: 'tc-velo',
  comunaCarga: 'tc-comuna-carga',
  comunaBorde: 'tc-comuna-borde',
  comunaBordeActiva: 'tc-comuna-borde-activa',
  agrupacionBurbuja: 'tc-agrupacion-burbuja',
  agrupacionCifra: 'tc-agrupacion-cifra',
  /** Sombra difusa bajo los puntos que todavía cuentan. Ver `capasDatos`. */
  puntoSombra: 'tc-punto-sombra',
  puntoEntregado: 'tc-punto-entregado',
  puntoPendiente: 'tc-punto-pendiente',
  puntoEnRuta: 'tc-punto-en-ruta',
  puntoCorte: 'tc-punto-corte',
  puntoIncidencia: 'tc-punto-incidencia',
  puntoAgrupado: 'tc-punto-agrupado',
  /** Sustituto del `+N` cuando no hay glifos. Ver `capasDatos`. */
  puntoAgrupadoAnillo: 'tc-punto-agrupado-anillo',
} as const;

/** Pesos de Noto Sans publicados junto al basemap. Ver `config.ts`. */
const FUENTE_REGULAR = ['Noto Sans Regular'];
const FUENTE_MEDIA = ['Noto Sans Medium'];

/** `kind` de `landuse` que se pintan como área verde. */
const KINDS_VERDES = [
  'park',
  'forest',
  'wood',
  'nature_reserve',
  'protected_area',
  'grass',
  'garden',
  'golf_course',
  'recreation_ground',
  'village_green',
  'cemetery',
  'zoo',
];

/** `kind` de `landuse` que se pintan como suelo institucional. */
const KINDS_EQUIPAMIENTO = ['hospital', 'university', 'college', 'school', 'aerodrome', 'military'];

// =============================================================================
// Basemap
// =============================================================================

/**
 * Construye el estilo completo del mapa para un tema.
 *
 * @param tema        Sigue al tema del producto (`next-themes`); el mapa no
 *                    tiene conmutador propio.
 * @param urlBasemap  URL del PMTiles, o `null` para el modo degradado.
 * @param urlGlifos   Base de los glifos, o `null` para un plano sin etiquetas.
 */
export function construirEstiloBase({
  tema,
  urlBasemap,
  urlGlifos,
}: {
  tema: TemaMapa;
  urlBasemap: string | null;
  urlGlifos: string | null;
}): StyleSpecification {
  const paleta = paletaDe(tema);
  const conEtiquetas = urlGlifos !== null;

  const estilo: StyleSpecification = {
    version: 8,
    // Sin `sprite`: no hay un solo icono en el mapa. Los estados van por forma y
    // color de círculo, y el `+N` es texto. Eso ahorra un pipeline entero de
    // build y una petición más en la primera carga.
    ...(conEtiquetas ? { glyphs: `${urlGlifos}/{fontstack}/{range}.pbf` } : {}),
    sources: {},
    layers: [
      // El fondo se pinta SIEMPRE, aunque no haya basemap: es lo que hace que el
      // modo degradado se vea deliberado y no roto.
      {
        id: 'tc-fondo',
        type: 'background',
        paint: { 'background-color': paleta.basemap.tierra },
      },
    ],
  };

  if (urlBasemap) {
    estilo.sources[IDS_FUENTES.basemap] = {
      type: 'vector',
      url: `pmtiles://${urlBasemap}`,
      // El recorte llega hasta z13; de ahí para arriba MapLibre sobre-escala los
      // tiles de z13. Sin esto el plano DESAPARECE al pasar de z13, que es justo
      // el nivel del punto de entrega.
      maxzoom: 13,
      attribution: '© OpenStreetMap',
    };
    estilo.layers.push(...capasBasemap(paleta, conEtiquetas));
  }

  return estilo;
}

function capasBasemap(paleta: PaletaMapa, conEtiquetas: boolean): LayerSpecification[] {
  const c = paleta.basemap;
  const fuente = IDS_FUENTES.basemap;

  const capas: LayerSpecification[] = [
    {
      id: 'bm-tierra',
      type: 'fill',
      source: fuente,
      'source-layer': 'earth',
      paint: { 'fill-color': c.tierra },
    },
    {
      id: 'bm-verde',
      type: 'fill',
      source: fuente,
      'source-layer': 'landuse',
      filter: ['in', ['get', 'kind'], ['literal', KINDS_VERDES]],
      paint: { 'fill-color': c.verde },
    },
    {
      id: 'bm-equipamiento',
      type: 'fill',
      source: fuente,
      'source-layer': 'landuse',
      filter: ['in', ['get', 'kind'], ['literal', KINDS_EQUIPAMIENTO]],
      paint: { 'fill-color': c.equipamiento },
    },
    {
      id: 'bm-agua',
      type: 'fill',
      source: fuente,
      'source-layer': 'water',
      paint: { 'fill-color': c.agua },
    },
    {
      // Los edificios entran tarde y a media opacidad: dan textura de ciudad al
      // llegar al punto de entrega, pero a z14 en adelante — antes son ruido que
      // compite con los pedidos.
      id: 'bm-edificios',
      type: 'fill',
      source: fuente,
      'source-layer': 'buildings',
      minzoom: 14,
      paint: {
        'fill-color': c.edificio,
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.5, 0.9],
      },
    },
  ];

  // --- Vías: primero todos los bordes, después todos los rellenos. ---------
  // Pintar borde+relleno vía por vía deja costuras en cada cruce: el borde de la
  // calle de arriba se dibuja encima del relleno de la de abajo. Por eso van en
  // dos pasadas completas, que es como se dibuja una red vial.
  capas.push(
    {
      id: 'bm-via-borde-mayor',
      type: 'line',
      source: fuente,
      'source-layer': 'roads',
      filter: ['in', ['get', 'kind'], ['literal', ['highway', 'major_road']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': c.viaBorde,
        'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 8, 1.4, 12, 4.5, 16, 16],
      },
    },
    {
      id: 'bm-via-borde-media',
      type: 'line',
      source: fuente,
      'source-layer': 'roads',
      filter: ['==', ['get', 'kind'], 'medium_road'],
      minzoom: 11,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': c.viaBorde,
        'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 11, 1.2, 14, 4, 17, 12],
      },
    },
    {
      id: 'bm-via-local',
      type: 'line',
      source: fuente,
      'source-layer': 'roads',
      filter: ['==', ['get', 'kind'], 'minor_road'],
      minzoom: 12.5,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': c.viaLocal,
        'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 12.5, 0.6, 15, 3, 17, 9],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 12.5, 0, 13.5, 1],
      },
    },
    {
      id: 'bm-via-secundaria',
      type: 'line',
      source: fuente,
      'source-layer': 'roads',
      filter: ['==', ['get', 'kind'], 'medium_road'],
      minzoom: 11,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': c.viaSecundaria,
        'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 11, 0.6, 14, 2.6, 17, 9],
      },
    },
    {
      id: 'bm-via-troncal',
      type: 'line',
      source: fuente,
      'source-layer': 'roads',
      filter: ['==', ['get', 'kind'], 'major_road'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': c.viaTroncal,
        'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 8, 0.7, 12, 3, 16, 12],
      },
    },
    {
      id: 'bm-via-autopista',
      type: 'line',
      source: fuente,
      'source-layer': 'roads',
      filter: ['==', ['get', 'kind'], 'highway'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': c.viaAutopista,
        'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 8, 1, 12, 3.6, 16, 13],
      },
    },
    {
      id: 'bm-ferrocarril',
      type: 'line',
      source: fuente,
      'source-layer': 'roads',
      filter: ['==', ['get', 'kind'], 'rail'],
      minzoom: 11,
      paint: {
        'line-color': c.ferrocarril,
        'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.5, 16, 1.6],
        'line-dasharray': [3, 2],
      },
    },
    {
      // Solo país y región: el límite COMUNAL lo dibuja el módulo con la DPA
      // 2023, que es la geometría oficial y la que empareja con los datos. Dos
      // trazos distintos para el mismo límite se ven como un error de registro.
      id: 'bm-limites',
      type: 'line',
      source: fuente,
      'source-layer': 'boundaries',
      filter: ['in', ['get', 'kind'], ['literal', ['country', 'region']]],
      paint: {
        'line-color': c.viaBorde,
        'line-width': 1,
        'line-dasharray': [4, 2],
      },
    },
  );

  if (!conEtiquetas) return capas;

  // --- Etiquetas: los tres escalones ---------------------------------------
  capas.push(
    {
      // Escalón 3 (calle local): aparece a z13.6, que es exactamente donde el
      // zoom semántico abre los pedidos individuales. No es coincidencia: el
      // nombre de calle es lo que ubica un punto que no muestra su dirección.
      id: 'bm-etq-via-local',
      type: 'symbol',
      source: fuente,
      'source-layer': 'roads',
      minzoom: 13.6,
      filter: ['all', ['has', 'name'], ['==', ['get', 'kind'], 'minor_road']],
      layout: {
        'symbol-placement': 'line',
        'text-field': ['get', 'name'],
        'text-font': FUENTE_REGULAR,
        'text-size': ['interpolate', ['linear'], ['zoom'], 13.6, 9.5, 17, 12],
        'text-letter-spacing': 0.02,
        'text-max-angle': 40,
        'symbol-spacing': 260,
      },
      paint: {
        'text-color': c.textoVia,
        'text-halo-color': c.halo,
        'text-halo-width': 1.2,
      },
    },
    {
      // Escalón 2 (ejes estructurantes): desde z12, cuando ya se está dentro de
      // una comuna y hace falta saber por qué avenida se llega.
      id: 'bm-etq-via-mayor',
      type: 'symbol',
      source: fuente,
      'source-layer': 'roads',
      minzoom: 12,
      filter: [
        'all',
        ['has', 'name'],
        ['in', ['get', 'kind'], ['literal', ['highway', 'major_road', 'medium_road']]],
      ],
      layout: {
        'symbol-placement': 'line',
        'text-field': ['get', 'name'],
        'text-font': FUENTE_MEDIA,
        'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10, 17, 13],
        'text-letter-spacing': 0.02,
        'text-max-angle': 40,
        'symbol-spacing': 320,
      },
      paint: {
        'text-color': c.textoVia,
        'text-halo-color': c.halo,
        'text-halo-width': 1.4,
      },
    },
    {
      id: 'bm-etq-agua',
      type: 'symbol',
      source: fuente,
      'source-layer': 'water',
      minzoom: 11,
      filter: ['has', 'name'],
      layout: {
        'symbol-placement': 'line',
        'text-field': ['get', 'name'],
        'text-font': FUENTE_REGULAR,
        'text-size': 11,
        'text-letter-spacing': 0.08,
        'symbol-spacing': 400,
      },
      paint: {
        'text-color': c.textoAgua,
        'text-halo-color': c.halo,
        'text-halo-width': 1,
      },
    },
    {
      // Escalón 1 (lugar): barrios y localidades. **Arranca en z11, no antes**,
      // porque bajo ese zoom la comuna la nombra la PLACA del módulo con su
      // fracción — y dos textos para lo mismo, uno del plano y otro del dato, es
      // exactamente el ruido que la regla 1 del alcance prohíbe.
      id: 'bm-etq-lugar',
      type: 'symbol',
      source: fuente,
      'source-layer': 'places',
      minzoom: 11,
      filter: [
        'all',
        ['has', 'name'],
        ['in', ['get', 'kind'], ['literal', ['locality', 'borough', 'macrohood', 'neighbourhood']]],
        // Protomaps trae `min_zoom` por feature: es su propia jerarquía de
        // importancia. Respetarla evita tener que inventar una peor.
        ['>=', ['zoom'], ['get', 'min_zoom']],
      ],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': FUENTE_MEDIA,
        'text-size': ['interpolate', ['linear'], ['zoom'], 11, 11, 16, 14],
        'text-letter-spacing': 0.01,
        'text-max-width': 8,
        'text-padding': 6,
      },
      paint: {
        'text-color': c.textoLugar,
        'text-halo-color': c.halo,
        'text-halo-width': 1.6,
      },
    },
  );

  return capas;
}

// =============================================================================
// Capas de dato operativo
// =============================================================================

/**
 * Las capas del dato, que van SOBRE el plano.
 *
 * Se devuelven aparte del basemap porque su ciclo de vida es otro: el estilo
 * base se reconstruye al cambiar de tema, y estas se actualizan cada vez que
 * llega dato nuevo (F5, realtime). Vía C las añade con `map.addLayer()` sobre
 * fuentes GeoJSON que alimenta desde `EstadoTorre`.
 *
 * Propiedades que cada fuente tiene que traer:
 * - `comunas`: `paso` (0–3, el escalón de la rampa de carga), `activa` (bool).
 * - `agrupaciones`: `cantidad`.
 * - `puntos`: `estado` (`EstadoPunto`), `cercaDelCorte` (bool), `agrupados`.
 *
 * `conEtiquetas` es la MISMA condición que gobierna el plano: si no hay glifos
 * publicados, no puede haber una sola capa `symbol`. Un `text-font` sin glifos
 * no degrada solo — MapLibre descarta la capa entera y lo dice una vez por
 * tesela. El estilo base ya lo respetaba; estas capas no, y por eso se pasa.
 *
 * Sin etiquetas se pierden dos cifras, y NO pesan igual:
 * - La de la burbuja (nivel 2) se puede perder: su radio ya codifica el
 *   volumen, así que la magnitud sigue leyéndose, solo que sin precisión.
 * - El `+N` del punto (nivel 3) NO se puede perder: el radio del punto depende
 *   solo del zoom, así que un edificio con seis entregas quedaría idéntico a
 *   uno con una. Eso es el mapa escondiendo carga, que es exactamente lo que
 *   prohíbe la regla 5 del alcance. Por eso, sin glifos, el `+N` se sustituye
 *   por un anillo — se pierde el número, no el hecho de que ahí hay varios.
 *
 * `conEtiquetas` va SIN valor por defecto a propósito. Un default obligaría a
 * acordarse de pasarlo, y olvidarlo falla mudo: la capa se descarta sola y la
 * consola no dice nada útil. Sin default, olvidarlo no compila. Pásale el mismo
 * `urlGlifos !== null` que le pasas a `construirEstiloBase`.
 */
export function capasDatos(tema: TemaMapa, conEtiquetas: boolean): LayerSpecification[] {
  const d = paletaDe(tema).datos;
  const comunas = IDS_FUENTES.comunas;
  const agrupaciones = IDS_FUENTES.agrupaciones;
  const puntos = IDS_FUENTES.puntos;

  /**
   * El anillo que sustituye al `+N` cuando no hay glifos. Va DEBAJO de los
   * puntos —no encima— por dos razones: el punto le tapa el centro y lo deja
   * como anillo sin dibujar un contorno aparte, y así la incidencia sigue
   * siendo la última marca que se pinta.
   */
  const anilloAgrupado: LayerSpecification = {
    id: IDS_CAPAS.puntoAgrupadoAnillo,
    type: 'circle',
    source: puntos,
    filter: ['>', ['get', 'agrupados'], 1],
    paint: {
      'circle-color': 'transparent',
      // Por encima del radio de cualquier punto (el mayor es el del corte, 6,5
      // a 10), para que asome siempre.
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 8, 17, 13],
      'circle-stroke-color': d.agrupacionBorde,
      'circle-stroke-width': 1.2,
      'circle-stroke-opacity': 0.75,
    },
  };

  return [
    {
      // Velo sobre las comunas que NO son la activa. Es el escalón visual entre
      // el nivel 1 y el 2: entrar en una comuna no cambia de pantalla, apaga el
      // resto de la ciudad.
      id: IDS_CAPAS.velo,
      type: 'fill',
      source: comunas,
      filter: ['!', ['get', 'activa']],
      paint: {
        'fill-color': d.velo,
        // A 0 mientras no hay comuna activa: la capa existe siempre y solo se
        // enciende por opacidad, así no hay que agregar y quitar capas en vivo.
        'fill-opacity': 0,
      },
    },
    {
      id: IDS_CAPAS.comunaCarga,
      type: 'fill',
      source: comunas,
      paint: {
        // Cuatro pasos de un solo tono. Es intensidad de una MAGNITUD (cuántos
        // faltan), no una escala semántica: no hay leyenda que aprender, y la
        // fracción exacta va siempre en la placa.
        'fill-color': [
          'match',
          ['get', 'paso'],
          0,
          d.cargaComuna[0],
          1,
          d.cargaComuna[1],
          2,
          d.cargaComuna[2],
          d.cargaComuna[3],
        ],
      },
    },
    {
      id: IDS_CAPAS.comunaBorde,
      type: 'line',
      source: comunas,
      paint: { 'line-color': d.comunaBorde, 'line-width': 1 },
    },
    {
      id: IDS_CAPAS.comunaBordeActiva,
      type: 'line',
      source: comunas,
      filter: ['get', 'activa'],
      paint: { 'line-color': d.comunaBordeActiva, 'line-width': 2 },
    },
    {
      id: IDS_CAPAS.agrupacionBurbuja,
      type: 'circle',
      source: agrupaciones,
      paint: {
        'circle-color': d.agrupacionRelleno,
        'circle-stroke-color': d.agrupacionBorde,
        'circle-stroke-width': 1.5,
        'circle-radius': ['interpolate', ['linear'], ['get', 'cantidad'], 1, 13, 25, 20, 120, 28],
      },
    },
    // La cifra de la burbuja solo si hay glifos. Se puede perder: el radio de
    // la burbuja ya codifica el volumen.
    ...(conEtiquetas
      ? ([
          {
            id: IDS_CAPAS.agrupacionCifra,
            type: 'symbol',
            source: agrupaciones,
            layout: {
              'text-field': ['to-string', ['get', 'cantidad']],
              'text-font': FUENTE_MEDIA,
              'text-size': 12,
              'text-allow-overlap': true,
            },
            paint: { 'text-color': d.agrupacionTexto },
          },
        ] satisfies LayerSpecification[])
      : [anilloAgrupado]),
    {
      /**
       * Sombra difusa bajo el punto. Una sola capa compartida por todos los
       * estados, debajo de todos ellos.
       *
       * Es lo que separa un punto **pegado** encima del plano de uno **asentado**
       * sobre él, y es la misma idea que las sombras del sistema (`--shadow-*`):
       * luz desde arriba, así que la sombra se desplaza 1,5 px hacia abajo.
       *
       * ⚠️ **El entregado queda fuera del filtro a propósito.** Sin sombra se
       * hunde en el plano, y eso refuerza «se apaga, no se borra» sin gastar un
       * color nuevo: lo que ya no cuenta deja de tener volumen.
       */
      id: IDS_CAPAS.puntoSombra,
      type: 'circle',
      source: puntos,
      filter: ['!=', ['get', 'estado'], 'entregado'],
      paint: {
        'circle-color': d.puntoSombra,
        // Poco más que el núcleo que sombrea (~1,2 px), nunca más: una sombra
        // más grande que el objeto deja de leerse como sombra y pasa a glow.
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          13,
          ['match', ['get', 'estado'], 'incidencia', 6.2, 4.8],
          17,
          ['match', ['get', 'estado'], 'incidencia', 9.4, 7.2],
        ],
        'circle-blur': 0.9,
        'circle-translate': [0, 1.5],
      },
    },
    {
      // Los entregados no se borran: se apagan. Ver el contador bajar es la
      // pantalla entera; si lo entregado desapareciera, el mapa se vaciaría y no
      // se distinguiría un día cerrado de un día sin pedidos.
      id: IDS_CAPAS.puntoEntregado,
      type: 'circle',
      source: puntos,
      filter: ['==', ['get', 'estado'], 'entregado'],
      paint: {
        'circle-color': d.puntoEntregado,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 2.5, 17, 4.5],
        'circle-opacity': 0.75,
      },
    },
    {
      id: IDS_CAPAS.puntoPendiente,
      type: 'circle',
      source: puntos,
      filter: ['==', ['get', 'estado'], 'pendiente'],
      paint: {
        'circle-color': d.puntoPendiente,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 3.5, 17, 6],
        // 1,6 y no 1,2: con la sombra debajo, un halo delgado deja el punto
        // apoyado sobre su propia sombra en vez de recortado del plano.
        'circle-stroke-color': d.puntoHalo,
        'circle-stroke-width': 1.6,
      },
    },
    {
      id: IDS_CAPAS.puntoEnRuta,
      type: 'circle',
      source: puntos,
      filter: ['==', ['get', 'estado'], 'en_ruta'],
      paint: {
        'circle-color': d.puntoHalo,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 3.5, 17, 6],
        'circle-stroke-color': d.puntoEnRuta,
        'circle-stroke-width': 2.2,
      },
    },
    {
      // F7: el corte marca, no dibuja un reloj. Va en ámbar y SIEMPRE con su
      // cifra en la cabecera («N cerca del corte») — el color no informa solo.
      id: IDS_CAPAS.puntoCorte,
      type: 'circle',
      source: puntos,
      filter: [
        'all',
        ['get', 'cercaDelCorte'],
        ['in', ['get', 'estado'], ['literal', ['pendiente', 'en_ruta']]],
      ],
      paint: {
        'circle-color': 'rgba(0,0,0,0)',
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 6.5, 17, 10],
        'circle-stroke-color': d.anilloCorte,
        'circle-stroke-width': 1.8,
      },
    },
    {
      // ⚠️ EL ÚNICO ROJO DE LA PANTALLA, y va arriba de todo. Regla 4 del
      // alcance: nada decorativo puede tomar este color.
      id: IDS_CAPAS.puntoIncidencia,
      type: 'circle',
      source: puntos,
      filter: ['==', ['get', 'estado'], 'incidencia'],
      paint: {
        'circle-color': d.puntoIncidencia,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 5, 17, 8],
        'circle-stroke-color': d.puntoHalo,
        'circle-stroke-width': 1.8,
      },
    },
    // El `+N` de los pedidos que caen en la misma ubicación (F3). Un edificio
    // con seis entregas es UN punto con «6», no seis puntos encimados. Es texto
    // sobre el propio punto: puede ir encima de la incidencia porque una
    // etiqueta rotula, no tapa. Sin glifos lo sustituye `anilloAgrupado`.
    ...(conEtiquetas
      ? ([
          {
            id: IDS_CAPAS.puntoAgrupado,
            type: 'symbol',
            source: puntos,
            filter: ['>', ['get', 'agrupados'], 1],
            layout: {
              'text-field': ['concat', '+', ['to-string', ['-', ['get', 'agrupados'], 1]]],
              'text-font': FUENTE_MEDIA,
              'text-size': 10,
              'text-offset': [0.9, -0.9],
              'text-allow-overlap': true,
            },
            paint: {
              'text-color': d.agrupacionTexto,
              'text-halo-color': d.puntoHalo,
              'text-halo-width': 1.4,
            },
          },
        ] satisfies LayerSpecification[])
      : []),
  ];
}
