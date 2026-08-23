/**
 * Paleta cartográfica de la Torre v2 — los dos temas del mapa.
 * =============================================================================
 *
 * POR QUÉ ESTO VIVE EN TYPESCRIPT Y NO EN `globals.css`. MapLibre no lee CSS:
 * su estilo es un objeto JSON con colores literales. Un `var(--muted)` dentro de
 * `fill-color` no se resuelve — se ignora y la capa queda transparente. Así que
 * la única forma honesta de que el mapa siga el sistema de diseño es **derivar
 * sus valores de los tokens y dejarlos escritos acá**, con el token de origen
 * anotado al lado. Si algún día cambia un token del producto, este archivo es la
 * lista de lo que hay que mover con él.
 *
 * De dónde sale cada valor: **los 24 tokens `--rx-map-*` de `rx-tokens.css`**
 * (`:118-133` oscuro, `:213-226` claro) y los tonos de estado del mismo archivo.
 * Cada línea de abajo lleva anotado su token de origen; si un token del producto
 * cambia, este archivo es la lista de lo que hay que mover con él.
 *
 * ⚠️ Hasta el 23-08-2026 esto pintaba con el **ADN anterior**: navy `#2a3ca0`,
 * periwinkle `#7080f5`, tierra `#f1f2f8` / `#131417`, rojo `#fb3748`. Al mismo
 * tiempo, los 24 tokens de mapa del sistema nuevo **no tenían un solo consumidor
 * en todo el repo**: estaban escritos y eran inalcanzables. El mapa era la
 * superficie más visible del producto que seguía viéndose como el sistema
 * retirado — y no por descuido, sino porque MapLibre no lee CSS y el puente de
 * tokens no lo alcanza.
 *
 * El módulo **ya no tiene lenguaje visual propio**: los 12 tokens `--tc-*` del
 * handoff de la v1 se retiraron enteros el 2026-08-03. Detalle en
 * `docs/torre-de-control/lenguaje-visual-v2.md`.
 *
 * -----------------------------------------------------------------------------
 * LAS TRES REGLAS DE COLOR QUE ESTE ARCHIVO TIENE QUE RESPETAR
 * -----------------------------------------------------------------------------
 * 1. **El rojo está reservado a la incidencia abierta** (regla 4 del alcance).
 *    En todo este archivo hay exactamente UN rojo y lo usa una sola capa. Nada
 *    decorativo puede tomarlo: ni un borde, ni un realce, ni un hover.
 * 2. **El color nunca es el único canal** (regla 2). La rampa de carga de la
 *    comuna acompaña siempre a la placa con su fracción «38 de 120»; el punto de
 *    incidencia acompaña siempre a su ficha en el panel. El color ordena de un
 *    vistazo, no informa solo.
 * 3. **La cifra es una magnitud, nunca un índice** (regla 3). La rampa de carga
 *    codifica CUÁNTOS faltan, no un puntaje 0–100. Por eso tiene cuatro pasos y
 *    un solo tono: es intensidad de una magnitud, no una escala semántica que
 *    haya que aprender.
 */

/** Los dos temas del producto. Sigue a `next-themes`, no tiene conmutador propio. */
export type TemaMapa = 'claro' | 'oscuro';

/**
 * Colores del plano urbano. Un plano se ve «fino» por la JERARQUÍA, no por la
 * saturación: cinco grises que se separan bien valen más que cinco colores.
 */
export interface PaletaBasemap {
  /** Fondo del mapa. Va un punto por DEBAJO de `--background` para que las
   *  tarjetas del panel floten sobre él en vez de fundirse. */
  tierra: string;
  /** Parques y áreas verdes. Verde desaturado: es referencia urbana, no dato. */
  verde: string;
  /** Suelo institucional (hospital, universidad, aeropuerto). Apenas perceptible. */
  equipamiento: string;
  agua: string;
  aguaBorde: string;
  edificio: string;
  /** Los cuatro escalones de la jerarquía vial, de mayor a menor. */
  viaAutopista: string;
  viaTroncal: string;
  viaSecundaria: string;
  viaLocal: string;
  /** Contorno de la vía. Es lo que hace que una calle se lea como calle. */
  viaBorde: string;
  ferrocarril: string;
  /** Etiquetas: lugar (comuna, barrio), vía y agua, con su halo. */
  textoLugar: string;
  textoVia: string;
  textoAgua: string;
  halo: string;
}

