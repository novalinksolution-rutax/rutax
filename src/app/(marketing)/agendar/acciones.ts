"use server";

/**
 * «Agendar una demostración» — el único destino del sitio (regla 80).
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * SEIS CAMPOS, Y NI UNO MÁS
 * -----------------------------------------------------------------------------
 * nombre · courier · WhatsApp · correo · cuántos conductores · de dónde llegan
 * los pedidos.
 *
 * Cada uno se gana su lugar:
 * · **WhatsApp además del correo** — este comprador coordina por WhatsApp.
 *   Pedir solo correo alarga la coordinación tres días.
 * · **Cuántos conductores** — es la unidad con la que se piensa el tamaño del
 *   courier, y **el único campo que califica de verdad**.
 * · **De dónde llegan los pedidos** — define qué se le muestra en la demo. Sin
 *   esto la reunión empieza preguntando lo que el formulario ya pudo saber.
 *
 * **Lo que NO se pide, y es tan decisión como lo que sí:** cargo · tamaño ·
 * facturación · RUT · «cómo nos conociste» · mensaje libre obligatorio · **ni
 * fecha y hora** — el calendario incrustado es la fricción más cara del embudo,
 * porque obliga a decidir una agenda antes de saber si vale la pena.
 *
 * -----------------------------------------------------------------------------
 * DÓNDE ATERRIZA
 * -----------------------------------------------------------------------------
 * En un **correo al equipo**, no en una tabla. No hay CRM, y crear una tabla de
 * prospectos sin nadie que la mire es construir un cementerio: el correo llega a
 * una bandeja que alguien ya revisa todos los días.
 *
 * ⚠️ **Si el correo no sale, la acción FALLA.** No se devuelve un éxito falso:
 * el visitante escribió seis campos y se merece saber que no llegaron, con el
 * teléfono directo. Es lo contrario de la regla que gobierna los correos de
 * dinero —donde el hecho ya ocurrió y el aviso es secundario—: acá **el correo
 * ES el hecho**.
 */

import { envolverEmail } from "@/lib/email/plantilla-email";
import { obtenerPuertoEmail } from "@/modules/integraciones/notificaciones/email/fabrica-email";

export interface DatosAgendar {
  nombre: string;
  courier: string;
  whatsapp: string;
  correo: string;
  conductores: string;
  fuentes: string[];
}

export type ResultadoAgendar =
  | { ok: true }
  | { ok: false; campo?: keyof DatosAgendar; mensaje: string };

/** A dónde llega. Sin variable configurada, la acción lo dice en vez de fallar mudo. */
function destinoEquipo(): string | null {
  const v = process.env.RUTAX_EMAIL_COMERCIAL ?? process.env.RUTAX_EMAIL_SOPORTE;
  return v && v.trim() ? v.trim() : null;
}

const FUENTES_VALIDAS = ["Mercado Libre Flex", "Shopify", "Same-day propio", "Otra"];

export async function accionAgendar(datos: DatosAgendar): Promise<ResultadoAgendar> {
  // La validación es del servidor y no solo del navegador: un formulario que
  // solo valida en el cliente valida para quien no tenía intención de saltárselo.
  const nombre = datos.nombre?.trim() ?? "";
  const courier = datos.courier?.trim() ?? "";
  const whatsapp = datos.whatsapp?.trim() ?? "";
  const correo = datos.correo?.trim() ?? "";
  const conductores = datos.conductores?.trim() ?? "";

  if (nombre.length < 2) {
    return { ok: false, campo: "nombre", mensaje: "Necesitamos tu nombre para saber con quién hablamos." };
  }
  if (courier.length < 2) {
    return { ok: false, campo: "courier", mensaje: "¿Cómo se llama tu courier?" };
  }
  // El correo se valida con una forma mínima y no con una expresión exhaustiva:
  // las expresiones «completas» rechazan correos válidos raros, y el que rebota
  // se descubre igual al mandarlo.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
    return { ok: false, campo: "correo", mensaje: "Revisa el correo: parece incompleto." };
  }
  // Chile: 8 o 9 dígitos, con o sin +56. Se cuentan dígitos en vez de exigir
  // formato — pedirle a alguien que escriba el teléfono «como corresponde» es
  // fricción por nada.
  if (whatsapp.replace(/\D/g, "").length < 8) {
    return { ok: false, campo: "whatsapp", mensaje: "Revisa el número: faltan dígitos." };
  }
  if (!conductores) {
    return { ok: false, campo: "conductores", mensaje: "Aunque sea aproximado, nos sirve." };
  }

  const fuentes = (datos.fuentes ?? []).filter((f) => FUENTES_VALIDAS.includes(f));

  const destino = destinoEquipo();
  if (!destino) {
    // Falla honesta: sin destino configurado el mensaje no llega a ninguna
    // parte, y decir «listo» sería mentir con seis campos escritos de por medio.
    return {
      ok: false,
      mensaje:
        "No pudimos enviar tu solicitud. No es culpa tuya y no se perdió nada: escríbenos directo y te contestamos hoy.",
    };
  }

  try {
    const puerto = obtenerPuertoEmail();
    const resultado = await puerto.enviarEmail({
      para: destino,
      // El asunto lleva lo que califica: el tamaño. Es lo primero que se mira
      // para decidir a qué hora del día se contesta.
      asunto: `Demo · ${courier} · ${conductores} conductores`,
      html: envolverEmail({
        marca: "Rutax",
        titular: `${courier} quiere una demostración`,
        preencabezado: `${nombre} · ${conductores} conductores`,
        cuerpoHtml:
          `<p style="margin:0">Escribió desde el sitio. Coordina por WhatsApp: es como trabaja ` +
          `este comprador, y el correo alarga la coordinación tres días.</p>`,
        datos: [
          { etiqueta: "Nombre", valor: nombre },
          { etiqueta: "Courier", valor: courier },
          { etiqueta: "WhatsApp", valor: whatsapp },
          { etiqueta: "Correo", valor: correo },
          { etiqueta: "Conductores", valor: conductores, destacada: true },
          { etiqueta: "Sus pedidos llegan de", valor: fuentes.join(" · ") || "no lo dijo" },
        ],
        motivoRecepcion: "Recibes este correo porque llegó una solicitud de demostración.",
      }),
      texto:
        `${nombre} (${courier}) pidió una demostración.\n` +
        `WhatsApp: ${whatsapp}\nCorreo: ${correo}\n` +
        `Conductores: ${conductores}\nFuentes: ${fuentes.join(", ") || "no lo dijo"}`,
    });

    if (!resultado.enviado) {
      return {
        ok: false,
        mensaje:
          "No pudimos enviar tu solicitud. No es culpa tuya y no se perdió nada: escríbenos directo y te contestamos hoy.",
      };
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      mensaje:
        "No pudimos enviar tu solicitud. No es culpa tuya y no se perdió nada: escríbenos directo y te contestamos hoy.",
    };
  }
}
