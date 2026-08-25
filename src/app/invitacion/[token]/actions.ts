"use server";

/**
 * Server Actions — aceptación de invitación (Pantallas C y J, lado invitado).
 *
 * Capa delgada de "ruta de servidor": resuelve el caso "persona nueva" vs.
 * "persona ya tiene cuenta" (criterio del documento de UX §2.2 Pantalla J —
 * "el backend resuelve esto vía `usuarioAuthId`") y delega SIEMPRE a
 * `aceptarInvitacion` para dejar `usuarios_perfil` consistente. No duplica
 * la validación de token/expiración/estado — esa vive única y exclusivamente
 * en `aceptarInvitacion`; aquí solo se resuelve "qué formulario mostrar" y
 * "cómo se crea/identifica el usuario de Auth detrás del token".
 *
 * Por qué `service_role` aquí también: resolver la invitación por token y
 * crear/ubicar el usuario de Auth ocurre ANTES de que exista una sesión con
 * claims del tenant (exactamente la situación que `aceptarInvitacion` ya
 * documenta — "el invitado puede no tener todavía sesión"). El propio
 * `aceptarInvitacion` exige un cliente con privilegios suficientes para
 * resolver `invitaciones`/`usuarios_perfil` fuera de RLS normal.
 */

import { createClient } from "@/lib/supabase/server";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { aceptarInvitacion } from "@/modules/identidad/invitaciones";
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from "@/modules/identidad/errores";
import { rechazarPin, TEXTO_RECHAZO } from "@/modules/identidad/pin-conductor";
import type { Rol } from "@/modules/identidad/roles";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { normalizarTelefonoE164 } from "@/modules/integraciones/notificaciones/whatsapp";

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
// 2. Aceptar — caso "persona nueva" (define su contraseña)
// -----------------------------------------------------------------------------

export interface AceptarComoPersonaNuevaEntrada {
  token: string;
  nombreCompleto: string;
  contrasena: string;
  /**
   * WhatsApp del seller, opcional. El formulario solo lo pide cuando la
   * invitación es de tipo `seller` — un interno del courier o un conductor no
   * representan a nadie a quien Rutax le mande avisos de retiro.
   */
  telefonoWhatsApp?: string;
  /**
   * ⚠️ La casilla de consentimiento. Sin ella el teléfono NO se guarda.
   *
   * Vive en ESTA pantalla y no en una del courier porque el permiso lo tiene
   * que dar el interesado. Es el respaldo más fuerte que existe ante Meta, y la
   * razón del rediseño del 2026-08-25.
   *
   * ⚠️ Se puso primero, por error, en `/activar-cuenta` — que es el flujo del
   * DUEÑO del courier, donde `tipo_usuario` nunca es `seller` y el campo no se
   * mostraba jamás. El seller entra por acá, con token. Los dos caminos se
   * parecen y no son el mismo.
   */
  aceptaWhatsApp?: boolean;
}

export type AceptarInvitacionResultado =
  | { ok: true }
  | { ok: false; tipo: "validacion" | "conflicto" | "no_encontrado" | "desconocido"; mensaje: string };

/**
 * Crea el usuario de Auth (ya probó control del correo al llegar con el token
 * válido — `email_confirm: true`) con la contraseña que define, y deja
 * `usuarios_perfil` consistente vía `aceptarInvitacion`.
 */