/**
 * Colores del dato operativo que se dibuja ENCIMA del plano. Son los que llevan
 * significado; el basemap es contexto.
 */
export interface PaletaDatos {
  /** Rampa de carga de la comuna: 4 pasos de un solo tono, del navy de marca.
   *  Sobre el mapa el navy deja de ser decoración y pasa a ser el canal de dato
   *  — es la única excepción a «el navy es recurso escaso», y está acotada acá. */
  cargaComuna: [string, string, string, string];
  comunaBorde: string;
  comunaBordeActiva: string;
  /** Velo con que se atenúan las demás comunas al entrar en una (niveles 2 y 3). */
  velo: string;
  /** Agrupación del nivel 2: burbuja con su cifra dentro. */
  agrupacionRelleno: string;
  agrupacionBorde: string;
  agrupacionTexto: string;
  puntoPendiente: string;
  puntoEnRuta: string;
  puntoEntregado: string;
  /** ⚠️ EL ÚNICO ROJO DEL ARCHIVO. Solo la capa de incidencias puede usarlo. */
  puntoIncidencia: string;
  /** Anillo ámbar del pendiente cerca del corte (F7). Marca, no reloj. */
  anilloCorte: string;
  /** Halo de los puntos: el color de la tierra, para recortarlos del plano. */
  puntoHalo: string;
  /**
   * Sombra difusa bajo el punto. Lleva su alfa embebido, como el velo y la
   * rampa de carga, para no depender de una opacidad de capa aparte.
   *
   * El **entregado no la lleva**: es lo que lo hunde en el plano y lo separa de
   * lo que todavía cuenta, sin gastar otro color.
   */
  puntoSombra: string;
}

export interface PaletaMapa {
  basemap: PaletaBasemap;
  datos: PaletaDatos;
}

/**
 * TEMA CLARO. Sale de `--rx-map-*` en `rx-tokens.css:213-226`, más los tonos de
 * estado del mismo archivo para los datos.
 */
const CLARO: PaletaMapa = {
  basemap: {
    tierra: '#F1F6F6', //        --rx-map-land
    verde: '#EAF2F0', //         --rx-map-park
    equipamiento: '#EAF2F0', //  = parque; el suelo institucional no es una capa propia
    agua: '#E6EEEF', //          --rx-map-water
    aguaBorde: '#DCE7E8', //     --rx-map-road-minor, el escalón inmediato
    edificio: '#EAF2F0', //      = parque
    viaAutopista: '#BCCFD1', //  --rx-map-highway
    viaTroncal: '#CDDCDE', //    --rx-map-road-major
    viaSecundaria: '#DCE7E8', // --rx-map-road-minor
    // El sistema declara TRES escalones de vía, no cuatro. La local comparte
    // color con la secundaria y se separa por ANCHO, que es lo que `estilo.ts`
    // ya hace. Inventar un cuarto color sería agregar un token que nadie definió.
    viaLocal: '#DCE7E8', //      --rx-map-road-minor
    viaBorde: '#C6D6D8', //      --rx-line
    ferrocarril: '#CDDCDE', //   --rx-map-road-major
    textoLugar: '#56666B', //    --rx-map-label-comuna
    textoVia: '#7C8A88', //      --rx-map-label
    textoAgua: '#7C8A88', //     --rx-map-label
    halo: 'rgba(255, 255, 255, .7)', // --rx-map-label-halo
  },
  datos: {
    // Rampa de carga: cuatro pasos de UN solo tono, el acento. Sin escala de
    // semáforo — codifica cuántos faltan, que es una magnitud, no un puntaje.
    //
    // ⚠️ VAN SÓLIDOS, no con alfa. Antes eran hex de 8 dígitos sobre el plano;
    // el sistema los declara opacos porque a zoom de comuna **el polígono ES el
    // contenido** y el plano es escenario. Ver §13.1 y §13.3.
    cargaComuna: ['#DBF8F2', '#97E8D9', '#00B89A', '#007D69'],
    comunaBorde: '#C6D6D8', //        --rx-line
    comunaBordeActiva: '#0B1114', //  --rx-map-comuna-sel = --rx-fg
    velo: 'rgba(241, 246, 246, .78)', // tierra con alfa
    agrupacionRelleno: '#FFFFFF', //  --rx-bg
    agrupacionBorde: '#C6D6D8', //    --rx-line
    agrupacionTexto: '#0B1114', //    --rx-fg
    puntoPendiente: '#4C5F65', //     --rx-neutral-fg · `pedido:asignado` es neutral
    puntoEnRuta: '#0075A8', //        --rx-progress-fg
    // ⚠️ El entregado NO toma su tono de ciclo (`balanced`), y es a propósito:
    // ese teal es el mismo de la rampa de carga, así que a las 21:00 el mapa
    // sería una mancha teal donde no se distingue una comuna cargada de un punto
    // ya entregado. Y `inert`, que sería lo semánticamente exacto, exige su
    // trama de 135° — imposible en un círculo de 8 px. Así que toma el gris del
    // propio plano: un entregado es escenario, no contenido.
    puntoEntregado: '#7C8A88', //     --rx-map-label
    puntoIncidencia: '#C2361F', //    --rx-fault-fg · ÚNICO ROJO
    anilloCorte: '#8A5B00', //        --rx-attention-fg
    puntoHalo: '#F1F6F6', //          = tierra
    puntoSombra: 'rgba(11, 17, 20, .28)',
  },
};

