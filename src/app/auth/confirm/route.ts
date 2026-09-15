/**
 * Callback de confirmación de Supabase Auth — recibe el enlace que
 * `auth.admin.inviteUserByEmail` envía al dueño en el alta de empresa
 * (`crearTenantConDueno`, backstage, RF-006).
 *
 * Importante — esto es un mecanismo DISTINTO al de `invitaciones`/
 * `aceptarInvitacion` (Flujo 2/3): la invitación del dueño la emite
 * directamente Supabase Auth (`inviteUserByEmail`), con su propio
 * `token_hash`/`type=invite` en el enlace del correo — no pasa por la tabla
 * de dominio `identidad.invitaciones`. Este route handler es el puente
 * estándar de Supabase (`verifyOtp` con `token_hash`) que establece la
 * sesión.
 *
 * Distinto también de `/auth/callback` (canje PKCE de Google, F1): ese es el
 * retorno de un flujo OAuth; este es el retorno de un ENLACE DE CORREO. Desde
 * F1, este puente es EXCLUSIVO del backstage — el autoservicio de `/registro`
 * ya no manda ningún enlace (entra por Google o por código OTP, verificado
 * inline).
 *
 * 🔴 F1 retiró `/activar-cuenta` (la pantalla "Define tu contraseña"): sin
 * contraseña que definir, no queda ninguna acción del usuario entre "aceptó
 * el enlace" y "puede entrar". Por eso, para `type === "invite"`, este mismo
 * route handler activa el perfil (`activarPerfilDueno`: `estado: invitado →
 * activo` + bitácora `usuario.activado`) antes de redirigir — es la mitad que
 * sobrevive de lo que antes hacía `definirContrasenaInicial` al guardar la
 * contraseña.
 *
 * Si la activación falla (poco probable: el enlace ya se canjeó, la sesión ya
 * existe), se cierra la sesión y se manda a `/login` con un error — nunca se
 * deja una sesión viva con `estado: invitado` navegando hacia el layout del
 * tenant, que la rebotaría a una pantalla que ya no existe.
 */
import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { activarPerfilDueno } from "@/modules/identidad/onboarding";

/**
 * Rutas retiradas en F1 (login sin contraseña). Una plantilla de correo pegada
 * en el panel hosted de Supabase todavía puede traer `next=/activar-cuenta` (la
 * copia canónica del repo ya apunta a `/dashboard`, pero el panel se sincroniza
 * a mano — ver `supabase/templates/README.md`). Si ese `next` llegara tal cual,
 * el usuario aterrizaría en un 404 justo después de activarse. Se neutraliza
 * acá para que la plantilla vieja quede inofensiva sin depender del re-pegado.
 */
const RUTAS_RETIRADAS = new Set(["/activar-cuenta", "/recuperar-contrasena", "/restablecer-contrasena"]);

/**
 * Destino seguro tras el canje: solo rutas internas relativas, nunca una ruta
 * retirada (404) ni un open-redirect a otro origen (`//evil.com`, `https://…`).
 * Ante cualquier duda, la raíz — que el root enruta por rol.
 */
function destinoSeguro(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  const soloRuta = next.split(/[?#]/, 1)[0];
  if (RUTAS_RETIRADAS.has(soloRuta)) return "/";
  return next;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  // Decisión 3 (F1): tras activar, el destino por defecto es la raíz — el
  // root (`src/app/page.tsx`) enruta por rol y manda al dueño a `/dashboard`.
  // La plantilla vigente (`supabase/templates/invite-user.html`) pasa
  // explícitamente `next=/dashboard`, que sigue funcionando igual (mismo
  // destino final para el único perfil que este puente activa).
  const next = destinoSeguro(searchParams.get("next"));

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

    if (!error) {
      if (type === "invite") {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (user) {
          try {
            await activarPerfilDueno(crearClienteServiceRole(), user.id);
            await supabase.auth.refreshSession();
          } catch {
            // No se deja una sesión viva y sin activar navegando hacia el
            // layout del tenant (que hoy solo sabe mandarla a `/login`, ver
            // ese archivo) — se cierra sesión acá mismo y se dice qué pasó.
            await supabase.auth.signOut();
            return NextResponse.redirect(`${origin}/login?error=activacion_fallida`);
          }
        }
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Token inválido/usado/expirado — de vuelta al login con una marca, para
  // distinguir "no llegó token" de "token rechazado por Auth". Ya no hay una
  // Pantalla C propia (`/activar-cuenta`) que sepa presentar este estado.
  return NextResponse.redirect(`${origin}/login?error=enlace_invalido`);
}
