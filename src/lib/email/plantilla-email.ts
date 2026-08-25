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
 * · **Blanco puro y negro de marca, jamás casi-blanco ni casi-negro.** Los
 *   clientes invierten los colores por su cuenta en modo oscuro y **no se puede
 *   impedir**. Un `#F1F6F6` invertido queda gris sucio y un `#0B1114` invertido
 *   queda gris claro: los dos ilegibles. `#FFFFFF` y `#0B1114` sobreviven la
 *   inversión porque son los extremos.
 *
 * · **El botón declara su fondo dos veces** —en el `bgcolor` de la celda y en el
 *   `style`— por lo mismo: si el cliente descarta uno, queda el otro. Y es una
 *   celda de tabla con `padding`, no un `<a>` con `display:inline-block`, que
 *   Outlook ignora dejando un enlace sin caja.
 *
 * · **Ningún correo depende de una imagen** (regla 61). El nombre del courier va
 *   como texto: la mayoría de los clientes bloquea imágenes por defecto, y un
 *   correo cuya identidad es un logo bloqueado llega anónimo.
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

// Valores transcritos de `rx-tokens.css`, tema claro. Un correo no tiene tema:
// se envía una vez y lo lee quien sea, donde sea.
const C = {
  fondo: "#E6EEEF", // --rx-bg-sunken · el lienzo alrededor de la tarjeta
  tarjeta: "#FFFFFF", // --rx-bg-raised · blanco PURO, ver la nota de arriba
  texto: "#0B1114", // --rx-fg
  textoTenue: "#4C5F65", // --rx-fg-muted · 6,2:1
  linea: "#C6D6D8", // --rx-line
  lineaTenue: "#DCE7E8", // --rx-line-subtle
  // ⚠️ **Dos teales, y no son intercambiables.** El ADN los separa en
  // `rx-tokens.css`: `--rx-accent` sirve para RELLENO, borde y glifo y **nunca
  // para texto en tema claro**; `--rx-accent-text` es el que sí se lee como
  // texto. Una versión anterior de este archivo usaba el de texto como fondo
  // del botón, con blanco encima — llegaba más apagado que el botón real del
  // producto y contradecía la lámina de la plantilla base.
  acentoTexto: "#007D69", // --rx-accent-text · el enlace de respaldo
  acentoRelleno: "#00B89A", // --rx-accent · el fondo del botón
  sobreAcento: "#04231E", // --rx-fg-on-accent · 6,6:1 sobre el relleno
  datosFondo: "#F1F6F6", // --rx-bg
} as const;

const FUENTE =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = "'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace";

export interface FilaDatosEmail {
  etiqueta: string;
  /** Ya formateado. La plantilla no formatea montos ni fechas. */
  valor: string;
  /** Destaca la fila: el total lleva regla arriba y peso. */
  destacada?: boolean;
}

export interface ArgsPlantillaEmail {
  /**
   * Quién firma. **El courier cuando el destinatario es su cliente** (seller,
   * conductor, comprador); **Rutax cuando nosotros somos la contraparte**
   * (folios, certificado, morosidad, plan). Va como texto, nunca como logo.
   */
  marca: string;
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
  accion?: { etiqueta: string; url: string };
  /** Por qué lo recibe. Va en el pie, y no es opcional. */
  motivoRecepcion: string;
  /**
   * Lo que se ve en la bandeja junto al asunto. Sin esto, el cliente toma la
   * primera línea del cuerpo, que suele ser «Hola,».
   */
  preencabezado?: string;
}

function fila(f: FilaDatosEmail): string {
  const borde = f.destacada
    ? `border-top:2px solid ${C.texto};`
    : `border-top:1px solid ${C.lineaTenue};`;
  const peso = f.destacada ? "700" : "400";
  return (
    `<tr>` +
    `<td style="${borde}padding:8px 0;font-family:${FUENTE};font-size:14px;color:${C.textoTenue}">` +
    `${esc(f.etiqueta)}</td>` +
    `<td align="right" style="${borde}padding:8px 0;font-family:${MONO};font-size:14px;` +
    `font-weight:${peso};color:${C.texto}">${esc(f.valor)}</td>` +
    `</tr>`
  );
}

