/**
 * Aceptación de invitación PASSWORDLESS (F3) — pieza compartida entre el
 * callback de Google (`src/app/auth/callback/route.ts`) y las Server Actions
 * de `src/app/invitacion/[token]/actions.ts` (código OTP).
 * =============================================================================
 * F1 le quitó la contraseña al alta de EMPRESA (Google o código OTP, vía
 * `provisionarTenantParaAuthUser`); F3 hace lo mismo para la ACEPTACIÓN de
 * invitación de seller y equipo interno. El CONDUCTOR queda intacto: sigue
 * definiendo su PIN de 6 dígitos vía `aceptarInvitacionComoPersonaNueva`
 * (`invitacion/[token]/actions.ts`) — este módulo lo bloquea explícitamente
 * (ver `buscarInvitacionPorToken`) para que nadie pueda forzar el token de un
 * conductor por este camino.
 *
 * NO reemplaza `aceptarInvitacion` (`identidad/invitaciones.ts`, intocable):
 * sigue siendo la única fuente de verdad de las transiciones de
 * `usuarios_perfil`/`invitaciones`. Lo que agrega es lo que las DOS puertas de
 * entrada passwordless necesitan de más:
 *   - Resolver `email`+`rol` por token, para decidir a quién mandarle el
 *     código o con qué correo verificar el calce (y para bloquear conductor).
 *   - Idempotencia: si la identidad Auth YA tiene perfil (reintento — doble
 *     clic, doble pestaña, o un canje que ya tuvo éxito antes de que la
 *     limpieza de la cookie terminara), NO se reintenta `aceptarInvitacion`
 *     — la invitación ya quedaría `aceptada` y lanzaría `ErrorConflicto`.
 *   - El destino post-aceptación (seller → conectar ML; interno → raíz).
 *   - Reaplicar el WhatsApp del seller, con el mismo criterio best-effort que
 *     el flujo con contraseña (`guardarWhatsAppInvitado`, factorizado desde
 *     `invitacion/[token]/actions.ts` para que ambos flujos compartan una
 *     sola implementación).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { aceptarInvitacion } from "./invitaciones";
import { buscarPerfilPorAuthUserId } from "./onboarding";
import { registrarEnBitacora } from "./auditoria";
import type { Rol } from "./roles";
import { normalizarTelefonoE164 } from "@/modules/integraciones/notificaciones/whatsapp";

/**
 * Forma mínima del cliente `service_role` que este módulo necesita.
 *
 * ⚠️ Enumerado a propósito (no `SupabaseClient` a secas) — mismo gotcha que
 * `onboarding.ts`/`invitaciones.ts`: tiparlo completo hace que un cliente real
 * deje de calzar con este tipo y **tumba el build de producción sin que el
 * typecheck ni las pruebas lo noten** (mordió el 2026-08-25, commit `5f5044f`).
 */
export type ClienteAdminInvitacion = Pick<SupabaseClient, "auth" | "from" | "schema">;

export interface InvitacionPorToken {
  email: string;
  rol: Rol;
}

/**
 * Email + rol de una invitación por token — vía `identidad.invitaciones`
 * (tiene `token`; la vista `public.invitaciones` lo omite a propósito desde
 * la migración 20260807000001). `null` si el token no resuelve nada **o si la
 * invitación es de un conductor** — el conductor no pasa por este módulo, y
 * tratarlo como "no encontrado" es la forma más simple de que ningún llamador
 * tenga que acordarse de filtrarlo por su cuenta.
 */
export async function buscarInvitacionPorToken(
  cliente: ClienteAdminInvitacion,
  token: string,
): Promise<InvitacionPorToken | null> {
  const limpio = token.trim();
  if (!limpio) return null;

  const { data, error } = await cliente
    .schema("identidad")
    .from("invitaciones")
    .select("email, rol")
    .eq("token", limpio)
    .maybeSingle();

  if (error || !data) return null;

  const rol = data.rol as Rol;
  if (rol === "conductor") return null;

  return { email: (data.email as string).trim().toLowerCase(), rol };
}

/** A dónde aterriza tras aceptar: el seller sigue directo a conectar su ML; cualquier interno, a la raíz. */
export function resolverDestinoTrasAceptar(rol: Rol): string {
  return rol === "seller" ? "/portal/conectar-ml" : "/";
}

export interface DatosWhatsAppInvitado {
  telefono?: string;
  acepta?: boolean;
}

export interface ResultadoAceptacionPasswordless {
  tenantId: string | null;
  rol: Rol;
  destino: string;
}