/**
 * TEMA OSCURO. Sale de `--rx-map-*` en `rx-tokens.css:118-133`. Es el tema base
 * del sistema; el claro se deriva de él, no al revés.
 */
const OSCURO: PaletaMapa = {
  basemap: {
    tierra: '#0B1114', //        --rx-map-land
    verde: '#0E1518', //         --rx-map-park
    equipamiento: '#0E1518',
    agua: '#070C0E', //          --rx-map-water
    aguaBorde: '#16211E', //     --rx-map-road-minor
    edificio: '#0E1518',
    viaAutopista: '#2A3A41', //  --rx-map-highway
    viaTroncal: '#1F2C31', //    --rx-map-road-major
    viaSecundaria: '#16211E', // --rx-map-road-minor
    viaLocal: '#16211E', //      = secundaria; la jerarquía la lleva el ancho
    // En oscuro el borde de la vía va MÁS OSCURO que la tierra, no más claro:
    // es lo que recorta la calle del suelo. Toma el agua, que es el punto más
    // bajo de la escala.
    viaBorde: '#070C0E', //      --rx-map-water
    ferrocarril: '#1F2C31', //   --rx-map-road-major
    textoLugar: '#7E9198', //    --rx-map-label-comuna
    textoVia: '#5C6B6E', //      --rx-map-label
    textoAgua: '#5C6B6E', //     --rx-map-label
    halo: 'rgba(11, 17, 20, .7)', // --rx-map-label-halo
  },
  datos: {
    cargaComuna: ['#04302A', '#0A5F52', '#00B89A', '#00D6B4'],
    comunaBorde: '#2A3A41', //        --rx-line
    comunaBordeActiva: '#E9F2F3', //  --rx-map-comuna-sel = --rx-fg
    velo: 'rgba(11, 17, 20, .78)',
    agrupacionRelleno: '#0E1518', //  --rx-bg-elevated
    agrupacionBorde: '#2A3A41', //    --rx-line
    agrupacionTexto: '#E9F2F3', //    --rx-fg
    puntoPendiente: '#9EB0B6', //     --rx-neutral-fg
    puntoEnRuta: '#43C9FF', //        --rx-progress-fg
    puntoEntregado: '#5C6B6E', //     --rx-map-label · ver la nota del tema claro
    puntoIncidencia: '#FF6B57', //    --rx-fault-fg · ÚNICO ROJO
    anilloCorte: '#FFC53D', //        --rx-attention-fg
    puntoHalo: '#0B1114', //          = tierra
    // En oscuro la sombra es negro puro: sobre una tierra casi negra, una
    // sombra tintada no se separa del fondo.
    puntoSombra: 'rgba(0, 0, 0, .5)',
  },
};

