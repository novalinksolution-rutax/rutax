/**
 * Correo de invitación — el que faltaba.
 * =============================================================================
 * Hasta ahora `crearInvitacion` generaba el token, lo auditaba y lo devolvía…
 * y nadie lo entregaba a nadie. La UI prometía "le llegará un correo" y ese
 * correo no existía en ninguna parte del código. Este módulo lo cierra.
 *
 * REGLAS QUE RESPETA:
 *  - **Nunca lanza.** El envío es un efecto secundario: si falla, la invitación
 *    ya quedó creada y sigue siendo canjeable con el botón "Copiar enlace" de
 *    `/sellers`. Un problema de correo JAMÁS debe tumbar el alta de un seller.
 *  - **El token nunca va a la bitácora.** Se registra que se envió (o que no),
 *    a quién y en qué modo — nunca el secreto. Misma regla que `crearInvitacion`.
 *  - **Sandbox por defecto.** El gate lo resuelve `obtenerPuertoEmail()`: sin
 *    `EMAIL_SANDBOX_MODE=false` + `RESEND_API_KEY`, el stub loguea y no envía.
 *    El resultado (`modo: 'stub'`) se propaga hasta la UI para que el courier
 *    vea la verdad y no una promesa vacía.
 *  - **El núcleo no llama APIs externas directo**: todo va por `PuertoEmail`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { obtenerPuertoEmail } from "@/modules/integraciones/notificaciones/email";
import { formatearFecha } from "@/lib/formato-cl";
import { registrarEnBitacora } from "./auditoria";
import { construirEnlaceInvitacion, resolverUrlBaseApp } from "./enlace-invitacion";
import type { TipoUsuarioInvitacion } from "./invitaciones";

/** Forma mínima del cliente que este módulo necesita. */
type ClienteServicio = Pick<SupabaseClient, "auth" | "from">;

/** Nombre de respaldo si no se pudo leer el del courier — nunca dejar el correo sin sujeto. */
const NOMBRE_COURIER_GENERICO = "Tu courier";

export interface ContenidoEmailInvitacion {
  asunto: string;
  html: string;
  texto: string;
}

/**
 * Escapa lo que va incrustado en el HTML del correo. `nombreCourier` sale de la
 * base de datos (lo escribe el courier en su onboarding): sin escapar, un
 * nombre con `<` rompería el correo — y en un cliente de correo permisivo,
 * algo peor.
 */
