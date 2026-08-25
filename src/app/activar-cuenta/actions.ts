"use server";

/**
 * Server Actions — Pantalla C: "Define tu contraseña" (primer login del
 * dueño, RF-006/RF-007 punto de entrada).
 *
 * Distinto del Flujo 2/3 (`/invitacion/[token]`): aquí la sesión YA existe
 * (la estableció `/auth/confirm` vía `verifyOtp` con el enlace nativo de
 * Supabase Auth que `inviteUserByEmail` envió). Lo único que falta es:
 *   1. que la persona defina su contraseña (`auth.updateUser`), y
 *   2. que su perfil de dominio pase de `invitado` a `activo` — porque
 *      `crearTenantConDueno` lo crea en `invitado` (documentado: "queda
 *      consistente con el hook de claims: cuando acepte la invitación...").
 *
 * Por qué NO se reutiliza `aceptarInvitacion` aquí: esa función resuelve por
 * el token de la tabla `identidad.invitaciones`, que el alta del dueño NUNCA
 * crea (usa el canal nativo de Supabase Auth, ver nota en `onboarding.ts`).
 * Forzar este caso a pasar por `aceptarInvitacion` requeriría inventar una
 * fila de invitación que no existe — más complejidad y un registro falso en
 * una tabla que se audita. La activación del perfil es una transición de UN
 * solo campo (`estado: invitado → activo`) sobre LA PROPIA fila del actor
 * (verificada por `id = auth.uid()`); no es lógica de negocio nueva — es el
 * cierre natural y mínimo de lo que `crearTenantConDueno` dejó pendiente.
 * Queda registrado en bitácora igual que cualquier otra transición de estado.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { mensajeErrorContrasenaAccionable } from "@/modules/identidad/errores-contrasena";
import { normalizarTelefonoE164 } from "@/modules/integraciones/notificaciones/whatsapp";

export interface DefinirContrasenaInicialEntrada {
  nombreCompleto: string;
  contrasena: string;
  /**
   * WhatsApp del seller, opcional. Solo lo manda el formulario cuando quien
   * activa es un seller — un usuario interno o un conductor no tienen dónde
   * escribirlo.
   */
  telefonoWhatsApp?: string;
  /**
   * ⚠️ La casilla de consentimiento. Sin ella el teléfono NO se guarda: un
   * número sin permiso no sirve de nada y tenerlo guardado solo invita a
   * usarlo. Es el propio seller marcándola, que es el respaldo más fuerte que
   * existe ante Meta — y la razón de que este campo viva acá y no en una
   * pantalla del courier.
   */
  aceptaWhatsApp?: boolean;
}

export type DefinirContrasenaResultado =
  | { ok: true }
  | { ok: false; tipo: "validacion" | "sin_sesion" | "desconocido"; mensaje: string };

export async function definirContrasenaInicial(
  entrada: DefinirContrasenaInicialEntrada,
): Promise<DefinirContrasenaResultado> {
  const nombreCompleto = entrada.nombreCompleto.trim();
  if (!nombreCompleto) {
    return { ok: false, tipo: "validacion", mensaje: "Tu nombre completo es obligatorio." };
  }
  if (entrada.contrasena.length < 8) {
    return { ok: false, tipo: "validacion", mensaje: "La contraseña debe tener al menos 8 caracteres." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      tipo: "sin_sesion",
      mensaje: "Este enlace ya no es válido. Si ya activaste tu cuenta, inicia sesión; si no, solicita uno nuevo.",
    };
  }

  const { error: errorPassword } = await supabase.auth.updateUser({
    password: entrada.contrasena,
    data: { nombre_completo: nombreCompleto },
  });

  if (errorPassword) {
    // Mismo criterio que `/restablecer-contrasena`: lo que la persona puede
    // arreglar se le dice; lo demás es un fallo de sistema y así se nombra.
    const accionable = mensajeErrorContrasenaAccionable(errorPassword);
    if (accionable) {
      return { ok: false, tipo: "validacion", mensaje: accionable };
    }

    return {
      ok: false,
      tipo: "desconocido",
      mensaje: "No pudimos guardar tu contraseña por un problema de nuestro sistema. Intenta de nuevo en unos minutos.",
    };
  }

  // Activar el perfil de dominio — única transición que falta para que el
  // hook de claims resuelva tenant_id/rol y el dueño quede operativo.
  // `service_role` porque, hasta este instante, los claims de la sesión
  // recién emitida (antes de este UPDATE) seguían reflejando `invitado`
  // (estado === 'activo' es justo lo que las políticas de escritura propia
  // de `usuarios_perfil` no permiten cambiar — la migración 0001 protege la
  // columna `estado` de auto-edición, por diseño: nadie se autoactiva vía API
  // de datos directa). Acotado a SU PROPIA fila (`id = user.id`) — nunca a
  // otro usuario ni a otro tenant.
  const admin = crearClienteServiceRole();

  const { data: perfilActualizado, error: errorPerfil } = await admin
    .from("usuarios_perfil")
    .update({ estado: "activo", nombre_completo: nombreCompleto })
    .eq("id", user.id)
    .eq("estado", "invitado") // doble candado: solo transiciona desde 'invitado', nunca reactiva a un suspendido
    .select("tenant_id, rol, tipo_usuario, seller_id")
    .maybeSingle();

  if (errorPerfil) {
    return {
      ok: false,
      tipo: "desconocido",
      mensaje: "Guardamos tu contraseña, pero no pudimos activar tu cuenta. Contacta a soporte para terminar la activación.",
    };
  }

  if (perfilActualizado) {
    await registrarEnBitacora(admin, {
      tenantId: perfilActualizado.tenant_id as string | null,
      actorUsuarioId: user.id,
      actorTipo: "usuario",
      accion: "usuario.activado",
      entidadTipo: "usuario_perfil",
      entidadId: user.id,
      detalle: { rol: perfilActualizado.rol, via: "activacion_invitacion_inicial" },
    });

    await guardarWhatsAppDelSeller(admin, {
      perfil: perfilActualizado as PerfilActivado,
      usuarioId: user.id,
      telefono: entrada.telefonoWhatsApp,
      acepta: entrada.aceptaWhatsApp === true,
    });
  }

  // Refrescar el JWT para que los claims reflejen `estado_usuario: activo`
  // de inmediato — sin esto, el usuario llegaría al panel de onboarding con
  // una sesión que el hook todavía resuelve como `invitado` (sin capacidades).
  await supabase.auth.refreshSession();

  revalidatePath("/onboarding");
  return { ok: true };
}

