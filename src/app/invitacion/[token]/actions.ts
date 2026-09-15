"use server";

/**
 * Server Actions — aceptación de invitación (Pantallas C y J, lado invitado).
 *
 * Capa delgada de "ruta de servidor" sobre la aceptación PASSWORDLESS (Google
 * o código OTP, F3) de seller y equipo interno — `guardarBorradorInvitacion`/
 * `enviarCodigoInvitacion`/`verificarCodigoInvitacion`, al final del archivo,
 * reusando la infra de F1. No duplica la validación de token/expiración/
 * estado — esa vive única y exclusivamente en `aceptarInvitacion`
 * (`@/modules/identidad/invitaciones`), a la que delega SIEMPRE
 * `aplicarAceptacionInvitacionPasswordless`.
 *
 * ⚠️ **El conductor no pasa por ninguna función de este archivo.** Hasta el
 * 2026-09-15 (F4) seguía definiendo un PIN de 6 dígitos con
 * `aceptarInvitacionComoPersonaNueva`, retirada ese día: hoy se invita por
 * TELÉFONO (`crearInvitacion` con `tipoUsuario: 'conductor'`) y entra por
 * WhatsApp OTP desde la app nativa. `page.tsx` intercepta cualquier fila
 * `valida` con `rol === 'conductor'` (solo puede ser una invitación de antes
 * de esa fecha) antes de llegar a un formulario.
 *
 * Por qué `service_role` aquí también: resolver la invitación por token y
 * crear/ubicar el usuario de Auth ocurre ANTES de que exista una sesión con
 * claims del tenant. `aceptarInvitacion` exige un cliente con privilegios
 * suficientes para resolver `invitaciones`/`usuarios_perfil` fuera de RLS
 * normal.
 */

import { createClient } from "@/lib/supabase/server";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from "@/modules/identidad/errores";
import type { Rol } from "@/modules/identidad/roles";
import {
  aplicarAceptacionInvitacionPasswordless,
  buscarInvitacionPorToken,
} from "@/modules/identidad/aceptacion-invitacion-passwordless";
import {
  guardarBorrador as guardarBorradorInvitacionCookie,
} from "@/lib/identidad/borrador-invitacion";

// -----------------------------------------------------------------------------
// 1. Resolver invitación por token — solo lectura, sin mutar nada.
// -----------------------------------------------------------------------------

export type EstadoInvitacionPublica =
  | { estado: "valida"; variante: "persona_nueva" | "persona_existente"; nombreTenant: string; rol: Rol; email: string }
  | { estado: "invalida" }
  | { estado: "expirada"; email: string }
  | { estado: "revocada" }
  | { estado: "ya_aceptada" }
  | { estado: "error" };

/**
 * Réplica de SOLO LECTURA de las comprobaciones que `aceptarInvitacion` hace
 * antes de mutar — necesaria porque `frontend` debe decidir qué pantalla
 * mostrar (persona nueva / ya existe / token inválido / expirado / revocado)
 * SIN gastar el efecto de aceptación. No reemplaza esas comprobaciones — el
 * propio `aceptarInvitacion` las repite de forma autoritativa al confirmar.
 */
export async function resolverInvitacionPorToken(token: string): Promise<EstadoInvitacionPublica> {
  const limpio = token.trim();
  if (!limpio) return { estado: "invalida" };

  try {
    const cliente = crearClienteServiceRole();

    // `.schema("identidad")` obligatorio: se filtra POR `token`, columna
    // ausente en `public.invitaciones` (la vista PostgREST por defecto la
    // omite a propósito desde la migración 20260807000001 — cerró una fuga
    // real). Sin esto, `.eq("token", …)` falla con 42703 y esta pantalla
    // pública ("¿mi invitación es válida?") nunca resuelve. No quitar esto.
    const { data: invitacion, error } = await cliente
      .schema("identidad")
      .from("invitaciones")
      .select("id, tenant_id, email, rol, estado, expira_en")
      .eq("token", limpio)
      .maybeSingle();

    if (error) return { estado: "error" };
    if (!invitacion) return { estado: "invalida" };

    if (invitacion.estado === "revocada") return { estado: "revocada" };
    if (invitacion.estado === "aceptada") return { estado: "ya_aceptada" };
    if (invitacion.estado === "expirada") return { estado: "expirada", email: invitacion.email as string };

    if (new Date(invitacion.expira_en as string).getTime() <= Date.now()) {
      return { estado: "expirada", email: invitacion.email as string };
    }

    const { data: tenant } = await cliente
      .from("tenants")
      .select("nombre_fantasia")
      .eq("id", invitacion.tenant_id)
      .maybeSingle();

    const yaExiste = await existeCuentaConEmail(cliente, invitacion.email as string);

    return {
      estado: "valida",
      variante: yaExiste ? "persona_existente" : "persona_nueva",
      nombreTenant: (tenant?.nombre_fantasia as string | undefined) ?? "el courier que te invitó",
      rol: invitacion.rol as Rol,
      email: invitacion.email as string,
    };
  } catch {
    return { estado: "error" };
  }
}