/**
 * Aplica la aceptación de invitación de forma IDEMPOTENTE.
 *
 * Si ya existe perfil para `usuarioAuthId`, NO reintenta `aceptarInvitacion`
 * — con la calce de correo ya garantizado por el llamador (el `verifyOtp`/
 * `exchangeCodeForSession` solo resuelve esa identidad para el correo exacto
 * de la invitación), un perfil preexistente para esta identidad exacta solo
 * puede ser la propia aceptación de esta invitación, hecha en un intento
 * anterior (doble clic, doble pestaña, o una limpieza de cookie que no llegó
 * a completarse).
 */
export async function aplicarAceptacionInvitacionPasswordless(
  cliente: ClienteAdminInvitacion,
  params: {
    token: string;
    usuarioAuthId: string;
    nombreCompleto: string;
    whatsapp?: DatosWhatsAppInvitado;
  },
): Promise<ResultadoAceptacionPasswordless> {
  const perfilExistente = await buscarPerfilPorAuthUserId(cliente, params.usuarioAuthId);

  let tenantId: string | null;
  let rol: Rol;

  if (perfilExistente) {
    tenantId = perfilExistente.tenantId;
    rol = perfilExistente.rol as Rol;
  } else {
    const aceptada = await aceptarInvitacion(cliente, {
      token: params.token,
      usuarioAuthId: params.usuarioAuthId,
      nombreCompleto: params.nombreCompleto,
    });
    tenantId = aceptada.tenantId;
    rol = aceptada.rol;
  }

  if (params.whatsapp) {
    await guardarWhatsAppInvitado(cliente, {
      tenantId,
      usuarioAuthId: params.usuarioAuthId,
      telefono: params.whatsapp.telefono,
      acepta: params.whatsapp.acepta === true,
    });
  }

  return { tenantId, rol, destino: resolverDestinoTrasAceptar(rol) };
}

/**
 * Guarda el WhatsApp que el seller dejó al canjear su invitación.
 * =============================================================================
 * Factorizado desde `guardarWhatsAppDelSellerInvitado`
 * (`invitacion/[token]/actions.ts`) para que el flujo con contraseña y el
 * passwordless compartan una sola implementación — dos copias del mismo
 * `insert` + bitácora terminan discrepando con el tiempo.
 *
 * ⚠️ **BEST-EFFORT: nunca hace fallar la aceptación.** Sin consentimiento
 * marcado (`acepta`) o sin teléfono, no se guarda nada: un número sin permiso
 * no sirve y tenerlo guardado solo invita a usarlo. Solo aplica a sellers —
 * nadie más representa a alguien a quien Rutax le mande avisos de retiro.
 */
export async function guardarWhatsAppInvitado(
  cliente: ClienteAdminInvitacion,
  params: { tenantId: string | null; usuarioAuthId: string; telefono: string | undefined; acepta: boolean },
): Promise<void> {
  if (!params.acepta || !params.telefono?.trim()) return;

  const normalizado = normalizarTelefonoE164(params.telefono);
  if (!normalizado.valido) return;

  try {
    const { data: perfil } = await cliente
      .schema("identidad")
      .from("usuarios_perfil")
      .select("tipo_usuario, seller_id, tenant_id")
      .eq("id", params.usuarioAuthId)
      .maybeSingle();

    // Solo sellers: nadie más representa a alguien a quien Rutax le avise.
    if (!perfil || perfil.tipo_usuario !== "seller" || !perfil.seller_id) return;

    const ahora = new Date().toISOString();
    const { error } = await cliente
      .schema("integraciones")
      .from("whatsapp_contactos")
      .insert({
        tenant_id: (perfil.tenant_id as string) ?? params.tenantId,
        seller_id: perfil.seller_id as string,
        telefono_e164: normalizado.telefonoE164,
        origen: "perfil_seller",
        opt_in_estado: "otorgado",
        opt_in_en: ahora,
      });

    // 23505 = ya existía (se reintentó el canje). No es un error: el número
    // ya está donde tiene que estar.
    if (error && error.code !== "23505") return;

    await registrarEnBitacora(cliente as unknown as SupabaseClient, {
      tenantId: (perfil.tenant_id as string) ?? params.tenantId,
      actorUsuarioId: params.usuarioAuthId,
      actorTipo: "usuario",
      accion: "whatsapp.consentimiento_otorgado",
      entidadTipo: "seller",
      entidadId: perfil.seller_id as string,
      // El teléfono NO va en el detalle: es dato personal.
      detalle: { origen: "perfil_seller", via: "canje_de_invitacion" },
    });
  } catch {
    // Ver la cabecera: la aceptación ya ocurrió y no se revierte por esto.
  }
}
