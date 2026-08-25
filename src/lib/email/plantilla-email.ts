/**
 * La plantilla base de los correos de Rutax.
 * =============================================================================
 *
 * POR QUÉ ESTO NO EXISTÍA Y HACÍA FALTA
 * -----------------------------------------------------------------------------
 * Los once correos del producto se escribieron en **tres módulos con tres
 * criterios distintos** y ninguno pasó nunca por una revisión de conjunto. Cada
 * uno producía una cadena de `<p>` sueltos que se entregaba tal cual al
 * proveedor: **sin `<!doctype>`, sin `<head>`, sin tabla contenedora y sin ancho
 * declarado**.
 *
 * Eso no es una cuestión de estética. Un fragmento de `<p>` sin contenedor lo
 * renderiza cada cliente como quiere: Outlook lo estira al ancho de la ventana
 * —líneas de 200 caracteres, ilegibles— y Gmail le mete su propio interlineado.
 * Y sin `<head>` no hay forma de declarar el juego de caracteres, así que un
 * «Ñuñoa» o un «$ 864.100» pueden salir con caracteres rotos según el cliente.
 *
 * -----------------------------------------------------------------------------
 * 🔴 LA ANATOMÍA: TRES BANDAS, NO UNA CAJA
 * -----------------------------------------------------------------------------
 * Es la lámina de la plantilla base del bloque de correos, y la misma que usa
 * la tarjeta de seguimiento público de B7: **el correo se lee como una ficha
 * con secciones, no como una hoja con márgenes**.
 *
 *     ┌──────────────────────────────────┐
 *     │ Andes Express            18/700  │  marca
 *     ├══════════════════════════════════┤  ← regla de 2 px en negro de marca
 *     │ Un titular que dice el hecho     │  19/600
 *     │ Un párrafo de contexto…          │  14 · gris de impresión
 *     │ ┌──────────────────────────────┐ │
 *     │ │ Entregas · 285               │ │  caja de datos, todo en mono
 *     │ │ Total · $ 864.100            │ │
 *     │ └──────────────────────────────┘ │
 *     │ [ Una sola acción ]              │  teal de relleno
 *     │ Si el botón no funciona…         │
 *     ├──────────────────────────────────┤
 *     │ Recibes esto porque…             │  pie, 11 px, fondo tenue
 *     └──────────────────────────────────┘
 *
 * ⚠️ **La marca va en su propia banda y a tamaño de titular** (18 px, 700, en
 * negro de marca), separada del cuerpo por una regla de 2 px. Una versión
 * anterior la ponía como una etiqueta de 13 px en versalitas grises dentro de
 * la misma celda del cuerpo: eso la convertía en un rótulo administrativo. El
 * nombre —del courier o el nuestro— **es la primera cosa que ancla el correo**,
 * y en B7 la regla está escrita con todas las letras: en texto, a tamaño de
 * titular, porque no hay logo que poner.
 *
 * ⚠️ **El titular es más chico que en una pantalla, y va debajo de la marca.**
 * 19 px contra los 18 de la marca es una diferencia deliberadamente corta: son
 * dos cosas distintas, no una jerarquía de tres niveles.
 *
 * LAS DECISIONES QUE NO SON OBVIAS
 * -----------------------------------------------------------------------------
 * · **Tablas, no `div`.** En 2026 sigue siendo así: Outlook usa el motor de
 *   Word, que no implementa `max-width` ni `flex`. La única caja que respeta es
 *   una `<table>` con `width` en atributo, no en CSS.
 *
 * · **Todo el estilo va en línea.** Gmail descarta `<style>` en muchos
 *   contextos, así que un token de CSS no llega nunca. Los valores se
 *   transcriben desde `rx-tokens.css` con su nombre anotado al lado, igual que
 *   en el mapa y en los PDF.
 *
 * · **El cuerpo usa el gris de IMPRESIÓN (`#3E4D53`, 7,4:1), no el de
 *   pantalla.** `rx-tokens.css` lo define solo dentro de `@media print` y lo
 *   llama «único gris de texto impreso». Un correo se parece más a un impreso
 *   que a una pantalla: no controlamos el brillo, ni el cliente, ni si se lee
 *   en la calle a mediodía. El gris de pantalla (6,2:1) queda para el pie.
 *
 * · **Blanco puro y negro de marca, jamás casi-blanco ni casi-negro.** Los
 *   clientes invierten los colores por su cuenta en modo oscuro y **no se puede
 *   impedir**. Un `#F1F6F6` invertido queda gris sucio y un `#0B1114` invertido
 *   queda gris claro: los dos ilegibles. `#FFFFFF` y `#0B1114` sobreviven la
 *   inversión porque son los extremos.
 *
 * · **Dos teales, y no son intercambiables.** `--rx-accent` (`#00B89A`) rellena
 *   —es el fondo del botón, con `--rx-fg-on-accent` (`#04231E`) encima, 6,6:1—
 *   y `--rx-accent-text` (`#007D69`) se lee: es el color del enlace de
 *   respaldo. Cruzarlos deja un botón más apagado que el del producto.
 *
 * · **El botón declara su fondo dos veces** —en el `bgcolor` de la celda y en el
 *   `style`— por lo mismo: si el cliente descarta uno, queda el otro. Y es una
 *   celda de tabla con `padding`, no un `<a>` con `display:inline-block`, que
 *   Outlook ignora dejando un enlace sin caja.
 *
 * · **Ningún correo depende de una imagen** (regla 61). El nombre del courier va
 *   como texto: la mayoría de los clientes bloquea imágenes por defecto, y un
 *   correo cuya identidad es un logo bloqueado llega anónimo. Es también la
 *   regla 2 de B7: el nombre en texto es la versión canónica, el logo sería una
 *   mejora opcional que ninguna pieza necesita para verse entera.
 *
 * · **El enlace de respaldo va siempre**, aunque haya botón. Es lo único que
 *   queda cuando el cliente degrada, y es lo que se puede copiar y pegar.
 */

