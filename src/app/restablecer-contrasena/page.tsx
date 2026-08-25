import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { FormularioRestablecer } from "./formulario-restablecer";
import { MarcoPuerta } from "@/app/login/marco-puerta";

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
    // ⚠️ Mismo marco que el login, no `PantallaSinSesion`: el tablero es
    // explícito —«no es un flujo aparte: es la misma puerta con otro cuerpo»—.
    // El correo se le muestra porque es la única forma de que confirme para qué
    // cuenta está creando la contraseña; sale de la sesión del enlace, así que
    // no confirma nada que quien mira no supiera ya.
    <MarcoPuerta>
      <FormularioRestablecer enlaceInvalido={enlaceInvalido} email={user?.email ?? null} />
    </MarcoPuerta>
  );
}