export async function aceptarInvitacionComoPersonaNueva(
  entrada: AceptarComoPersonaNuevaEntrada,
): Promise<AceptarInvitacionResultado> {
  const nombreCompleto = entrada.nombreCompleto.trim();
  if (!nombreCompleto) {
    return { ok: false, tipo: "validacion", mensaje: "Tu nombre completo es obligatorio." };
  }

  const cliente = crearClienteServiceRole();

  // Releer la invitación para obtener el email exacto — nunca confiar en un
  // valor que el cliente pudo manipular en el formulario.
  //
  // `.schema("identidad")` obligatorio: se filtra POR `token`, ausente en
  // `public.invitaciones` (vista sin `token` desde la migración
  // 20260807000001, a propósito). Sin esto, el SELECT falla con 42703 y nadie
  // puede activar su cuenta como "persona nueva". No quitar esto.
  const { data: invitacion, error: buscarError } = await cliente
    .schema("identidad")
    .from("invitaciones")
    .select("email, rol")
    .eq("token", entrada.token.trim())
    .maybeSingle();

  if (buscarError || !invitacion) {
    return { ok: false, tipo: "no_encontrado", mensaje: "Este enlace ya no es válido." };
  }

  const email = (invitacion.email as string).trim().toLowerCase();

  /**
   * ⚠️ **El conductor define un PIN de 6 dígitos, no una contraseña.**
   *
   * El rol se lee **de la invitación**, no de lo que mandó el formulario: si
   * viniera del cliente, cualquiera podría declararse conductor para saltarse la
   * regla de 8 caracteres y dejar su cuenta con seis dígitos.
   *
   * Y la comprobación vive acá, en el servidor, aunque la pantalla ya la haga:
   * un formulario se salta, una Server Action no. Es la mitad que manda.
   */
  const esConductor = invitacion.rol === "conductor";
  if (esConductor) {
    const problema = rechazarPin(entrada.contrasena);
    if (problema) {
      return { ok: false, tipo: "validacion", mensaje: TEXTO_RECHAZO[problema] };
    }
  } else if (entrada.contrasena.length < 8) {
    return { ok: false, tipo: "validacion", mensaje: "La contraseña debe tener al menos 8 caracteres." };
  }

  const { data: creado, error: crearError } = await cliente.auth.admin.createUser({
    email,
    password: entrada.contrasena,
    email_confirm: true,
    user_metadata: { nombre_completo: nombreCompleto },
  });

  if (crearError || !creado?.user) {
    const mensaje = (crearError?.message ?? "").toLowerCase();
    if (mensaje.includes("already") || mensaje.includes("registered") || mensaje.includes("exists")) {
      return {
        ok: false,
        tipo: "conflicto",
        mensaje: "Ya existe una cuenta con este correo. Intenta iniciar sesión en lugar de crear una nueva.",
      };
    }
    return {
      ok: false,
      tipo: "desconocido",
      mensaje: "No pudimos crear tu cuenta por un problema de nuestro sistema. Intenta de nuevo en unos minutos.",
    };
  }

  return finalizarAceptacion(cliente, entrada.token, creado.user.id, nombreCompleto);
}

// -----------------------------------------------------------------------------
// 3. Aceptar — caso "persona ya tiene cuenta" (confirma, sin pedir contraseña)
// -----------------------------------------------------------------------------

export interface AceptarComoPersonaExistenteEntrada {
  token: string;
}

/**
 * La persona ya tiene cuenta (en este u otro tenant). Si ya inició sesión
 * (mismo correo), aceptamos directo con su `usuarioId` de sesión — la
 * fricción más evitable de todas (criterio #4: nunca pedir un dato que el
 * sistema ya tiene). Si no hay sesión activa con ese correo, le pedimos
 * iniciar sesión primero (no podemos "aceptar en su nombre" sin probar que es
 * efectivamente esa persona).
 */
export async function aceptarInvitacionComoPersonaExistente(
  entrada: AceptarComoPersonaExistenteEntrada,
): Promise<AceptarInvitacionResultado | { ok: false; tipo: "requiere_inicio_sesion"; mensaje: string; email: string }> {
  const cliente = crearClienteServiceRole();

  // `.schema("identidad")` obligatorio: se filtra POR `token`, ausente en
  // `public.invitaciones` (vista sin `token` desde la migración
  // 20260807000001, a propósito). Sin esto, el SELECT falla con 42703 y nadie
  // puede confirmar la invitación como "persona ya existente". No quitar esto.
  const { data: invitacion, error: buscarError } = await cliente
    .schema("identidad")
    .from("invitaciones")
    .select("email")
    .eq("token", entrada.token.trim())
    .maybeSingle();

  if (buscarError || !invitacion) {
    return { ok: false, tipo: "no_encontrado", mensaje: "Este enlace ya no es válido." };
  }

  const emailInvitacion = (invitacion.email as string).trim().toLowerCase();

  const supabaseSesion = await createClient();
  const {
    data: { user: usuarioSesion },
  } = await supabaseSesion.auth.getUser();

  if (!usuarioSesion || (usuarioSesion.email ?? "").trim().toLowerCase() !== emailInvitacion) {
    return {
      ok: false,
      tipo: "requiere_inicio_sesion",
      mensaje: `Esta invitación es para ${emailInvitacion}. Inicia sesión con esa cuenta para aceptarla.`,
      email: emailInvitacion,
    };
  }

  const nombreCompleto =
    typeof usuarioSesion.user_metadata?.["nombre_completo"] === "string"
      ? (usuarioSesion.user_metadata["nombre_completo"] as string)
      : emailInvitacion;

  return finalizarAceptacion(cliente, entrada.token, usuarioSesion.id, nombreCompleto);
}

// -----------------------------------------------------------------------------
// Helper compartido — delega SIEMPRE a `aceptarInvitacion` (única fuente de
// verdad de las transiciones de estado de la invitación y del perfil).
// -----------------------------------------------------------------------------