/**
 * ⚠️ **La plantilla escapa, no el llamador.**
 *
 * Todo campo de `ArgsPlantillaEmail` es **texto plano** menos `cuerpoHtml`, que
 * es el único que se declara como HTML y viaja tal cual. Escapa la plantilla y
 * no cada llamador porque un llamador nuevo se olvida y nadie lo nota: el nombre
 * del courier sale de la base y puede traer lo que sea.
 *
 * Lo pilló una prueba que ya existía —`notificaciones-invitacion.test.ts`,
 * «escapa el nombre del courier»— cuando la primera versión de este archivo
 * insertaba `marca` y `titular` crudos.
 */
function esc(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Ancho de la columna. 600 px es lo que cabe en el panel de vista previa. */
const ANCHO = 600;

// Valores transcritos de `rx-tokens.css`. Un correo no tiene tema: se envía una
// vez y lo lee quien sea, donde sea.
const C = {
  fondo: "#E6EEEF", // --rx-bg-sunken · el lienzo alrededor de la tarjeta
  tarjeta: "#FFFFFF", // --rx-bg-raised · blanco PURO, ver la nota de arriba
  texto: "#0B1114", // --rx-fg
  textoCuerpo: "#3E4D53", // --rx-fg-muted del contexto IMPRESO · 7,4:1
  textoTenue: "#4C5F65", // --rx-fg-muted de pantalla · 6,2:1 · solo el pie
  linea: "#C6D6D8", // --rx-line
  lineaTenue: "#DCE7E8", // --rx-line-subtle
  acentoTexto: "#007D69", // --rx-accent-text · el enlace de respaldo
  acentoRelleno: "#00B89A", // --rx-accent · el fondo del botón
  sobreAcento: "#04231E", // --rx-fg-on-accent · 6,6:1 sobre el relleno
  datosFondo: "#F7FBFB", // --rx-bg-inset
  pieFondo: "#F1F6F6", // --rx-bg
} as const;

const FUENTE =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = "'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace";

export interface FilaDatosEmail {
  etiqueta: string;
  /** Ya formateado. La plantilla no formatea montos ni fechas. */
  valor: string;
  /** Destaca la fila: el total va en negrita. */
  destacada?: boolean;
}

export interface ArgsPlantillaEmail {
  /**
   * Quién firma. **El courier cuando el destinatario es su cliente** (seller,
   * conductor, comprador); **Rutax cuando nosotros somos la contraparte**
   * (folios, certificado, morosidad, plan). Va como texto, nunca como logo.
   *
   * Es la regla 1 de B7: en una superficie sin sesión —y un correo lo es— la
   * marca la decide el dueño de la relación.
   */
  marca: string;
  /**
   * Una línea bajo la marca que dice de qué va la pieza, como el «Tu pedido va
   * en camino» de la tarjeta de seguimiento. Opcional: la mayoría de los
   * correos no la necesita porque el titular ya lo dice.
   */
  bajadaMarca?: string;
  /** El hecho, en una línea. */
  titular: string;
  /**
   * Qué pasó, cuándo, y qué significa para quien lee.
   *
   * **El único campo que viaja como HTML.** Todo lo demás es texto plano y lo
   * escapa la plantilla; lo que entre acá es responsabilidad del llamador.
   */
  cuerpoHtml: string;
  /** Donde va la plata y lo que se mira primero. En mono. */
  datos?: FilaDatosEmail[];
  /**
   * Rótulo de la caja de datos, en versalitas monoespaciadas — el recurso con
   * que el sistema encabeza una sección («TU PEDIDO», «EL CIERRE»). Sin él la
   * caja va sin rótulo, que es lo correcto cuando los datos se explican solos.
   */
  rotuloDatos?: string;
  accion?: { etiqueta: string; url: string };
  /** Por qué lo recibe. Va en el pie, y no es opcional. */
  motivoRecepcion: string;
  /**
   * Lo que se ve en la bandeja junto al asunto. Sin esto, el cliente toma la
   * primera línea del cuerpo, que suele ser «Hola,».
   */
  preencabezado?: string;
}

/**
 * Una línea de la caja de datos: `Etiqueta · valor`, todo en mono.
 *
 * ⚠️ **Una sola columna, no dos con el valor alineado a la derecha.** Es lo que
 * dibuja la lámina, y además es lo único que sobrevive: una tabla de dos
 * columnas con `align="right"` se descuadra en cuanto el cliente cambia la
 * fuente monoespaciada por otra de distinto ancho, y en 320 px de teléfono la
 * etiqueta y el valor terminan pegados. El punto medio hace de separador y no
 * depende de ninguna geometría.
 */
function filaDatos(f: FilaDatosEmail): string {
  const linea = `${esc(f.etiqueta)} · ${esc(f.valor)}`;
  return f.destacada ? `<strong>${linea}</strong>` : linea;
}

/**
 * Envuelve el cuerpo de un correo en la plantilla completa.
 *
 * Devuelve el documento entero, listo para el proveedor: doctype, `<head>` con
 * juego de caracteres y `viewport`, y la tabla contenedora.
 */
export function envolverEmail(args: ArgsPlantillaEmail): string {
  const boton = args.accion
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" class="rx-btn" style="margin:15px 0 0">` +
      `<tr><td bgcolor="${C.acentoRelleno}" style="background-color:${C.acentoRelleno};border-radius:3px">` +
      // 44 px de alto: es el mínimo táctil, y este correo se abre en la calle.
      `<a href="${esc(args.accion.url)}" style="display:block;padding:14px 18px;font-family:${FUENTE};` +
      `font-size:14px;font-weight:600;color:${C.sobreAcento};text-decoration:none">` +
      `${esc(args.accion.etiqueta)}</a>` +
      `</td></tr></table>` +
      `<p style="margin:14px 0 0;font-family:${FUENTE};font-size:12.5px;line-height:1.6;color:${C.textoCuerpo}">` +
      `Si el botón no funciona, copia y pega esta dirección:<br>` +
      `<a href="${esc(args.accion.url)}" style="font-family:${MONO};font-size:11px;` +
      `color:${C.acentoTexto};word-break:break-all">${esc(args.accion.url)}</a>` +
      `</p>`
    : "";

  const rotulo = args.rotuloDatos
    ? `<div style="font-family:${MONO};font-size:9px;line-height:1.5;letter-spacing:.12em;` +
      `text-transform:uppercase;color:${C.textoTenue};margin:0 0 8px">${esc(args.rotuloDatos)}</div>`
    : "";

  const cajaDatos = args.datos?.length
    ? `<div style="border:1px solid ${C.linea};background-color:${C.datosFondo};padding:12px 13px;` +
      `margin:13px 0 0">` +
      rotulo +
      `<div style="font-family:${MONO};font-size:13px;line-height:1.7;color:${C.texto}">` +
      args.datos.map(filaDatos).join("<br>") +
      `</div></div>`
    : "";

  const preencabezado = args.preencabezado
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(args.preencabezado)}</div>`
    : "";

  const bajada = args.bajadaMarca
    ? `<div style="margin:5px 0 0;font-family:${FUENTE};font-size:12.5px;line-height:1.5;` +
      `color:${C.textoTenue}">${esc(args.bajadaMarca)}</div>`
    : "";

  // ⚠️ «Despacho gestionado con Rutax» solo cuando NO firmamos nosotros. Si la
  // marca ya es Rutax, esa línea diría dos veces lo mismo — y en un correo de
  // folios o de morosidad sonaría a que le presentamos un proveedor ajeno.
  const firmaRutax =
    args.marca.trim().toLowerCase() === "rutax"
      ? ""
      : `<br>Despacho gestionado con <strong style="color:${C.texto}">Rutax</strong>`;

  return (
    `<!doctype html><html lang="es"><head>` +
    `<meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    // `x-apple-disable-message-reformatting` impide que Mail de iOS reescale el
    // cuerpo y deje el texto en 9 px.
    `<meta name="x-apple-disable-message-reformatting">` +
    `<title>${esc(args.titular)}</title>` +
    // La media query es lo ÚNICO que va en `<style>`: si el cliente la descarta,
    // queda la tabla de 600 px, que ya funciona. Nada crítico depende de acá.
    `<style>@media (max-width:480px){.rx-col{width:100%!important}` +
    `.rx-pad{padding:16px 14px!important}` +
    // El botón pasa a ancho completo bajo 480, como pide la lámina: en el
    // teléfono un botón angosto obliga a apuntar.
    `.rx-btn{width:100%!important}.rx-btn a{text-align:center!important}}</style>` +
    `</head>` +
    `<body style="margin:0;padding:0;background-color:${C.fondo}">` +
    preencabezado +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ` +
    `style="background-color:${C.fondo}"><tr><td align="center" style="padding:24px 12px">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${ANCHO}" ` +
    `class="rx-col" style="width:${ANCHO}px;max-width:${ANCHO}px;background-color:${C.tarjeta};` +
    `border:1px solid ${C.linea}">` +
    // 1 · Banda de marca. Tamaño de titular, en negro de marca, y una regla de
    //     2 px que la separa del cuerpo.
    `<tr><td class="rx-pad" style="padding:16px 18px;border-bottom:2px solid ${C.texto}">` +
    `<div style="font-family:${FUENTE};font-size:18px;line-height:1;font-weight:700;` +
    `letter-spacing:-.02em;color:${C.texto}">${esc(args.marca)}</div>` +
    bajada +
    `</td></tr>` +
    // 2 · Banda de cuerpo: titular, contexto, datos, acción y respaldo.
    `<tr><td class="rx-pad" style="padding:18px">` +
    `<div style="font-family:${FUENTE};font-size:19px;line-height:1.3;font-weight:600;` +
    `letter-spacing:-.012em;color:${C.texto}">${esc(args.titular)}</div>` +
    `<div style="margin:9px 0 0;font-family:${FUENTE};font-size:14px;line-height:1.6;` +
    `color:${C.textoCuerpo}">` +
    args.cuerpoHtml +
    `</div>` +
    cajaDatos +
    boton +
    `</td></tr>` +
    // 3 · Banda de pie: por qué lo recibe, y quién gestiona el despacho.
    `<tr><td class="rx-pad" style="padding:14px 18px;background-color:${C.pieFondo};` +
    `border-top:1px solid ${C.lineaTenue};font-family:${FUENTE};font-size:11px;line-height:1.6;` +
    `color:${C.textoTenue}">` +
    `${esc(args.motivoRecepcion)}${firmaRutax}` +
    `</td></tr>` +
    `</table></td></tr></table></body></html>`
  );
}
