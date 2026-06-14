/**
 * Layout de la PWA del conductor — sin navegación lateral, mobile-first.
 *
 * Verifica que el usuario autenticado es de tipo `conductor` y redirige si no.
 * El contenido se limita a max-w-lg para experiencia de teléfono cómoda.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { RegistrarSW } from "@/components/pwa/registrar-sw";
import { SkipLink } from "@/components/app-shell/skip-link";
import { BotonCerrarSesion } from "@/components/app-shell/boton-cerrar-sesion";

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
      {/* Cabecera mínima de la PWA con navegación */}
      <header className="sticky top-0 z-30 border-b border-border bg-card shadow-sm">
        <div className="mx-auto flex max-w-lg items-center justify-between px-4 py-2">
          <p className="font-heading text-sm font-semibold text-foreground">Mis entregas</p>
          <div className="flex items-center gap-1">
            <nav aria-label="Navegación del conductor" className="flex items-center gap-1">
              <Link
                href="/conductor/manifiesto"
                className="flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Manifiesto
              </Link>
              <Link
                href="/conductor/liquidaciones"
                className="flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Liquidaciones
              </Link>
            </nav>
            <BotonCerrarSesion />
          </div>
        </div>
      </header>

      {/* Contenido mobile-first */}
      <main id="contenido" tabIndex={-1} className="mx-auto max-w-lg px-4 py-4 outline-none">
        {children}
      </main>
    </div>
  );
}
