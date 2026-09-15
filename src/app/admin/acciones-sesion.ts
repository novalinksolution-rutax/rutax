"use server";

/**
 * Server Actions de sesión del backstage de plataforma.
 *
 * `iniciarSesionAdmin` (correo+contraseña, F3-A) se retiró el 2026-09-15
 * (F4.d, cutover passwordless): el backstage dejó de tener login propio y el
 * super-admin entra por `/login` como cualquier otro usuario — `/` lo enruta
 * a `/admin/suscripciones` por su `tipo_usuario === 'super_admin'` (ver
 * `src/app/page.tsx`). El gate real (identidad + gobernanza + MFA) sigue
 * siendo `exigirSuperAdmin`/`exigirSuperAdminEscritura`
 * (`@/modules/plataforma/autorizacion-admin`), sin cambios: lo único que
 * desapareció es el formulario que autenticaba con `signInWithPassword`.
 *
 * `cerrarSesionAdmin` hace `signOut()` — cierra la sesión Supabase real (no
 * hay cookies propias del backstage que borrar, F3-A las eliminó).
 *
 * MFA (enrolamiento/step-up TOTP) vive en `./acciones-mfa.ts`.
 */

import { createClient } from "@/lib/supabase/server";

export async function cerrarSesionAdmin(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
}
