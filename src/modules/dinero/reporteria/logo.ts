/**
 * La marca de Rutax para las planillas, y la paleta viva del producto.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * QUÉ ES
 * -----------------------------------------------------------------------------
 * El logotipo completo —símbolo **más** la palabra— en UNA sola imagen. El
 * símbolo es la opción **1a «Cuadre — la partida doble»** del sistema de marca:
 * dos barras desfasadas que se solapan, «dos líneas que calzan». Que es
 * exactamente lo que hace este reporte: cruzar el cobro al seller con el pago al
 * conductor y mostrar cuándo NO calzan. En ninguna otra pantalla el símbolo dice
 * tanto.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ LA TIPOGRAFÍA ES CHIVO, NO ARCHIVO
 * -----------------------------------------------------------------------------
 * El sistema de marca dice Archivo y **el producto desplegado usa Chivo** — se
 * leyó del navegador contra `rutax.io`, donde `document.fonts` solo trae Chivo
 * 400–700. Gana lo que el courier ve todos los días, no lo que dice el documento.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ VA RASTERIZADA Y EMBEBIDA
 * -----------------------------------------------------------------------------
 * La palabra se rasterizó **una vez, acá**, con el TTF de Chivo. Dibujarla en el
 * servidor exigiría tener la tipografía instalada donde corre la función, y eso
 * funciona en desarrollo y falla en producción sin avisar. Y va como base64 y no
 * como archivo en `public/` porque leerlo con `fs` depende de que el empaquetado
 * serverless lo arrastre — otra cosa que solo se rompe en producción.
 *
 * El fondo es `#F1F6F6`, **el mismo de la banda del encabezado**: así no depende
 * de transparencia y calza sin borde. Si cambias `PAPEL`, hay que regenerarla.
 *
 * Para regenerarla: renderizar el SVG del lockup con `@resvg/resvg-js`
 * pasándole `Chivo-Bold.ttf`, recortar el sobrante con `sharp().trim()` contra
 * ese mismo fondo, y volver a pegar el base64 acá.
 */

/** El logotipo completo, 530×100 PNG sobre el fondo de la banda. */
export const MARCA_RUTAX_PNG_BASE64 =
  "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" +
  "AAAAAElFTkSuQmCC";

/** Proporción real del archivo. Deformar la marca es peor que no ponerla. */
export const MARCA_ANCHO = 530;
export const MARCA_ALTO = 100;

/**
 * La paleta, leída del navegador contra `rutax.io`.
 *
 * Si algún día el producto cambia de color, esto NO se entera solo: son valores
 * copiados, no tokens. Es el precio de que un archivo de Excel no pueda leer
 * CSS, y por eso queda escrito de dónde salieron.
 */
export const TINTA = "FF0B1114";
/** El teal de la marca (`--rx-accent`). */
export const TEAL = "FF00B89A";
/** El teal oscuro (`--ring`), para texto sobre claro donde el teal no contrasta. */
export const TEAL_OSCURO = "FF007D69";
/** El fondo de la aplicación (`--background`). */
export const PAPEL = "FFF1F6F6";
/** El gris de apoyo (`--accent`). */
export const APOYO = "FFE4EDEE";