function escaparHtml(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface ArgsContenido {
  tipoUsuario: TipoUsuarioInvitacion;
  nombreCourier: string;
  urlInvitacion: string;
  expiraEn: string;
}

/**
 * Qué se le dice a cada tipo de invitado. Son tres correos distintos porque son
 * tres personas distintas: el seller es un CLIENTE del courier (hay que
 * explicarle qué es esto y por qué le llega), el interno y el conductor ya
 * saben quién los invitó.
 *
 * Sin jerga: en ningún texto aparece "token", "OAuth", "tenant" ni "invitación
 * pendiente". El seller no tiene por qué saber cómo funciona esto por dentro.
 */
export function construirEmailInvitacion(args: ArgsContenido): ContenidoEmailInvitacion {
  const courier = escaparHtml(args.nombreCourier);
  const vence = formatearFecha(args.expiraEn);
  const url = args.urlInvitacion;

  const cierre =
    `<p style="color:#666;font-size:13px">Este enlace es personal y vence el ${vence}. ` +
    `Si no esperabas este correo, puedes ignorarlo.</p>`;
  const cierreTexto =
    `Este enlace es personal y vence el ${vence}. Si no esperabas este correo, puedes ignorarlo.`;

  const boton =
    `<p><a href="${url}" style="display:inline-block;background:#1e3a5f;color:#fff;` +
    `padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600">` +
    `Crear mi contraseña</a></p>` +
    `<p style="color:#666;font-size:13px">Si el botón no funciona, copia y pega esta dirección:<br>${url}</p>`;

  if (args.tipoUsuario === "seller") {
    return {
      asunto: `${args.nombreCourier} te invitó a su portal de despachos`,
      html:
        `<p>Hola,</p>` +
        `<p><strong>${courier}</strong> despacha tus pedidos y te está dando acceso a su portal. ` +
        `Ahí vas a poder seguir tus envíos en tiempo real, revisar tu estado de cuenta y reportar ` +
        `incidencias sin tener que escribirle a nadie por WhatsApp.</p>` +
        `<p>Para entrar, crea tu contraseña:</p>` +
        boton +
        `<p>Una vez adentro, el primer paso es conectar tu cuenta de Mercado Libre para que tus ` +
        `pedidos lleguen solos al portal.</p>` +
        cierre,
      texto:
        `${args.nombreCourier} despacha tus pedidos y te está dando acceso a su portal. ` +
        `Ahí vas a poder seguir tus envíos, revisar tu estado de cuenta y reportar incidencias.\n\n` +
        `Crea tu contraseña aquí: ${url}\n\n` +
        `Una vez adentro, el primer paso es conectar tu cuenta de Mercado Libre para que tus ` +
        `pedidos lleguen solos al portal.\n\n${cierreTexto}`,
    };
  }

  if (args.tipoUsuario === "conductor") {
    return {
      asunto: `${args.nombreCourier} te invitó a Rutax`,
      html:
        `<p>Hola,</p>` +
        `<p><strong>${courier}</strong> te dio acceso a Rutax, donde vas a ver tu manifiesto del ` +
        `día y tus liquidaciones.</p>` +
        `<p>Para entrar, crea tu contraseña:</p>` +
        boton +
        cierre,
      texto:
        `${args.nombreCourier} te dio acceso a Rutax, donde vas a ver tu manifiesto del día y tus ` +
        `liquidaciones.\n\nCrea tu contraseña aquí: ${url}\n\n${cierreTexto}`,
    };
  }

  return {
    asunto: `${args.nombreCourier} te invitó a su cuenta en Rutax`,
    html:
      `<p>Hola,</p>` +
      `<p><strong>${courier}</strong> te sumó a su equipo en Rutax.</p>` +
      `<p>Para entrar, crea tu contraseña:</p>` +
      boton +
      cierre,
    texto:
      `${args.nombreCourier} te sumó a su equipo en Rutax.\n\n` +
      `Crea tu contraseña aquí: ${url}\n\n${cierreTexto}`,
  };
}

// -----------------------------------------------------------------------------
// Envío
// -----------------------------------------------------------------------------

/** Por qué no se envió, cuando no se envió. Se propaga a la UI y a la bitácora. */
export type MotivoNoEnviado = "sin_url_base" | "stub" | "error_proveedor";

export interface ResultadoEnvioInvitacion {
  enviado: boolean;
  motivo?: MotivoNoEnviado;
}

/** Lee el nombre de fantasía del courier; degrada a genérico si no se puede. */
async function leerNombreCourier(cliente: ClienteServicio, tenantId: string): Promise<string> {
  try {
    const { data } = await cliente
      .from("tenants")
      .select("nombre_fantasia")
      .eq("id", tenantId)
      .maybeSingle();
    const nombre = (data as { nombre_fantasia?: string } | null)?.nombre_fantasia;
    return nombre && nombre.trim() ? nombre.trim() : NOMBRE_COURIER_GENERICO;
  } catch {
    // El doble de prueba de `invitaciones.test.ts` y cualquier fallo transitorio
    // caen acá: el nombre es cosmético, no vale la pena abortar el correo.
    return NOMBRE_COURIER_GENERICO;
  }
}

/**
 * Envía el correo de invitación y deja constancia del resultado en bitácora.
 *
 * NUNCA lanza: cualquier fallo se traduce a `{ enviado: false, motivo }`. El
 * llamador (`crearInvitacion`) ya escribió `invitacion.creada` ANTES de llegar
 * aquí — se respeta el invariante "bitácora antes que efectos externos".
 */
export async function enviarEmailInvitacion(
  cliente: ClienteServicio,
  args: {
    tenantId: string;
    invitacionId: string;
    email: string;
    tipoUsuario: TipoUsuarioInvitacion;
    token: string;
    expiraEn: string;
  },
): Promise<ResultadoEnvioInvitacion> {
  let resultado: ResultadoEnvioInvitacion;

  try {
    const urlBase = resolverUrlBaseApp();
    if (!urlBase) {
      // Sin dominio declarado el enlace saldría muerto. Preferimos no enviar y
      // dejarlo registrado: el courier tiene "Copiar enlace" como salida.
      resultado = { enviado: false, motivo: "sin_url_base" };
    } else {
      const nombreCourier = await leerNombreCourier(cliente, args.tenantId);
      const contenido = construirEmailInvitacion({
        tipoUsuario: args.tipoUsuario,
        nombreCourier,
        urlInvitacion: construirEnlaceInvitacion(urlBase, args.token),
        expiraEn: args.expiraEn,
      });

      const envio = await obtenerPuertoEmail().enviarEmail({
        para: args.email,
        asunto: contenido.asunto,
        html: contenido.html,
        texto: contenido.texto,
      });

      resultado = envio.enviado
        ? { enviado: true }
        : { enviado: false, motivo: envio.modo === "stub" ? "stub" : "error_proveedor" };
    }
  } catch {
    resultado = { enviado: false, motivo: "error_proveedor" };
  }

  // La bitácora del envío no debe poder tumbar el alta tampoco.
  try {
    await registrarEnBitacora(cliente as unknown as SupabaseClient, {
      tenantId: args.tenantId,
      actorUsuarioId: null,
      actorTipo: "sistema",
      accion: resultado.enviado ? "invitacion.email_enviado" : "invitacion.email_no_enviado",
      entidadTipo: "invitacion",
      entidadId: args.invitacionId,
      // Sin token, igual que `invitacion.creada`.
      detalle: { email: args.email, motivo: resultado.motivo ?? null },
    });
  } catch {
    // Sin efecto sobre el resultado: el correo ya se envió (o no) igual.
  }

  return resultado;
}
