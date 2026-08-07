"use server";

/**
 * Acciones del listado de sellers — hoy solo una: recuperar el enlace de
 * invitación pendiente para entregarlo a mano.
 *
 * POR QUÉ EXISTE: el correo de invitación puede no llegar (cae en spam, el
 * entorno corre en sandbox, el dominio del seller lo rebota). Sin esta salida,
 * un seller que no recibe el correo queda bloqueado y la única forma de
 * destrabarlo es entrar a la base de datos a buscar el token — que es
 * exactamente lo que pasó y por lo que existe este botón.
 *
 * POR QUÉ EL TOKEN SE PIDE AL HACER CLIC Y NO VIENE EN EL HTML DE LA PÁGINA:
 * quien tiene el token ENTRA como ese seller. Renderizar los tokens de todos
 * los sellers pendientes en el listado los dejaría en el HTML, en la caché del
 * navegador y en cualquier extensión que lea el DOM, para una pantalla que se
 * abre a diario. Se entrega uno, bajo demanda, con capacidad verificada y
 * dejando huella en la bitácora.
 */

import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { puedeInvitarUsuarios } from "@/modules/identidad/capacidades";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";

export type EnlaceInvitacionResultado =
  | { ok: true; token: string; email: string; expiraEn: string }
  | { ok: false; mensaje: string };

/**
 * Devuelve el token de la invitación pendiente de un seller para que el cliente
 * arme el enlace con su propio `window.location.origin` (siempre correcto, sin
 * depender de que una variable de entorno esté bien puesta).
 */
export async function obtenerInvitacionPendienteSeller(
  sellerId: string,
): Promise<EnlaceInvitacionResultado> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    return { ok: false, mensaje: "No hay una sesión activa." };
  }
  if (!puedeInvitarUsuarios(sesion.usuario)) {
    return {
      ok: false,
      mensaje: "No tienes permiso para ver enlaces de invitación — contacta al dueño de la cuenta.",
    };
  }

  const tenantId = sesion.usuario.tenantId;
  const cliente = crearClienteServiceRole();

  // El filtro por `tenant_id` es lo que impide que un `sellerId` de otro courier
  // devuelva algo: `service_role` salta RLS, así que el aislamiento acá lo
  // impone esta cláusula y no la base. No quitarla.
  const { data, error } = await cliente
    .from("invitaciones")
    .select("id, token, email, expira_en")
    .eq("seller_id", sellerId)
    .eq("tenant_id", tenantId)
    .eq("estado", "pendiente")
    .order("creado_en", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      mensaje: "No pudimos recuperar el enlace por un problema de nuestro sistema. Intenta de nuevo en unos minutos.",
    };
  }
  if (!data) {
    return {
      ok: false,
      mensaje: "Este seller ya no tiene una invitación pendiente — puede que ya haya entrado.",
    };
  }

  const expiraEn = data.expira_en as string;
  if (new Date(expiraEn).getTime() <= Date.now()) {
    return {
      ok: false,
      mensaje: "Esta invitación venció. Vuelve a invitar al seller para generar una nueva.",
    };
  }

  // Entregar el enlace es dar acceso: queda en bitácora con su autor (RNF-04).
  // El token NUNCA se registra — la BD además lo rechazaría (constraint
  // `bitacora_auditoria_detalle_sin_secretos`).
  await registrarEnBitacora(cliente, {
    tenantId,
    actorUsuarioId: sesion.usuarioId,
    actorTipo: "usuario",
    accion: "invitacion.enlace_entregado",
    entidadTipo: "invitacion",
    entidadId: data.id as string,
    detalle: { seller_id: sellerId, email: data.email as string, via: "copiar_enlace" },
  });

  return {
    ok: true,
    token: data.token as string,
    email: data.email as string,
    expiraEn,
  };
}
