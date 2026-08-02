/**
 * Las cinco tramas de riesgo a 45°, como imágenes de MapLibre.
 * ===========================================================================
 *
 * POR QUÉ NO SON SVG. El handoff define cada paso de la escala como un
 * `<pattern patternTransform="rotate(45)">` con un `<rect>` de fondo y una
 * `<line>`. Eso funciona en SVG y no funciona en MapLibre: una capa `fill`
 * solo acepta `fill-pattern`, que resuelve contra una imagen RASTER del
 * sprite del estilo. No hay forma de darle un `<pattern>` SVG.
 *
 * Se generan aquí, en un `<canvas>`, y se registran con `map.addImage()`. Es
 * mejor que un archivo de sprite servido aparte por tres razones: no hay un
 * activo binario más que publicar y mantener sincronizado con `riesgo.ts`;
 * los valores (pitch, grosor, opacidad, fondo, tinta) salen de la MISMA
 * constante que usan la leyenda, la lista de zonas y el desglose, así que no
 * pueden divergir; y el DPR es un parámetro, no una decisión congelada en un
 * PNG.
 *
 * DPR 2: `addImage` recibe `pixelRatio`, así que la trama se dibuja al doble
 * de resolución y MapLibre la escala. En pantalla normal se ve idéntica; en
 * pantalla Retina la diagonal no se escalona. A DPR 1 una línea de 1 px a 45°
 * queda con alias y la escala de densidades —que ES el canal primario del
 * riesgo, regla de producto 4— se vuelve ilegible entre los pasos 3 y 4.
 *
 * GEOMETRÍA DEL MOSAICO. La familia de rectas es `x + y = c`. Dos rectas
 * consecutivas están a `|Δc| / √2` de distancia perpendicular, así que para
 * un pitch `p` hace falta `Δc = p·√2`. Tomando el lado del mosaico `L = p·√2`
 * y dibujando las rectas `c = 0`, `c = L` y `c = 2L`, el mosaico repite sin
 * costura: la esquina superior izquierda y la inferior derecha reciben cada
 * una la mitad de la línea que su vecino completa. `L` se redondea a entero
 * porque un mosaico de lado fraccionario deja una costura visible al repetir.
 */

import { ESCALA_RIESGO, type EscalonRiesgo, type PasoRiesgo } from "../riesgo";

/** Resolución a la que se dibuja la trama. Ver cabecera. */
export const DPR_TRAMA = 2;

/** Id con el que la trama del paso `n` queda registrada en el estilo. */
export function idTrama(paso: PasoRiesgo): string {
  return `tc-trama-${paso}`;
}

export interface ImagenTrama {
  id: string;
  imagen: { width: number; height: number; data: Uint8ClampedArray };
  pixelRatio: number;
}

/**
 * Dibuja un escalón de la escala como mosaico cuadrado repetible.
 * Devuelve `null` si el canvas no está disponible (SSR o contexto 2D negado).
 */
export function dibujarTrama(escalon: EscalonRiesgo, dpr = DPR_TRAMA): ImagenTrama | null {
  if (typeof document === "undefined") return null;

  const lado = Math.max(4, Math.round(escalon.pitch * Math.SQRT2 * dpr));
  const canvas = document.createElement("canvas");
  canvas.width = lado;
  canvas.height = lado;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // 1. El fondo del escalón, opaco. Es parte de la trama y no una capa aparte:
  //    el paso 4 asienta sobre Inserto y el 5 sobre Señal-100, y separarlos en
  //    dos capas `fill` de MapLibre duplicaría el trabajo de pintado por nada.
  ctx.fillStyle = escalon.fondo;
  ctx.fillRect(0, 0, lado, lado);

  // 2. Las tres rectas del mosaico (c = 0, L, 2L). Se extienden más allá del
  //    lienzo y el canvas las recorta: así el grosor cae completo también en
  //    las esquinas, que es lo que hace que la repetición no tenga costura.
  ctx.strokeStyle = escalon.tintaLinea;
  ctx.lineWidth = escalon.grosor * dpr;
  ctx.globalAlpha = escalon.opacidad;
  ctx.beginPath();
  for (const c of [0, lado, 2 * lado]) {
    ctx.moveTo(c - 2 * lado, 2 * lado);
    ctx.lineTo(c + 2 * lado, -2 * lado);
  }
  ctx.stroke();

  return {
    id: idTrama(escalon.paso),
    imagen: ctx.getImageData(0, 0, lado, lado),
    pixelRatio: dpr,
  };
}

/** Id del punteado que rellena lluvia y aire (README §4, capas del mapa). */
export const ID_TRAMA_PUNTOS = "tc-puntos";

/**
 * Punteado de las capas meteorológicas: puntos de r=1 cada 9 px al 30 %.
 * Es deliberadamente OTRO lenguaje que la trama de riesgo —punto contra línea—
 * para que una celda de lluvia sobre una zona crítica siga leyéndose como dos
 * cosas distintas superpuestas y no como un tercer nivel de densidad.
 */
export function dibujarPunteado(dpr = DPR_TRAMA): ImagenTrama | null {
  if (typeof document === "undefined") return null;

  const lado = 9 * dpr;
  const canvas = document.createElement("canvas");
  canvas.width = lado;
  canvas.height = lado;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.clearRect(0, 0, lado, lado);
  ctx.fillStyle = "#201e1d";
  ctx.globalAlpha = 0.3;
  ctx.beginPath();
  ctx.arc(lado / 2, lado / 2, 1 * dpr, 0, 2 * Math.PI);
  ctx.fill();

  return { id: ID_TRAMA_PUNTOS, imagen: ctx.getImageData(0, 0, lado, lado), pixelRatio: dpr };
}

/** Id del rombo que marca cada incidente de tránsito. */
export const ID_ROMBO_TRANSITO = "tc-rombo";

/**
 * Rombo de 12 px por incidente de tránsito. Se dibuja como path y no rotando
 * un cuadrado: a 45° el antialias de una rotación redondea las puntas, y el
 * módulo no tiene una sola esquina redondeada.
 */
export function dibujarRomboTransito(dpr = DPR_TRAMA): ImagenTrama | null {
  if (typeof document === "undefined") return null;

  const lado = 14 * dpr;
  const canvas = document.createElement("canvas");
  canvas.width = lado;
  canvas.height = lado;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const c = lado / 2;
  const r = 6 * dpr;
  ctx.clearRect(0, 0, lado, lado);
  ctx.beginPath();
  ctx.moveTo(c, c - r);
  ctx.lineTo(c + r, c);
  ctx.lineTo(c, c + r);
  ctx.lineTo(c - r, c);
  ctx.closePath();
  ctx.fillStyle = "#f3f2f2";
  ctx.fill();
  ctx.lineWidth = 2 * dpr;
  ctx.strokeStyle = "#201e1d";
  ctx.stroke();

  return { id: ID_ROMBO_TRANSITO, imagen: ctx.getImageData(0, 0, lado, lado), pixelRatio: dpr };
}

/** Las cinco tramas de riesgo más el punteado y el rombo, para `addImage()`. */
export function dibujarImagenesDelMapa(dpr = DPR_TRAMA): ImagenTrama[] {
  return [
    ...ESCALA_RIESGO.map((escalon) => dibujarTrama(escalon, dpr)),
    dibujarPunteado(dpr),
    dibujarRomboTransito(dpr),
  ].filter((t): t is ImagenTrama => t !== null);
}
