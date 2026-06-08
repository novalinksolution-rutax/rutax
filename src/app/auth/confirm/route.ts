/**
 * Callback de confirmación de Supabase Auth — recibe el enlace que
 * `auth.admin.inviteUserByEmail` envía al dueño en el alta de empresa
 * (`crearTenantConDueno`, Pantalla A→B→C, RF-006).
 *
 * Importante — esto es un mecanismo DISTINTO al de `invitaciones`/
 * `aceptarInvitacion` (Flujo 2/3): la invitación del dueño la emite
 * directamente Supabase Auth (`inviteUserByEmail`), con su propio
 * `token_hash`/`type=invite` en el enlace del correo — no pasa por la tabla
 * de dominio `identidad.invitaciones`. Este route handler es el puente
 * estándar de Supabase (`verifyOtp` con `token_hash`) que establece la
 * sesión y entrega el control a la pantalla "Define tu contraseña" de la
 * cuenta recién activada (`/activar-cuenta`).
 *
 * Sigue el patrón oficial recomendado por Supabase para Next.js App Router
 * (`@supabase/ssr`): el intercambio ocurre en un Route Handler de servidor
 * (no en el cliente) para poder fijar las cookies de sesión antes de
 * redirigir.
 */
import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/activar-cuenta";

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Token inválido/usado/expirado — la propia pantalla de destino (Pantalla C)
  // ya sabe presentar este caso con el copy correcto; redirigimos con una
  // marca para que distinga "no llegó token" de "token rechazado por Auth".
  return NextResponse.redirect(`${origin}/activar-cuenta?error=enlace_invalido`);
}