/**
 * Envuelve el cuerpo de un correo en la plantilla completa.
 *
 * Devuelve el documento entero, listo para el proveedor: doctype, `<head>` con
 * juego de caracteres y `viewport`, y la tabla contenedora.
 */
export function envolverEmail(args: ArgsPlantillaEmail): string {
  const boton = args.accion
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" class="rx-btn" style="margin:24px 0">` +
      `<tr><td bgcolor="${C.acentoRelleno}" style="background-color:${C.acentoRelleno};border-radius:3px">` +
      // 44 px de alto: es el mínimo táctil, y este correo se abre en la calle.
      `<a href="${esc(args.accion.url)}" style="display:block;padding:13px 24px;font-family:${FUENTE};` +
      `font-size:15px;font-weight:600;color:${C.sobreAcento};text-decoration:none">` +
      `${esc(args.accion.etiqueta)}</a>` +
      `</td></tr></table>` +
      `<p style="margin:0 0 16px;font-family:${FUENTE};font-size:13px;line-height:1.5;color:${C.textoTenue}">` +
      `Si el botón no funciona, copia y pega esta dirección:<br>` +
      `<a href="${esc(args.accion.url)}" style="color:${C.acentoTexto};word-break:break-all">${esc(args.accion.url)}</a>` +
      `</p>`
    : "";

  const tablaDatos = args.datos?.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ` +
      `style="margin:20px 0;background-color:${C.datosFondo};padding:4px 14px">` +
      args.datos.map(fila).join("") +
      `</table>`
    : "";

  const preencabezado = args.preencabezado
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(args.preencabezado)}</div>`
    : "";

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
    // El botón pasa a ancho completo bajo 480, como pide la lámina de la
    // plantilla base: en el teléfono un botón angosto obliga a apuntar.
    `<style>@media (max-width:480px){.rx-col{width:100%!important}` +
    `.rx-pad{padding:20px 16px!important}` +
    `.rx-btn{width:100%!important}.rx-btn a{text-align:center!important}}</style>` +
    `</head>` +
    `<body style="margin:0;padding:0;background-color:${C.fondo}">` +
    preencabezado +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ` +
    `style="background-color:${C.fondo}"><tr><td align="center" style="padding:24px 12px">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${ANCHO}" ` +
    `class="rx-col" style="width:${ANCHO}px;max-width:${ANCHO}px;background-color:${C.tarjeta};` +
    `border:1px solid ${C.linea}">` +
    `<tr><td class="rx-pad" style="padding:28px 32px">` +
    // 1 · Marca, como texto.
    `<p style="margin:0 0 20px;font-family:${FUENTE};font-size:13px;font-weight:600;` +
    `letter-spacing:.08em;text-transform:uppercase;color:${C.textoTenue}">${esc(args.marca)}</p>` +
    // 2 · Titular con el hecho.
    `<h1 style="margin:0 0 12px;font-family:${FUENTE};font-size:21px;line-height:1.3;` +
    `font-weight:700;color:${C.texto}">${esc(args.titular)}</h1>` +
    // 3 · Contexto. Cuerpo 15: nunca menos de 14, se lee en la calle.
    `<div style="font-family:${FUENTE};font-size:15px;line-height:1.55;color:${C.texto}">` +
    args.cuerpoHtml +
    `</div>` +
    tablaDatos +
    boton +
    `</td></tr>` +
    // 7 · Pie: por qué lo recibe.
    `<tr><td class="rx-pad" style="padding:16px 32px 24px;border-top:1px solid ${C.lineaTenue};` +
    `font-family:${FUENTE};font-size:12px;line-height:1.5;color:${C.textoTenue}">` +
    `${esc(args.motivoRecepcion)}` +
    `</td></tr>` +
    `</table></td></tr></table></body></html>`
  );
}
