/**
 * El correo que avisa que una incidencia lleva horas sin que nadie la tome.
 *
 * =============================================================================
 * QUÉ LLEVA, Y SOBRE TODO QUÉ NO
 * =============================================================================
 * Este correo sale del sistema hacia una bandeja de entrada — o sea, hacia un
 * lugar que Rutax no controla, que se reenvía, que se busca por texto y que
 * sobrevive años. Por eso lleva lo MÍNIMO para actuar:
 *
 *   · el código del envío (`RX-…` o el shipment de ML),
 *   · la comuna,
 *   · el tipo de incidencia y cuántas horas lleva,
 *   · un enlace a la ficha del pedido.
 *
 * NUNCA el nombre, la dirección ni el teléfono del destinatario. Es la misma
 * regla que ya rige la Torre de control, y acá pesa más: la Torre se mira dentro
 * de la aplicación, con sesión; un correo, no.
 *
 * Tampoco lleva el `tracking_token`: ese es público y viaja en la URL que se le
 * comparte al destinatario final.
 *
 * =============================================================================
 * EL ENLACE ES LO QUE CONVIERTE EL AVISO EN ACCIÓN
 * =============================================================================
 * Un correo que dice "tienes una incidencia sin gestionar" y no dice cuál
 * obliga a buscarla, y a esa hora el coordinador está haciendo otra cosa. El
 * enlace lleva directo a la ficha, donde están los botones.
 */

import { resolverUrlBaseApp } from "@/modules/identidad/enlace-invitacion";
import { envolverEmail } from "@/lib/email/plantilla-email";

export interface DatosAvisoIncidencia {
  /** `RX-XXXX-XXXX` en same-day o el `ml_shipment_id` en Flex. Nunca el token público. */
  codigoEnvio: string;
  comuna: string;
  /** Etiqueta ya traducida a español ("Destinatario ausente"), no el enum crudo. */
  tipoIncidencia: string;
  horasAbierta: number;
  pedidoId: string;
  nombreCourier: string;
}

export interface ContenidoEmail {
  asunto: string;
  html: string;
  texto: string;
}


export function construirAvisoIncidencia(datos: DatosAvisoIncidencia): ContenidoEmail {
  const horas = Math.round(datos.horasAbierta);
  const urlBase = resolverUrlBaseApp();
  // Sin dominio declarado el enlace saldría muerto: mejor un correo sin enlace
  // que uno con un enlace roto, que además hace dudar de si el aviso es real.
  const enlace = urlBase ? `${urlBase}/operaciones/${datos.pedidoId}` : null;

  const asunto = `Incidencia sin gestionar hace ${horas} h · ${datos.codigoEnvio}`;

  const texto = [
    `Un pedido lleva ${horas} horas con una incidencia abierta y nadie la ha tomado.`,
    "",
    `Envío: ${datos.codigoEnvio}`,
    `Comuna: ${datos.comuna}`,
    `Motivo: ${datos.tipoIncidencia}`,
    "",
    enlace ? `Verlo en Rutax: ${enlace}` : "Búscalo en Rutax, en Operación → Pedidos.",
    "",
    `— Rutax, por ${datos.nombreCourier}`,
  ].join("\n");

  // Antes esto era un `<div>` con `max-width` —que Outlook ignora— y un botón
  // `#1E3A5F`, el navy del sistema retirado, con `display:inline-block`, que
  // Outlook también ignora. Ahora lo arma la plantilla común.
  const html = envolverEmail({
    marca: datos.nombreCourier,
    titular: `Una incidencia lleva ${horas} horas sin gestionar`,
    preencabezado: `${datos.codigoEnvio} · ${datos.comuna}`,
    cuerpoHtml:
      `<p style="margin:0">Un pedido lleva <strong>${horas} horas</strong> con una incidencia ` +
      `abierta y nadie la ha tomado.</p>`,
    datos: [
      { etiqueta: "Envío", valor: datos.codigoEnvio, destacada: true },
      { etiqueta: "Comuna", valor: datos.comuna },
      { etiqueta: "Motivo", valor: datos.tipoIncidencia },
    ],
    ...(enlace ? { accion: { etiqueta: "Ver el pedido", url: enlace } } : {}),
    motivoRecepcion: enlace
      ? `Recibes este aviso porque gestionas incidencias en ${datos.nombreCourier}.`
      : `Recibes este aviso porque gestionas incidencias en ${datos.nombreCourier}. ` +
        `Búscalo en Rutax, en Operación → Pedidos.`,
  });

  return { asunto, html, texto };
}
