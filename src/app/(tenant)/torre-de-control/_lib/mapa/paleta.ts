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
 * De dónde sale cada valor: `src/app/globals.css` (ADN Retell + navy Rutax) y
 * `DESIGN_SYSTEM.md`. El módulo **ya no tiene lenguaje visual propio**: los 12
 * tokens `--tc-*` del handoff de la v1 se retiraron enteros el 2026-08-03 (Vía B
 * del rediseño). Detalle y justificación en
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
 * TEMA CLARO. Base: el neutro cool del ADN (`--muted #f5f5fa`,
 * `--border #e6e6f3`, `--foreground #172131`).
 */
const CLARO: PaletaMapa = {
  basemap: {
    tierra: '#f1f2f8', //     un punto bajo --muted (#f5f5fa)
    verde: '#e7eee7',
    equipamiento: '#edeef5',
    agua: '#ccd5ea',
    aguaBorde: '#bfc9e2',
    edificio: '#e7e8f0',
    viaAutopista: '#ffffff',
    viaTroncal: '#ffffff',
    viaSecundaria: '#fafafd',
    viaLocal: '#f7f7fc',
    viaBorde: '#dedfeb', //   ≈ --border (#e6e6f3), un punto más oscuro
    ferrocarril: '#d5d6e4',
    textoLugar: '#172131', // = --foreground
    textoVia: '#606a78', //   = --muted-foreground
    textoAgua: '#8791b6',
    halo: '#f1f2f8',
  },
  datos: {
    // Navy de marca (#2a3ca0) a 4 opacidades: 4 / 13 / 24 / 36 %. En hex de 8
    // dígitos para que el estilo no dependa de `fill-opacity` y la rampa conviva
    // con el velo.
    //
    // ⚠️ **Reequilibrada dos veces el mismo día, y las dos por medición.**
    //
    // Iba en 8/14/22/32 % y los dos primeros pasos daban ΔE76 4,5 entre sí:
    // cuatro pasos declarados, tres a la vista. Dentro de una comuna la capa
    // baja al 45 % de opacidad y ahí el escalón caía a ΔE 1,8 — bajo el umbral
    // en que el ojo separa dos superficies contiguas.
    //
    // El primer arreglo (6/17/30/45) resolvió eso pero **subió el tope de 32 % a
    // 45 %**, y la consecuencia se vio en pantalla antes que en el número: la
    // comuna cargada quedaba tan azul que el relleno se leía como un velo puesto
    // encima del plano en vez de como un dato. Se reportó, con razón, como «esa
    // capa parece mal ubicada».
    //
    // 4/13/24/36 es el punto medio medido: ΔE 7,9 / 8,9 / 10,1 entre pasos
    // —mejor separación que el original— y 3,7 / 3,7 / 4,2 atenuada, con el tope
    // de vuelta cerca del 32 % que el diseño había elegido. **La separación se
    // gana abriendo el extremo BAJO, no oscureciendo el alto**: es lo que deja
    // leer el plano por debajo de la comuna más cargada.
    cargaComuna: ['#2a3ca00a', '#2a3ca021', '#2a3ca03d', '#2a3ca05c'],
    comunaBorde: '#c6c9de',
    comunaBordeActiva: '#2a3ca0',
    velo: '#f1f2f8b8',
    agrupacionRelleno: '#ffffff',
    agrupacionBorde: '#2f3a4b',
    agrupacionTexto: '#172131',
    puntoPendiente: '#2f3a4b', // = --primary
    puntoEnRuta: '#2a3ca0', //    = --brand
    puntoEntregado: '#a7aebd',
    puntoIncidencia: '#fb3748', // = --destructive · ÚNICO ROJO
    // Ámbar oscurecido del `--warning` (#ff8447 → #d9590a). El token del sistema
    // daba **2,17:1** contra la tierra, bajo el mínimo de 3:1 que la WCAG 1.4.11
    // pide para objetos gráficos: el anillo se perdía justo sobre el fondo que
    // más se usa. Medido, no estimado (Vía C, 2026-08-04): así queda en 3,49:1.
    //
    // ⚠️ Se paró en 3,49 y no se siguió oscureciendo a propósito. Los ámbares
    // con más contraste (#c2410c da 4,64:1) derivan hacia el rojo, y el rojo
    // está reservado a la incidencia — un anillo rojizo alrededor de un punto
    // sano diría «acá pasa algo» justo donde no pasa nada.
    anilloCorte: '#d9590a', //     = --warning, oscurecido para cumplir 3:1
    puntoHalo: '#ffffff',
    // Sombra bajo el punto. Tinta del sistema al 22 %, no negro: un gris neutro
    // sobre la tierra fría (#f1f2f8) se ve sucio. Es lo que asienta el punto
    // sobre el plano en vez de dejarlo pegado encima.
    puntoSombra: '#1e25364d',
  },
};

/**
 * TEMA OSCURO. Base: `--background #161718`, `--card #24272e`. La tierra va por
 * debajo de las dos para que el panel y las placas floten; si la tierra queda
 * más clara que la card, el mapa «sube» y la pantalla pierde profundidad.
 */
const OSCURO: PaletaMapa = {
  basemap: {
    tierra: '#131417',
    verde: '#161d18',
    equipamiento: '#181920',
    agua: '#0d1119',
    aguaBorde: '#141a26',
    edificio: '#1b1d23',
    viaAutopista: '#3b404c',
    viaTroncal: '#33373f',
    viaSecundaria: '#2a2d34',
    viaLocal: '#232529',
    viaBorde: '#0f1013',
    ferrocarril: '#2a2d34',
    textoLugar: '#eef0f4',
    textoVia: '#9da3ad',
    textoAgua: '#5d6b90',
    halo: '#0d0e11',
  },
  datos: {
    // El navy sube a periwinkle (#7080f5, el `--brand` de dark) y las opacidades
    // suben con él: sobre negro, el mismo alfa rinde menos. 7 / 18 / 31 / 46 %.
    //
    // Se mueve en paralelo a la del claro, y no por un defecto propio: el oscuro
    // ya separaba bien. Es para conservar la relación que la línea de arriba
    // declara — el tema que necesita más alfa tiene que seguir teniendo más.
    // Bajar el tope de 58 % a 46 % además devuelve el plano: la vía sobre la
    // comuna más cargada pasa de 1,31:1 a 1,43:1 de contraste.
    cargaComuna: ['#7080f512', '#7080f52e', '#7080f54f', '#7080f575'],
    comunaBorde: '#ffffff26',
    comunaBordeActiva: '#7080f5',
    velo: '#131417c4',
    agrupacionRelleno: '#24272e', // = --card
    agrupacionBorde: '#8b93a1',
    agrupacionTexto: '#f7f8fa',
    puntoPendiente: '#e6e9ef',
    puntoEnRuta: '#7080f5',
    puntoEntregado: '#5b6068',
    puntoIncidencia: '#e93544', // = --destructive dark · ÚNICO ROJO
    anilloCorte: '#e97135', //     = --warning dark
    puntoHalo: '#0d0e11',
    // En oscuro la sombra es negro puro y más opaca: sobre una tierra que ya es
    // casi negra (#131417), una sombra tintada no se separa del fondo. Lo que da
    // la profundidad acá es el contraste contra el halo oscuro del punto.
    puntoSombra: '#00000080',
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
