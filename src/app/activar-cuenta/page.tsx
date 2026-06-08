import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { FormularioActivacion } from "./formulario-activacion";

export const metadata: Metadata = {
  title: "Define tu contraseña",
};

interface PageProps {
  searchParams: Promise<{ error?: string }>;
}

/**
 * Pantalla C — "Define tu contraseña" (primer login del dueño, RF-006).
 *
 * Llega aquí solo a través de `/auth/confirm`, que ya estableció la sesión vía
 * `verifyOtp` con el enlace nativo que `inviteUserByEmail` envió. Si no hay
 * sesión (enlace vencido/usado/inválido), `/auth/confirm` redirige con
 * `?error=enlace_invalido` y esta pantalla muestra el estado final correcto
 * en vez de un formulario que fallaría igual al enviarse.
 *
 * El saludo personalizado ("Hola, [nombre]. Estás a un paso de activar
 * [nombre de fantasía]") usa datos que el sistema YA tiene — el nombre del
 * dueño quedó registrado en `crearTenantConDueno` (alta de empresa, Pantalla A)
 * y viaja en `user_metadata`; el nombre de fantasía vive en `tenants`. Pedirlos
 * de nuevo violaría el criterio transversal #4 ("nunca pedir lo que el sistema
 * ya sabe").
 */
export default async function PaginaActivarCuenta({ searchParams }: PageProps) {
  const { error } = await searchParams;
  const enlaceInvalido = error === "enlace_invalido";

  if (enlaceInvalido) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-muted/40 px-4 py-12">
        <FormularioActivacion enlaceInvalido nombreFantasia={null} nombreSugerido={null} />
      </div>
    );
  }

  const sesion = await obtenerSesionActual();

  // Sin sesión y sin marca de error: alguien llegó directo a la URL. No hay
  // nada que activar — lo correcto es enviarlo a iniciar sesión, no mostrar un
  // formulario que fallará al enviarse con "sin sesión".
  if (!sesion) {
    redirect("/login");
  }

  // Si el perfil ya está activo (p. ej. recargó esta pantalla tras activarse,
  // o reutiliza una pestaña vieja), no tiene sentido pedirle contraseña de
  // nuevo — lo mandamos directo a donde ya debería estar.
  if (sesion.usuario.estado === "activo") {
    redirect("/onboarding");
  }

  let nombreFantasia: string | null = null;
  if (sesion.usuario.tenantId) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("tenants")
      .select("nombre_fantasia")
      .eq("id", sesion.usuario.tenantId)
      .maybeSingle();
    nombreFantasia = (data?.nombre_fantasia as string | undefined) ?? null;
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-muted/40 px-4 py-12">
      <FormularioActivacion
        enlaceInvalido={false}
        nombreFantasia={nombreFantasia}
        nombreSugerido={sesion.nombreCompleto}
      />
    </div>
  );
}