interface PerfilActivado {
  tenant_id: string | null;
  rol: string;
  tipo_usuario: string;
  seller_id: string | null;
}

/**
 * Guarda el WhatsApp que el seller escribió al activar su cuenta.
 * =============================================================================
 * Este es el ORIGEN preferido de todo destinatario de notificaciones: el número
 * lo pone su dueño y el consentimiento lo marca él mismo. Es la razón de que el
 * campo viva en esta pantalla y no en una del courier — hasta el 2026-08-25 era
 * el courier quien AFIRMABA el permiso de otra empresa, que es exactamente lo
 * que este cambio elimina.
 *
 * ⚠️ **BEST-EFFORT: nunca hace fallar la activación.** La persona está entrando
 * a su cuenta por primera vez; dejarla afuera porque no se pudo guardar un
 * teléfono sería desproporcionado. Si algo falla, la activación sigue y el
 * número se puede poner después desde su perfil.
 *
 * Sin consentimiento marcado NO se guarda nada. Un número sin permiso no sirve
 * para nada y tenerlo guardado solo invita a usarlo.
 */
async function guardarWhatsAppDelSeller(
  admin: ReturnType<typeof crearClienteServiceRole>,
  args: {
    perfil: PerfilActivado;
    usuarioId: string;
    telefono: string | undefined;
    acepta: boolean;
  },
): Promise<void> {
  const { perfil, telefono, acepta } = args;

  // Solo sellers: un usuario interno o un conductor no tienen a quién
  // representar, y el modelo exige `seller_id`.
  if (perfil.tipo_usuario !== "seller" || !perfil.seller_id || !perfil.tenant_id) return;
  if (!acepta || !telefono?.trim()) return;

  const normalizado = normalizarTelefonoE164(telefono);
  if (!normalizado.valido) return;

  try {
    const ahora = new Date().toISOString();
    const { error } = await admin
      .schema("integraciones")
      .from("whatsapp_contactos")
      .insert({
        tenant_id: perfil.tenant_id,
        seller_id: perfil.seller_id,
        telefono_e164: normalizado.telefonoE164,
        origen: "perfil_seller",
        opt_in_estado: "otorgado",
        opt_in_en: ahora,
      });

    // 23505 = ya existía (el courier lo cargó antes, o se reintentó la
    // activación). No es un error: el número ya está donde tiene que estar.
    if (error && error.code !== "23505") return;

    await registrarEnBitacora(admin, {
      tenantId: perfil.tenant_id,
      actorUsuarioId: args.usuarioId,
      actorTipo: "usuario",
      accion: "whatsapp.consentimiento_otorgado",
      entidadTipo: "seller",
      entidadId: perfil.seller_id,
      // El teléfono NO va en el detalle: es dato personal y la entidad alcanza
      // para llegar a él por join cuando alguien con permiso lo necesite.
      detalle: { origen: "perfil_seller", via: "activacion_de_cuenta" },
    });
  } catch {
    // Ver la cabecera: la activación ya ocurrió y no se revierte por esto.
  }
}
