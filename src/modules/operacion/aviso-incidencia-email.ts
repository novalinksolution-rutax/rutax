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

function escaparHtml(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

  const html = `
<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:520px;color:#0F172A">
  <p style="font-size:16px;line-height:1.5;margin:0 0 16px">
    Un pedido lleva <strong>${horas} horas</strong> con una incidencia abierta y nadie la ha tomado.
  </p>
  <table style="border-collapse:collapse;font-size:14px;margin:0 0 20px">
    <tr><td style="padding:4px 16px 4px 0;color:#64748B">Envío</td><td style="padding:4px 0"><strong>${escaparHtml(datos.codigoEnvio)}</strong></td></tr>
    <tr><td style="padding:4px 16px 4px 0;color:#64748B">Comuna</td><td style="padding:4px 0">${escaparHtml(datos.comuna)}</td></tr>
    <tr><td style="padding:4px 16px 4px 0;color:#64748B">Motivo</td><td style="padding:4px 0">${escaparHtml(datos.tipoIncidencia)}</td></tr>
  </table>
  ${
    enlace
      ? `<p style="margin:0 0 20px"><a href="${escaparHtml(enlace)}" style="background:#1E3A5F;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block;font-size:14px">Ver el pedido</a></p>`
      : `<p style="margin:0 0 20px;font-size:14px;color:#64748B">Búscalo en Rutax, en Operación → Pedidos.</p>`
  }
  <p style="font-size:12px;color:#94A3B8;margin:0">Rutax, por ${escaparHtml(datos.nombreCourier)}</p>
</div>`.trim();

  return { asunto, html, texto };
}
