"use server";

/**
 * Server Action — "Crea tu contraseña nueva" (paso 2 de 2 de la recuperación).
 *
 * La sesión YA existe cuando se llega aquí: la estableció `/auth/confirm` con
 * `verifyOtp` sobre el token `type=recovery` del correo. Este action solo
 * cambia la contraseña y deja constancia.
 *
 * Diferencias con `definirContrasenaInicial` (`/activar-cuenta`), que se
 * parece pero NO es lo mismo:
 *   - Aquí NO se toca `usuarios_perfil.estado`. Quien recupera su clave ya
 *     era un usuario activo; reactivar a alguien suspendido por la vía de
 *     "olvidé mi contraseña" sería un agujero de control de acceso.
 *   - Aquí NO se pide el nombre: el sistema ya lo sabe.
 *
 * La bitácora se escribe DESPUÉS del cambio, no antes — a diferencia del
 * patrón de acciones financieras (que registra antes de efectos externos para
 * no perder el rastro si el paso siguiente falla). El motivo es que aquí el
 * efecto es local y verificable: registrar antes dejaría asentado un cambio de
 * contraseña que pudo no ocurrir, y una bitácora que miente es peor que una
 * incompleta. Es el mismo orden que usa `definirContrasenaInicial`.
 */

import { createClient } from "@/lib/supabase/server";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";

export interface RestablecerContrasenaEntrada {
  contrasena: string;
}

export type RestablecerContrasenaResultado =
  | { ok: true }
  | { ok: false; tipo: "validacion" | "sin_sesion" | "desconocido"; mensaje: string };

export async function restablecerContrasena(
  entrada: RestablecerContrasenaEntrada,
): Promise<RestablecerContrasenaResultado> {
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
      mensaje:
        "Este enlace ya no es válido. Los enlaces de recuperación vencen en 1 hora y sirven una sola vez — pide uno nuevo.",
    };
  }

  const { error: errorPassword } = await supabase.auth.updateUser({ password: entrada.contrasena });

  if (errorPassword) {
    return {
      ok: false,
      tipo: "desconocido",
      mensaje: "No pudimos guardar tu contraseña por un problema de nuestro sistema. Intenta de nuevo en unos minutos.",
    };
  }

  // Cambiar la contraseña es una acción de ACCESO: queda en bitácora con su
  // autor (RNF-04). `service_role` solo para leer el tenant del perfil y
  // escribir la fila de auditoría — acotado a la propia fila del actor.
  const admin = crearClienteServiceRole();

  const { data: perfil } = await admin
    .from("usuarios_perfil")
    .select("tenant_id, rol")
    .eq("id", user.id)
    .maybeSingle();

  await registrarEnBitacora(admin, {
    tenantId: (perfil?.tenant_id as string | null) ?? null,
    actorUsuarioId: user.id,
    actorTipo: "usuario",
    accion: "usuario.contrasena_restablecida",
    entidadTipo: "usuario_perfil",
    entidadId: user.id,
    detalle: { rol: perfil?.rol ?? null, via: "recuperacion_email" },
  });

  return { ok: true };
}
