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

import type { RolInterno } from "@/modules/identidad/roles";
import { DESCRIPCIONES_ROLES_INTERNOS } from "@/modules/identidad/descripciones-roles";
import type { SupabaseClient } from "@supabase/supabase-js";
import { obtenerPuertoEmail } from "@/modules/integraciones/notificaciones/email";
import { formatearFecha } from "@/lib/formato-cl";
import { envolverEmail } from "@/lib/email/plantilla-email";
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
  /**
   * El rol interno, cuando lo hay. El correo del equipo **tiene que decir qué
   * rol le dieron y qué va a poder hacer**: sin eso, quien lo recibe entra sin
   * saber a qué tiene acceso y lo descubre chocando con lo que no puede.
   */
  rolInterno?: RolInterno | null;
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

  // El pie dice por qué le llega esto y qué hacer si no lo esperaba. Antes era
  // un `<p>` gris al final del cuerpo; ahora es el pie de la plantilla, que es
  // donde el lector lo busca.
  const motivoRecepcion =
    `Este enlace es personal y vence el ${vence}. ` +
    `Si no esperabas este correo, puedes ignorarlo.`;
  const cierreTexto = motivoRecepcion;

  // ⚠️ El botón ya no se arma acá. Era un `<a>` con `display:inline-block` y
  // `background:#1e3a5f` —el navy del sistema retirado—, y Outlook ignora ese
  // `display`, así que llegaba como un enlace suelto sin caja. Lo pone la
  // plantilla, con su fondo declarado dos veces y su enlace de respaldo.
  // ⚠️ **El conductor define un PIN de 6 dígitos, no una contraseña** (decisión
  // del 24-08-2026: un PIN se verifica sin red, y eso es lo que deja que la app
  // se cierre sola sin dejar a nadie fuera de su ruta). El correo decía «Crear
  // mi contraseña» y lo llevaba a una pantalla que le pide seis dígitos: el
  // correo prometía una cosa y el producto hacía otra.
  const esConductor = args.tipoUsuario === "conductor";
  const accion = {
    etiqueta: esConductor ? "Crear mi PIN" : "Crear mi contraseña",
    url,
  };

  if (args.tipoUsuario === "seller") {
    return {
      asunto: `${args.nombreCourier} te invitó a su plataforma de despacho`,
      html: envolverEmail({
        marca: args.nombreCourier,
        titular: `${args.nombreCourier} te dio acceso a su portal`,
        preencabezado: "Crea tu contraseña y conecta tu cuenta de Mercado Libre.",
        cuerpoHtml:
          `<p style="margin:0 0 12px"><strong>${courier}</strong> despacha tus pedidos y te está ` +
          `dando acceso a su portal. Ahí vas a poder seguir tus envíos en tiempo real, revisar tu ` +
          `estado de cuenta y reportar incidencias sin tener que escribirle a nadie por WhatsApp.</p>` +
          `<p style="margin:0">Una vez adentro, el primer paso es conectar tu cuenta de Mercado ` +
          `Libre para que tus pedidos lleguen solos al portal.</p>`,
        accion,
        motivoRecepcion,
      }),
      texto:
        `${args.nombreCourier} despacha tus pedidos y te está dando acceso a su portal. ` +
        `Ahí vas a poder seguir tus envíos, revisar tu estado de cuenta y reportar incidencias.

` +
        `Crea tu contraseña aquí: ${url}

` +
        `Una vez adentro, el primer paso es conectar tu cuenta de Mercado Libre para que tus ` +
        `pedidos lleguen solos al portal.

${cierreTexto}`,
    };
  }

  if (esConductor) {
    // ⚠️ Y el correo tampoco nombra a Rutax en el asunto: para el conductor la
    // relación es con su courier (regla 42). «Te invitó a Rutax» le habla de un
    // software que no conoce; «te dio acceso a su app» le habla de su trabajo.
    return {
      asunto: `${args.nombreCourier} te dio acceso a su app de reparto`,
      html: envolverEmail({
        marca: args.nombreCourier,
        titular: `${args.nombreCourier} te dio acceso a su app`,
        preencabezado: "Crea tu PIN de 6 dígitos para ver tu ruta del día.",
        cuerpoHtml:
          `<p style="margin:0 0 12px"><strong>${courier}</strong> te dio acceso a su app de ` +
          `reparto, donde vas a ver tu ruta del día y tus liquidaciones.</p>` +
          `<p style="margin:0">Entras con un <strong>PIN de 6 dígitos</strong> que eliges tú. Es ` +
          `el que vas a usar cada vez que abras la app, así que elige uno que te acuerdes.</p>`,
        accion,
        motivoRecepcion,
      }),
      texto:
        `${args.nombreCourier} te dio acceso a su app de reparto, donde vas a ver tu ruta del ` +
        `día y tus liquidaciones.

Entras con un PIN de 6 dígitos que eliges tú: ` +
        `es el que vas a usar cada vez que abras la app.

Créalo aquí: ${url}

${cierreTexto}`,
    };
  }

  // ⚠️ **Dice el rol y qué va a poder hacer**, que es lo que el molde pide y lo
  // que faltaba: antes decía «te sumó a su equipo» y nada más. Quien lo recibía
  // entraba sin saber a qué tiene acceso, y lo descubría chocando con lo que no
  // puede — que es la peor forma de enterarse de un permiso.
  //
  // La descripción sale de `DESCRIPCIONES_ROLES_INTERNOS`, el mismo texto que ve
  // quien invita al elegir el rol. Que las dos puntas digan lo mismo no es
  // prolijidad: es lo que impide prometer en el correo algo que el selector no
  // ofrecía.
  const rol = args.rolInterno ? DESCRIPCIONES_ROLES_INTERNOS[args.rolInterno] : null;

  return {
    // «Te sumaron al equipo de X», no «X te invitó a su cuenta en Rutax»: lo que
    // le pasó es que entró a un equipo, y el nombre del software no es la
    // noticia.
    asunto: `Te sumaron al equipo de ${args.nombreCourier}`,
    html: envolverEmail({
      marca: args.nombreCourier,
      titular: `${args.nombreCourier} te sumó a su equipo`,
      preencabezado: rol
        ? `Entras como ${rol.etiqueta.toLowerCase()}. Crea tu contraseña para empezar.`
        : "Crea tu contraseña para entrar.",
      cuerpoHtml: rol
        ? `<p style="margin:0 0 12px"><strong>${courier}</strong> te sumó a su equipo como ` +
          `<strong>${escaparHtml(rol.etiqueta)}</strong>.</p>` +
          `<p style="margin:0">${escaparHtml(rol.descripcion)}</p>`
        : `<p style="margin:0"><strong>${courier}</strong> te sumó a su equipo.</p>`,
      accion,
      motivoRecepcion,
    }),
    texto: rol
      ? `${args.nombreCourier} te sumó a su equipo como ${rol.etiqueta}.

${rol.descripcion}

` +
        `Crea tu contraseña aquí: ${url}

${cierreTexto}`
      : `${args.nombreCourier} te sumó a su equipo.

Crea tu contraseña aquí: ${url}

${cierreTexto}`,
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

/**
 * Deja constancia en la invitación de que el proveedor ACEPTÓ el envío, con su
 * id de mensaje. `email_estado = 'enviado'` es deliberadamente distinto de
 * `'entregado'`: aceptar no es entregar, y esa diferencia es justo la que el
 * webhook viene a resolver después.
 *
 * No lanza: si esta escritura falla, el correo ya salió igual. Lo único que se
 * pierde es la trazabilidad del rebote.
 */
async function marcarEnvioAceptado(
  cliente: ClienteServicio,
  invitacionId: string,
  proveedorId: string,
): Promise<void> {
  try {
    await cliente
      .from("invitaciones")
      .update({
        email_proveedor_id: proveedorId,
        email_estado: "enviado",
        email_estado_en: new Date().toISOString(),
        email_motivo: null,
      })
      .eq("id", invitacionId);
  } catch {
    // Sin efecto sobre el resultado del envío.
  }
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
    rolInterno?: RolInterno | null;
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
        rolInterno: args.rolInterno ?? null,
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

      // Guardar el id del proveedor es lo que hace posible el webhook de
      // entrega/rebote: el webhook trae ESE id, no el de la invitación. Sin
      // esto, un rebote no se puede atribuir a nadie. Se escribe solo cuando el
      // proveedor aceptó — en sandbox no hay id que guardar.
      if (envio.enviado && envio.proveedorId) {
        await marcarEnvioAceptado(cliente, args.invitacionId, envio.proveedorId);
      }
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
