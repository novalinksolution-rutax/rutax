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

export interface DefinirContrasenaInicialEntrada {
  nombreCompleto: string;
  contrasena: string;
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
    .select("tenant_id, rol")
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
  }

  // Refrescar el JWT para que los claims reflejen `estado_usuario: activo`
  // de inmediato — sin esto, el usuario llegaría al panel de onboarding con
  // una sesión que el hook todavía resuelve como `invitado` (sin capacidades).
  await supabase.auth.refreshSession();

  revalidatePath("/onboarding");
  return { ok: true };
}
