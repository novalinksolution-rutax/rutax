/**
 * Cobranza Fintoc — ticket de un solo uso que autoriza el webhook `link.created`.
 * =============================================================================
 *
 * CONTEXTO (el detalle largo está en la migración
 * `20260926000001_identidad_cobranza_conexiones_pendientes.sql`):
 * el `link_token` de Fintoc llega UNA sola vez y por un solo canal — la
 * notificación que Fintoc dispara al `webhookUrl` del widget en el instante en
 * que se crea el Link. Ese canal NO va firmado (verificado en producción), así
 * que la autorización no puede venir de una firma HMAC: viene de un nonce que
 * generamos nosotros, para ESE tenant, hace menos de 15 minutos, y que deja de
 * servir en cuanto se usa.
 *
 * ⚠️ LAS DOS MITADES, SIEMPRE JUNTAS: `estado = 'pendiente' AND expira_en > now()`.
 * Validar solo por estado convierte un ticket olvidado en una llave eterna.
 *
 * ⚠️ EL NONCE NO ES UN SECRETO. Viaja en un querystring y puede quedar en logs
 * de intermediarios. Por eso no se cifra ni pasa por `secretos_cifrados`: lo que
 * lo hace seguro es el uso único + la vida corta. El `link_token` que llega SÍ
 * es secreto y sigue su camino normal (cifrado, referenciado por
 * `courier_config_cobranza.link_token_ref`); aquí no se guarda jamás.
 *
 * La tabla es deny-all: se toca solo con `service_role` (esta Server Action y el
 * webhook).
 */

import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { resolverUrlBaseApp } from "@/modules/identidad/enlace-invitacion";

/** Ruta del webhook de cobranza por-tenant (la misma que registra el endpoint). */
export function rutaWebhookCobranza(tenantId: string): string {
  return `/api/webhooks/fintoc/${tenantId}`;
}

/** Nombre del query param que transporta el nonce. */
export const PARAM_NONCE_CONEXION = "flow";

export interface ConexionPendienteIniciada {
  /** URL absoluta que se le pasa a `Fintoc.create({ webhookUrl })`. */
  webhookUrl: string;
}

/**
 * Abre un ticket de conexión para el tenant y devuelve el `webhookUrl` con el
 * nonce.
 *
 * Reemplaza cualquier ticket `pendiente` anterior (lo marca `expirado`) ANTES de
 * insertar: la base impone un único pendiente por tenant con un índice único
 * parcial, así que sin este paso abrir el widget dos veces daría 23505. Se
 * invalida en vez de reutilizar a propósito: el nonce viejo pudo quedar en el
 * log de un intermediario, y un ticket nuevo por intento acorta esa ventana.
 */
export async function iniciarConexionPendienteCobranza(args: {
  tenantId: string;
  actorUsuarioId: string | null;
}): Promise<ConexionPendienteIniciada> {
  const urlBase = resolverUrlBaseApp();
  if (!urlBase) {
    // Sin URL pública no hay a dónde mandar la notificación: fallar acá es mejor
    // que abrir el widget y perder el link_token para siempre.
    throw new Error(
      "No está declarada la URL pública de la app (APP_PUBLIC_URL) — no se puede " +
        "armar la URL de notificación de Fintoc.",
    );
  }

  const supabase = crearClienteServiceRole();

  const { error: errorExpirar } = await supabase
    .schema("identidad")
    .from("cobranza_conexiones_pendientes")
    .update({ estado: "expirado" })
    .eq("tenant_id", args.tenantId)
    .eq("estado", "pendiente");

  if (errorExpirar) {
    throw new Error(`No se pudo invalidar el ticket de conexión anterior: ${errorExpirar.message}`);
  }

  const { data, error } = await supabase
    .schema("identidad")
    .from("cobranza_conexiones_pendientes")
    .insert({
      tenant_id: args.tenantId,
      estado: "pendiente",
      actor_usuario_id: args.actorUsuarioId,
    })
    .select("nonce")
    .single();

  if (error || !data?.nonce) {
    throw new Error(
      `No se pudo abrir el ticket de conexión de cobranza: ${error?.message ?? "sin nonce"}`,
    );
  }

  const nonce = data.nonce as string;
  return {
    webhookUrl: `${urlBase}${rutaWebhookCobranza(args.tenantId)}?${PARAM_NONCE_CONEXION}=${nonce}`,
  };
}

export interface ConexionPendienteConsumida {
  /** Quién abrió el widget — va a la bitácora del momento en que aterriza. */
  actorUsuarioId: string | null;
}

/**
 * Reclama el ticket: lo marca `consumido` SOLO si estaba `pendiente`, no vencido,
 * y pertenece a ese tenant. Devuelve `null` si no calza (nonce inexistente,
 * ajeno, ya usado o vencido — los cuatro casos son indistinguibles para quien
 * llama, a propósito).
 *
 * Es un ÚNICO `UPDATE ... WHERE ... RETURNING`: el filtro y la marca ocurren en
 * la misma sentencia, así que dos entregas simultáneas del webhook no pueden
 * ganar las dos. Leer primero y marcar después sería una carrera.
 */
export async function consumirConexionPendienteCobranza(args: {
  tenantId: string;
  nonce: string;
}): Promise<ConexionPendienteConsumida | null> {
  const supabase = crearClienteServiceRole();
  const ahora = new Date().toISOString();

  const { data, error } = await supabase
    .schema("identidad")
    .from("cobranza_conexiones_pendientes")
    .update({ estado: "consumido", consumido_en: ahora })
    .eq("tenant_id", args.tenantId)
    .eq("nonce", args.nonce)
    .eq("estado", "pendiente")
    .gt("expira_en", ahora)
    .select("actor_usuario_id")
    .maybeSingle();

  if (error || !data) return null;
  return { actorUsuarioId: (data.actor_usuario_id as string | null) ?? null };
}

/**
 * Devuelve el ticket a `pendiente` para que Fintoc pueda reintentar.
 *
 * Solo se usa cuando el procesamiento falla en la parte IRRECUPERABLE (cifrar el
 * `link_token` o guardarlo): si el ticket quedara consumido, el reintento de
 * Fintoc chocaría con un 401 y el `link_token` se perdería para siempre — la doc
 * dice que no se puede volver a pedir. Devolver el ticket y responder 500 es lo
 * que hace que el reintento sirva de algo.
 */
export async function devolverConexionPendienteCobranza(args: {
  tenantId: string;
  nonce: string;
}): Promise<void> {
  const supabase = crearClienteServiceRole();
  await supabase
    .schema("identidad")
    .from("cobranza_conexiones_pendientes")
    .update({ estado: "pendiente", consumido_en: null })
    .eq("tenant_id", args.tenantId)
    .eq("nonce", args.nonce)
    .eq("estado", "consumido");
}
