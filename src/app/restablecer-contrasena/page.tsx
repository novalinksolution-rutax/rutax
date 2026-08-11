import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { FormularioRestablecer } from "./formulario-restablecer";

export const metadata: Metadata = {
  title: "Crea tu contraseña nueva",
};

interface PageProps {
  searchParams: Promise<{ error?: string }>;
}

/**
 * Paso 2 de 2 — se llega SOLO a través de `/auth/confirm`, que ya validó el
 * token `type=recovery` y dejó la sesión establecida. Si el enlace estaba
 * vencido o usado, `/auth/confirm` redirige con `?error=enlace_invalido` y
 * mostramos ese estado en vez de un formulario que fallaría al enviarse.
 *
 * No se usa `obtenerSesionActual()` sino `auth.getUser()` a secas, y la
 * diferencia importa: la sesión de recuperación pertenece a alguien que aún
 * no tiene contraseña utilizable, y `obtenerSesionActual` resuelve además el
 * perfil de dominio y sus claims. Aquí basta con saber que Auth reconoce al
 * portador del token — el perfil se consulta después, al registrar en
 * bitácora.
 */
export default async function PaginaRestablecerContrasena({ searchParams }: PageProps) {
  const { error } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const enlaceInvalido = error === "enlace_invalido" || !user;

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted/40 px-4 py-12">
      <FormularioRestablecer enlaceInvalido={enlaceInvalido} />
    </div>
  );
}