type ClienteAdmin = ReturnType<typeof crearClienteServiceRole>;

async function existeCuentaConEmail(cliente: ClienteAdmin, email: string): Promise<boolean> {
  const correo = email.trim().toLowerCase();
  // `listUsers` es la única vía estable en esta versión del SDK para resolver
  // "¿existe un usuario de Auth con este correo?" — se usa también para
  // reenvíos (ver `registro/actions.ts`). Nota de la UX (§2.2): NO se usa esto
  // para "verificar antes de invitar" (eso sí filtraría); aquí es DESPUÉS,
  // sobre un token ya válido, exactamente para decidir qué formulario mostrar.
  let pagina = 1;
  const porPagina = 200;
  // Límite defensivo de páginas — evita un bucle indefinido si la API cambia
  // de forma; en la práctica una base de usuarios cabe en pocas páginas.
  for (let intentos = 0; intentos < 25; intentos += 1) {
    const { data, error } = await cliente.auth.admin.listUsers({ page: pagina, perPage: porPagina });
    if (error || !data) return false;
    if (data.users.some((u) => (u.email ?? "").toLowerCase() === correo)) return true;
    if (data.users.length < porPagina) return false;
    pagina += 1;
  }
  return false;
}

// -----------------------------------------------------------------------------
// `aceptarInvitacionComoPersonaNueva` (PIN del conductor) y
// `aceptarInvitacionComoPersonaExistente` (confirmación con contraseña) se
// retiraron el 2026-09-15 (F4, cutover passwordless): el conductor se invita
// por TELÉFONO (`crearInvitacion` con `tipoUsuario: 'conductor'`) y entra por
// WhatsApp OTP desde la app nativa — nunca por este token. `page.tsx`
// intercepta cualquier fila `valida` con `rol === 'conductor'` (solo puede
// ser una invitación vieja) antes de llegar a un formulario. Ningún otro rol
// usaba estas dos funciones: seller/interno ya pasaban por la variante
// PASSWORDLESS de más abajo (F3).
// -----------------------------------------------------------------------------

// =============================================================================
// F3 — Aceptación PASSWORDLESS (Google o código OTP), para seller y equipo
// interno. El CONDUCTOR NO pasa por acá — `buscarInvitacionPorToken` (del
// módulo compartido) trata su token como "no encontrado", así que las tres
// funciones de abajo lo bloquean sin tener que acordarse de filtrarlo cada
// una por su cuenta.
//
// Reusa la infra de F1 (alta de empresa): la misma cookie firmada de un solo
// uso para sobrevivir el viaje a Google (`borrador-invitacion.ts`, molde de
// `borrador-registro.ts`) y el mismo `verifyOtp` para el código. La
// diferencia es que el "borrador" es solo el TOKEN (más el opt-in de
// WhatsApp del seller, si aplica) — a quién pertenece la invitación ya lo
// sabe la fila de `invitaciones`; no hay un formulario de datos que juntar
// antes de resolver la identidad.
// =============================================================================

export interface GuardarBorradorInvitacionOpciones {
  telefonoWhatsApp?: string;
  optInWhatsApp?: boolean;
}

export type GuardarBorradorInvitacionResultado =
  | { ok: true }
  | { ok: false; tipo: "invitacion_invalida"; mensaje: string };

/**
 * Guarda el token (y, si viene, el opt-in de WhatsApp del seller) en la
 * cookie firmada — para el botón "Continuar con Google". Valida que el token
 * siga vigente y que NO sea de un conductor antes de guardar: no tiene
 * sentido sobrevivir el viaje a Google con un token que ya no sirve, o que de
 * todos modos terminaría bloqueado en el callback.
 */
export async function guardarBorradorInvitacion(
  token: string,
  opciones?: GuardarBorradorInvitacionOpciones,
): Promise<GuardarBorradorInvitacionResultado> {
  const limpio = token.trim();
  const estado = await resolverInvitacionPorToken(limpio);
  if (estado.estado !== "valida" || estado.rol === "conductor") {
    return { ok: false, tipo: "invitacion_invalida", mensaje: "Este enlace ya no es válido." };
  }

  await guardarBorradorInvitacionCookie({
    token: limpio,
    optInWhatsApp: opciones?.optInWhatsApp === true ? true : undefined,
    telefonoWhatsApp: opciones?.telefonoWhatsApp?.trim() || undefined,
  });

  return { ok: true };
}

