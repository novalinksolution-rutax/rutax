"use server";

/**
 * Server Actions de sesión del backstage de plataforma — F3-A.
 *
 * `iniciarSesionAdmin` autentica con Supabase Auth REAL (`signInWithPassword`,
 * server-side, vía `@/lib/supabase/server` — el mismo patrón que
 * `src/app/login`): las cookies de sesión SSR las fija el propio cliente
 * Supabase, no este archivo. Después de un login exitoso a nivel de Auth,
 * valida ADEMÁS que el usuario sea un super-admin ACTIVO de
 * `plataforma.super_admins` (`resolverSuperAdminActivo`, lectura fresca
 * `service_role`) — si no lo es, cierra la sesión recién creada y devuelve un
 * error genérico: tener contraseña válida en `auth.users` NO basta para entrar
 * al backstage (p. ej. cualquier usuario interno de un courier tiene una
 * cuenta Supabase Auth real, pero no es super-admin).
 *
 * `cerrarSesionAdmin` hace `signOut()` — cierra la sesión Supabase real (no
 * hay cookies propias del backstage que borrar, F3-A las eliminó).
 *
 * MFA (enrolamiento/step-up TOTP) vive en `./acciones-mfa.ts`.
 *
 * NUNCA se loguea el email/password ni ningún dato de la sesión.
 */

import { createClient } from "@/lib/supabase/server";
import { resolverSuperAdminActivo } from "@/modules/plataforma/autorizacion-admin";

export async function iniciarSesionAdmin(
  formData: FormData,
): Promise<{ ok: boolean; mensaje?: string }> {
  const email = (formData.get("email") as string | null)?.trim() ?? "";
  const password = (formData.get("password") as string | null) ?? "";

  if (!email || !password) {
    return { ok: false, mensaje: "Ingresa tu correo y tu contraseña." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data?.user) {
    // Mensaje genérico: no revela si el correo existe en `auth.users` ni si
    // la contraseña es la que falló.
    return { ok: false, mensaje: "Credenciales inválidas." };
  }

  // La sesión de Auth ya es válida (cookies SSR fijadas por el propio cliente
  // de arriba). Ahora se exige, ADEMÁS, que sea un super-admin ACTIVO — si no
  // lo es, se cierra la sesión recién creada (fail-closed): un login válido a
  // nivel de Auth (p. ej. un empleado interno de un courier) NUNCA debe dejar
  // una sesión autenticada dentro del backstage.
  let admin: Awaited<ReturnType<typeof resolverSuperAdminActivo>> = null;
  try {
    admin = await resolverSuperAdminActivo(data.user.id);
  } catch {
    admin = null; // fail-closed: cualquier error de lectura = credenciales inválidas
  }

  if (!admin) {
    await supabase.auth.signOut();
    return { ok: false, mensaje: "Credenciales inválidas." };
  }

  return { ok: true };
}

export async function cerrarSesionAdmin(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
}
