/**
 * `mail.seguimiento` — el aviso al comprador final.
 * =============================================================================
 *
 * El único correo del producto que sale hacia alguien **que no es cliente de
 * nadie en Rutax**: no tiene cuenta, no sabe qué es un courier y no le puede
 * preguntar a nadie. Es la misma persona que abre `/tracking/[token]` desde
 * WhatsApp, y este correo es la versión en bandeja de esa tarjeta.
 *
 * -----------------------------------------------------------------------------
 * 🔴 NUNCA EN FLEX, Y NO ES UNA PREFERENCIA
 * -----------------------------------------------------------------------------
 * En Flex la relación con el comprador **es de Mercado Libre**: ML ya le manda
 * sus propios avisos, su app es la que registra la entrega y el estado oficial
 * lo publica ML. Un correo nuestro ahí sería un segundo remitente contando la
 * misma historia con otra hora — y cuando las dos no coincidan, la que manda no
 * es la nuestra.
 *
 * Por eso `construirEmailSeguimiento` **devuelve `null`** ante `ml_flex` y ante
 * cualquier fuente que no conozca. Falla cerrado: una fuente nueva no empieza a
 * escribirle a compradores por omisión.
 *
 * -----------------------------------------------------------------------------
 * 🔴 LO QUE NO PUEDE LLEVAR, Y POR QUÉ ES MÁS DURO QUE EN OTRAS PIEZAS
 * -----------------------------------------------------------------------------
 * Es **la forma más restringida del pedido en todo el registro** (B7, variante
 * de rol declarada): estado traducido, ventana o hora de entrega, código de
 * envío y comuna. **Nada más.**
 *
 * · **Sin dirección y sin nombre del destinatario.** Un correo se reenvía y se
 *   queda en el historial de una bandeja que no controlamos. Es la misma regla
 *   legal del punto en el mapa de la Torre.
 * · **Sin el nombre de quien recibió.** «Lo recibió alguien en el domicilio» es
 *   lo más específico que se puede decir.
 * · **Sin el motivo de una falla.** Por qué no se pudo entregar —dirección
 *   mala, nadie contesta, zona peligrosa— es una conversación entre el courier
 *   y su seller, no información para el comprador.
 * · **Sin montos, sin conductor, sin teléfono.**
 *
 * -----------------------------------------------------------------------------
 * QUIÉN FIRMA, Y QUÉ DICE EL ASUNTO — NO SON EL MISMO NOMBRE
 * -----------------------------------------------------------------------------
 * **Firma el courier** (regla 1 de B7: la marca la decide el dueño de la
 * relación, y quien entrega es él). Pero **el asunto nombra la tienda**, porque
 * en la bandeja el comprador reconoce dónde compró, no quién reparte: «Tu
 * pedido de Vega Norte va en camino». Si el asunto dijera el courier, la mitad
 * lo leería como publicidad de una empresa que no conoce.
 *
 * -----------------------------------------------------------------------------
 * DOS ENVÍOS, Y SOLO DOS
 * -----------------------------------------------------------------------------
 * Uno al salir a ruta y otro al entregar. No hay un tercero por cada cambio de
 * estado: el enlace del correo lleva a la tarjeta pública, que está siempre al
 * día. Un correo por transición convertiría el aviso en ruido y haría que el
 * segundo —el que de verdad importa— se perdiera entre los otros.
 *
 * ⚠️ **El estado va en el cuerpo pero NO en el asunto de un reenvío**: el
 * asunto se congela en la bandeja y el enlace se abre días después. Es la misma
 * razón por la que la tarjeta de enlace compartido dice «Sigue tu pedido» y no
 * el estado (regla 6 de B7).
 */

import { envolverEmail } from "@/lib/email/plantilla-email";

import { esFuenteConocida, podLoGobiernaLaFuente } from "./fuente";

/**
 * Los dos momentos en que se escribe. No hay un tercero: ver la nota de arriba.
 *
 * `con_novedad` **no manda correo**. Se decidió así porque el correo no puede
 * decir el motivo (regla 46) y sin motivo el mensaje sería «no se pudo entregar
 * y no te podemos decir por qué», que asusta sin resolver nada. Quien contacta
 * es la tienda, que sí sabe.
 */
export type MomentoSeguimiento = "en_camino" | "entregado";