export interface EnviarCodigoInvitacionResultado {
  ok: boolean;
  mensaje: string;
}

/**
 * Envía el código de 6 dígitos al correo DE LA INVITACIÓN — nunca al que
 * mande el cliente: así no hay forma de mandarse un código a un correo ajeno
 * y usarlo para canjear la invitación de otra persona. `shouldCreateUser:
 * true` porque, para esta identidad, puede ser el primer inicio de sesión de
 * toda su vida en Rutax (igual que `enviarCodigoRegistro`, H1 de F1).
 */
export async function enviarCodigoInvitacion(token: string): Promise<EnviarCodigoInvitacionResultado> {
  const admin = crearClienteServiceRole();
  const invitacion = await buscarInvitacionPorToken(admin, token);
  if (!invitacion) {
    return { ok: false, mensaje: "Este enlace ya no es válido." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: invitacion.email,
    options: { shouldCreateUser: true },
  });

  if (error) {
    return { ok: false, mensaje: "No pudimos enviar el código. Intenta de nuevo en unos minutos." };
  }

  return { ok: true, mensaje: `Te enviamos un código a ${invitacion.email}. Dura 10 minutos.` };
}

export interface VerificarCodigoInvitacionOpciones {
  telefonoWhatsApp?: string;
  optInWhatsApp?: boolean;
}

export type VerificarCodigoInvitacionResultado =
  | { ok: true; destino: string }
  | {
      ok: false;
      tipo: "codigo_invalido" | "invitacion_invalida" | "conflicto" | "desconocido";
      mensaje: string;
    };

/**
 * Verifica el código de 6 dígitos contra el correo DE LA INVITACIÓN, y si
 * calza, deja el perfil consistente (`aplicarAceptacionInvitacionPasswordless`,
 * con su idempotencia) y reaplica el WhatsApp si corresponde.
 *
 * El calce de correo es INTRÍNSECO acá — a diferencia del callback de
 * Google, donde la identidad la resuelve un tercero: `verifyOtp` solo puede
 * tener éxito con el MISMO correo al que se le mandó el código (el de la
 * invitación), así que no hace falta un chequeo adicional de "email_no_calza".
 */
export async function verificarCodigoInvitacion(
  token: string,
  codigo: string,
  opciones?: VerificarCodigoInvitacionOpciones,
): Promise<VerificarCodigoInvitacionResultado> {
  const limpio = token.trim();
  const codigoLimpio = codigo.trim();
  if (!limpio || !codigoLimpio) {
    return { ok: false, tipo: "codigo_invalido", mensaje: "Ingresa el código." };
  }

  const admin = crearClienteServiceRole();
  const invitacion = await buscarInvitacionPorToken(admin, limpio);
  if (!invitacion) {
    return { ok: false, tipo: "invitacion_invalida", mensaje: "Este enlace ya no es válido." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({
    type: "email",
    email: invitacion.email,
    token: codigoLimpio,
  });

  if (error || !data.user) {
    return { ok: false, tipo: "codigo_invalido", mensaje: "El código no es válido o venció. Pide uno nuevo." };
  }

  const nombreCompleto =
    typeof data.user.user_metadata?.["nombre_completo"] === "string"
      ? (data.user.user_metadata["nombre_completo"] as string)
      : invitacion.email;

  try {
    const resultado = await aplicarAceptacionInvitacionPasswordless(admin, {
      token: limpio,
      usuarioAuthId: data.user.id,
      nombreCompleto,
      whatsapp: { telefono: opciones?.telefonoWhatsApp, acepta: opciones?.optInWhatsApp === true },
    });

    await supabase.auth.refreshSession();
    return { ok: true, destino: resultado.destino };
  } catch (error2) {
    await supabase.auth.signOut();
    if (error2 instanceof ErrorNoEncontrado) {
      return { ok: false, tipo: "invitacion_invalida", mensaje: "Este enlace ya no es válido." };
    }
    if (error2 instanceof ErrorConflicto) {
      return { ok: false, tipo: "conflicto", mensaje: error2.message };
    }
    if (error2 instanceof ErrorValidacion) {
      return { ok: false, tipo: "invitacion_invalida", mensaje: error2.message };
    }
    return {
      ok: false,
      tipo: "desconocido",
      mensaje: "No pudimos completar la activación por un problema de nuestro sistema. Intenta de nuevo en unos minutos.",
    };
  }
}