async function finalizarAceptacion(
  cliente: ClienteAdmin,
  token: string,
  usuarioAuthId: string,
  nombreCompleto: string,
  whatsapp?: { telefono: string | undefined; acepta: boolean },
): Promise<AceptarInvitacionResultado> {
  try {
    const aceptada = await aceptarInvitacion(cliente, {
      token: token.trim(),
      usuarioAuthId,
      nombreCompleto,
    });

    // Después de que el perfil quedó consistente, nunca antes: si el WhatsApp
    // se guardara primero y la aceptación fallara, quedaría un consentimiento
    // colgando de un seller cuya cuenta no llegó a existir.
    if (whatsapp) {
      await guardarWhatsAppDelSellerInvitado(cliente, aceptada, usuarioAuthId, whatsapp);
    }
    return { ok: true };
  } catch (error) {
    if (error instanceof ErrorNoEncontrado) {
      return { ok: false, tipo: "no_encontrado", mensaje: "Este enlace ya no es válido." };
    }
    if (error instanceof ErrorConflicto) {
      return { ok: false, tipo: "conflicto", mensaje: error.message };
    }
    if (error instanceof ErrorValidacion) {
      return { ok: false, tipo: "validacion", mensaje: error.message };
    }
    return {
      ok: false,
      tipo: "desconocido",
      mensaje: "No pudimos completar la activación por un problema de nuestro sistema. Intenta de nuevo en unos minutos.",
    };
  }
}

/**
 * Guarda el WhatsApp que el seller escribió al canjear su invitación.
 * =============================================================================
 * Este es el ORIGEN preferido de todo destinatario de notificaciones: el número
 * lo pone su dueño y el consentimiento lo marca él mismo. Es la razón de que el
 * campo viva acá y no en una pantalla del courier — hasta el 2026-08-25 era el
 * courier quien AFIRMABA el permiso de otra empresa.
 *
 * ⚠️ **BEST-EFFORT: nunca hace fallar la activación.** La persona está entrando
 * a su cuenta por primera vez; dejarla afuera porque no se pudo guardar un
 * teléfono sería desproporcionado. Si falla, lo pone después en «Mi perfil».
 *
 * Sin consentimiento marcado NO se guarda nada: un número sin permiso no sirve
 * y tenerlo guardado solo invita a usarlo.
 *
 * El tipo y el seller se leen del PERFIL ya escrito, no de la invitación: es la
 * única fuente que refleja lo que de verdad quedó en base tras el upsert.
 */
async function guardarWhatsAppDelSellerInvitado(
  cliente: ClienteAdmin,
  aceptada: { tenantId: string },
  usuarioAuthId: string,
  whatsapp: { telefono: string | undefined; acepta: boolean },
): Promise<void> {
  if (!whatsapp.acepta || !whatsapp.telefono?.trim()) return;

  const normalizado = normalizarTelefonoE164(whatsapp.telefono);
  if (!normalizado.valido) return;

  try {
    const { data: perfil } = await cliente
      .schema("identidad")
      .from("usuarios_perfil")
      .select("tipo_usuario, seller_id, tenant_id")
      .eq("id", usuarioAuthId)
      .maybeSingle();

    // Solo sellers: nadie más representa a alguien a quien Rutax le avise.
    if (!perfil || perfil.tipo_usuario !== "seller" || !perfil.seller_id) return;

    const ahora = new Date().toISOString();
    const { error } = await cliente
      .schema("integraciones")
      .from("whatsapp_contactos")
      .insert({
        tenant_id: (perfil.tenant_id as string) ?? aceptada.tenantId,
        seller_id: perfil.seller_id as string,
        telefono_e164: normalizado.telefonoE164,
        origen: "perfil_seller",
        opt_in_estado: "otorgado",
        opt_in_en: ahora,
      });

    // 23505 = ya existía (se reintentó el canje). No es un error: el número ya
    // está donde tiene que estar.
    if (error && error.code !== "23505") return;

    await registrarEnBitacora(cliente, {
      tenantId: (perfil.tenant_id as string) ?? aceptada.tenantId,
      actorUsuarioId: usuarioAuthId,
      actorTipo: "usuario",
      accion: "whatsapp.consentimiento_otorgado",
      entidadTipo: "seller",
      entidadId: perfil.seller_id as string,
      // El teléfono NO va en el detalle: es dato personal.
      detalle: { origen: "perfil_seller", via: "canje_de_invitacion" },
    });
  } catch {
    // Ver la cabecera: la activación ya ocurrió y no se revierte por esto.
  }
}
