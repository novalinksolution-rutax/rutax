import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { cerrarSesion } from "@/lib/identidad/cerrar-sesion";
import { leerIntencion } from "@/lib/identidad/intencion-registro";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { createClient } from "@/lib/supabase/server";
import { MarcaRutax } from "@/components/ui/marca-rutax";
import { nombreDesdeIdentidad } from "@/modules/identidad/registro-empresa";
import { FormularioEmpresa } from "./formulario-empresa";

export const metadata: Metadata = {
  title: "Tu empresa",
};

// Lee sesión y cookie: nunca se sirve de caché.
export const dynamic = "force-dynamic";

/**
 * Registro v2, paso 2 — «Tu empresa».
 * =============================================================================
 * Tres salidas antes de dibujar nada, y ninguna entra en bucle:
 *
 *   · sin sesión              → `/registro` (no hay a quién crearle la empresa);
 *   · con perfil ya creado    → `/puesta-en-marcha` (que manda a `/dashboard` si
 *                               ya está completa). Recargar tras terminar, o
 *                               volver con el botón «atrás», cae acá y sigue;
 *   · sin perfil              → el formulario.
 *
 * El regreso automático (`SesionActual.sinPerfil` en `/`, `/login` y los
 * layouts) apunta a esta ruta, y esta ruta solo deja de mostrarse cuando
 * `sinPerfil` es falso: las dos mitades se miran con la misma lectura en vivo,
 * así que no hay un estado en que cada una mande a la otra.
 */
export default async function PaginaRegistroEmpresa() {
  const sesion = await obtenerSesionActual();
  if (!sesion) redirect("/registro");
  if (!sesion.sinPerfil) {
    redirect(sesion.usuario.tipoUsuario === "interno" && sesion.usuario.tenantId ? "/puesta-en-marcha" : "/");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/registro");

  const pideNombre = nombreDesdeIdentidad(user.user_metadata) === null;
  // Sin intención vigente, el aviso de términos se muestra aquí, junto a «Continuar».
  const avisoVisible = (await leerIntencion()) === null;

  async function accionSalir() {
    "use server";
    await cerrarSesion("/registro");
  }

  return (
    <main className="min-h-svh bg-bg px-4 pt-8 pb-16 sm:px-8 sm:pt-14">
      <div className="mx-auto flex w-full max-w-[560px] flex-col gap-6">
        <div className="flex items-center justify-between">
          <MarcaRutax version="reducida" />
          <form action={accionSalir}>
            <button
              type="submit"
              className="text-sm text-fg-subtle underline underline-offset-4 hover:text-fg pointer-coarse:py-3"
            >
              Salir
            </button>
          </form>
        </div>
        <FormularioEmpresa pideNombre={pideNombre} avisoVisible={avisoVisible} />
      </div>
    </main>
  );
}