export const PALETAS: Record<TemaMapa, PaletaMapa> = { claro: CLARO, oscuro: OSCURO };

export function paletaDe(tema: TemaMapa): PaletaMapa {
  return PALETAS[tema];
}

// =============================================================================
// Zoom semántico — F2
// =============================================================================

/**
 * Los tres niveles del zoom semántico. No son modos que el usuario elija: son
 * consecuencia de dónde está el mapa.
 */
export type NivelZoom = 'comuna' | 'agrupacion' | 'punto';

/**
 * Umbrales de zoom del escalón. Medidos en el prototipo sobre el basemap real de
 * la RM, no elegidos a ojo:
 *
 * · **< 11** la RM entra entera en el lienzo y una comuna ocupa pocos píxeles:
 *   dibujar puntos ahí es una mancha, así que manda la comuna.
 * · **11 – 13.6** una comuna llena el lienzo y sus calles principales ya tienen
 *   nombre; los pedidos caben como agrupaciones con su cifra.
 * · **≥ 13.6** se leen los nombres de calle local, que es lo que ubica un punto
 *   de entrega. Recién ahí un pedido suelto significa algo.
 *
 * `flyTo` los usa como destino, y el escuchador de `zoom` los usa como frontera:
 * el nivel se puede alcanzar con la rueda o con un clic, y el resultado es el
 * mismo (decisión del usuario, 2026-08-03).
 */
export const UMBRALES_ZOOM = {
  /** Bajo esto manda la comuna. */
  comuna: 11,
  /** Sobre esto se abren los puntos individuales. */
  punto: 13.6,
} as const;

/** Zoom al que aterriza el `flyTo` de cada nivel. */
export const ZOOM_DESTINO = {
  /** Encuadre de la Región Metropolitana completa. */
  region: 9.2,
  /** Una comuna llenando el lienzo. */
  comuna: 12.3,
  /** Cerca del punto de entrega, con nombre de calle local legible. */
  punto: 15.2,
} as const;

export function nivelParaZoom(zoom: number): NivelZoom {
  if (zoom < UMBRALES_ZOOM.comuna) return 'comuna';
  if (zoom < UMBRALES_ZOOM.punto) return 'agrupacion';
  return 'punto';
}

/**
 * Encuadre inicial: la Región Metropolitana. El `maxBounds` deja holgura de
 * sobra —hay couriers que reparten en Melipilla, Colina o Paine— pero impide
 * que un arrastre distraído deje al usuario en medio del Pacífico sin plano.
 */
export const ENCUADRE_RM = {
  centro: [-70.65, -33.47] as [number, number],
  zoom: ZOOM_DESTINO.region,
  limites: [
    [-71.9, -34.45],
    [-69.6, -32.8],
  ] as [[number, number], [number, number]],
  /**
   * Suelo de alejamiento.
   *
   * ⚠️ **Subió de 8 a 8.8 en la Vía C, y el motivo es la forma de la caja.**
   * `limites` cubre 2,3° de longitud —holgado a propósito, hay couriers que
   * reparten en Melipilla o Paine—, así que `maxBounds` solo empieza a frenar
   * cuando esos 2,3° llenan el lienzo. En una caja ancha y **baja** (~864×473,
   * que es la de esta pantalla) eso ocurre recién en z≈8,04: con el suelo en 8,
   * el freno prácticamente no existía y la rueda dejaba salir hasta ver medio
   * país, con las comunas convertidas en manchas.
   *
   * A 8,8 el lienzo muestra ~1,4° de ancho: el Gran Santiago entero con margen
   * de sobra, y ni un grado más. El encuadre de entrada (`region`, 9,2) queda
   * justo por encima, así que sigue habiendo recorrido para alejarse un poco
   * antes de topar.
   *
   * Depende del alto de la caja: si algún día el mapa cambia de proporción, este
   * número se recalcula. No es un gusto, es geometría.
   */
  zoomMinimo: 8.8,
  zoomMaximo: 17.5,
} as const;
