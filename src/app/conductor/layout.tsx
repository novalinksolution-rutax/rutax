/**
 * Layout de la PWA del conductor — sin navegación lateral, mobile-first.
 *
 * Verifica que el usuario autenticado es de tipo `conductor` y redirige si no.
 * El contenido se limita a max-w-lg para experiencia de teléfono cómoda.
 */

import { redirect } from "next/navigation";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { RegistrarSW } from "@/components/pwa/registrar-sw";
import { SkipLink } from "@/components/app-shell/skip-link";
import { MenuCuenta } from "@/components/app-shell/menu-cuenta";
import { ConductorNav } from "@/components/app-shell/conductor-nav";

export default async function LayoutConductor({
  children,
}: {
  children: React.ReactNode;
}) {
  const sesion = await obtenerSesionActual();

  if (!sesion) {
    redirect("/login");
  }

  if (sesion.usuario.estado === "invitado") {
    redirect("/activar-cuenta");
  }

  // Solo conductores. Cualquier otro tipo de usuario va a su área correspondiente.
  if (sesion.usuario.tipoUsuario !== "conductor") {
    if (sesion.usuario.tipoUsuario === "seller") {
      redirect("/portal");
    }
    redirect("/");
  }

  if (!sesion.usuario.driverId) {
    redirect("/login");
  }

  return (
    <div className="min-h-svh bg-background">
      <RegistrarSW />
      <SkipLink />
      {/* Cabecera mínima de la PWA: marca + cuenta (tema · cerrar sesión) */}
      <header className="sticky top-0 z-20 border-b border-border bg-card">
        <div className="mx-auto flex max-w-lg items-center justify-between px-4 py-2">
          <p className="font-heading text-sm font-semibold text-foreground">Mis entregas</p>
          <div className="shrink-0">
            <MenuCuenta nombre={sesion.nombreCompleto ?? "Conductor"} subtitulo="Conductor" colapsado lado="bottom" />
          </div>
        </div>
      </header>

      {/* Contenido mobile-first; deja aire abajo para el tab bar fijo */}
      <main id="contenido" tabIndex={-1} className="mx-auto max-w-lg px-4 pt-4 pb-24 outline-none">
        {children}
      </main>

      {/* Navegación inferior táctil */}
      <ConductorNav />
    </div>
  );
}