export interface ArgsEmailSeguimiento {
  /** De dónde vino el pedido. En `ml_flex` no se manda nada. */
  fuente: string | null | undefined;
  /** Quién entrega. Es quien firma el correo. */
  nombreCourier: string;
  /** Dónde compró. Es lo que va en el asunto. */
  nombreTienda: string;
  /** `codigo_interno`, formato `RX-XXXX-XXXX`. Nunca el `tracking_token`. */
  codigoEnvio: string;
  /** La comuna, que es todo lo que se dice del destino. Nunca la dirección. */
  comuna: string;
  /**
   * La URL pública completa de `/tracking/[token]`.
   *
   * ⚠️ Es la ÚNICA pieza secreta que viaja acá, y viaja porque su destinatario
   * es precisamente quien tiene derecho a verla. No se muestra en texto aparte
   * del enlace de respaldo que la plantilla ya pone.
   */
  urlSeguimiento: string;
  momento: MomentoSeguimiento;
  /**
   * La respuesta a la única pregunta que trae esta persona, ya formateada:
   * «hoy entre las 15:00 y las 17:00» o «hoy a las 16:24». El llamador la arma
   * con `formato-cl`, porque acá no se resuelve ninguna zona horaria.
   *
   * `null` cuando no hay compromiso que citar — y entonces el titular no
   * inventa uno.
   */
  cuando: string | null;
}

export interface EmailSeguimiento {
  asunto: string;
  html: string;
  texto: string;
}

/**
 * Arma el correo, o devuelve `null` si a esta fuente no le corresponde.
 *
 * `null` no es un fallo: es la respuesta correcta para Flex y para cualquier
 * fuente desconocida. El llamador no debe tratarlo como error.
 */
export function construirEmailSeguimiento(
  args: ArgsEmailSeguimiento,
): EmailSeguimiento | null {
  // Fail-closed por partida doble: fuente que no conocemos, o fuente cuyo
  // seguimiento lo gobierna un tercero (hoy, Flex).
  if (!esFuenteConocida(args.fuente)) return null;
  if (podLoGobiernaLaFuente(args.fuente)) return null;

  const enCamino = args.momento === "en_camino";

  // El asunto nombra la TIENDA. Y no lleva la hora: se congela en la bandeja.
  const asunto = enCamino
    ? `Tu pedido de ${args.nombreTienda} va en camino`
    : `Tu pedido de ${args.nombreTienda} llegó`;

  // El titular es la respuesta, en el tipo más grande de la pieza. Sin `cuando`
  // no se inventa una hora: se dice el hecho pelado.
  const titular = enCamino
    ? args.cuando
      ? `Llega ${args.cuando}`
      : "Va en camino"
    : args.cuando
      ? `Se entregó ${args.cuando}`
      : "Lo entregamos";

  // El cuerpo es el copy público del estado, palabra por palabra el mismo que
  // muestra `/tracking/[token]`: dos redacciones distintas para el mismo hecho
  // harían dudar de cuál es la buena.
  const cuerpoHtml = enCamino
    ? `<p style="margin:0">${escapar(args.nombreCourier)} lo está entregando. ` +
      `Puedes ver dónde va con el enlace de abajo.</p>`
    : // Regla legal: NUNCA el nombre de quien recibió.
      `<p style="margin:0">Lo recibió alguien en el domicilio.</p>`;

  const html = envolverEmail({
    marca: args.nombreCourier,
    bajadaMarca: enCamino ? "Tu pedido va en camino" : "Tu pedido llegó",
    titular,
    cuerpoHtml,
    // El rótulo en versalitas es el mismo de la tarjeta pública.
    rotuloDatos: "Tu pedido",
    datos: [
      { etiqueta: "Código de envío", valor: args.codigoEnvio, destacada: true },
      { etiqueta: "Comuna", valor: args.comuna },
    ],
    accion: enCamino
      ? { etiqueta: "Seguir mi pedido", url: args.urlSeguimiento }
      : { etiqueta: "Ver el detalle", url: args.urlSeguimiento },
    // ⚠️ El pie explica por qué le llega a alguien que nunca se registró con
    // nosotros. Sin esta frase el correo parece spam de un remitente ajeno.
    motivoRecepcion:
      `Recibes esto porque ${args.nombreTienda} nos pidió entregarte este pedido.`,
    preencabezado: enCamino
      ? `${args.codigoEnvio} · ${args.comuna}`
      : `${args.codigoEnvio} · entregado`,
  });

  return { asunto, html, texto: versionTexto({ ...args, titular, asunto }) };
}

/**
 * La versión en texto plano.
 *
 * No es un accesorio: hay clientes que solo muestran esta parte, y un correo
 * sin ella cae más fácil en spam. Lleva **lo mismo** que el HTML, ni un dato
 * más — si acá se colara la dirección, la regla de arriba quedaría rota por la
 * puerta de atrás.
 */
function versionTexto(
  args: ArgsEmailSeguimiento & { titular: string; asunto: string },
): string {
  return [
    args.nombreCourier,
    "",
    args.titular,
    "",
    `Código de envío: ${args.codigoEnvio}`,
    `Comuna: ${args.comuna}`,
    "",
    `Sigue tu pedido: ${args.urlSeguimiento}`,
    "",
    `Recibes esto porque ${args.nombreTienda} nos pidió entregarte este pedido.`,
    "Despacho gestionado con Rutax.",
  ].join("\n");
}

/** El cuerpo es el único campo que la plantilla NO escapa: acá se escapa. */
function escapar(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
