/**
 * Layout de la PWA del conductor — sin navegación lateral, mobile-first.
 *
 * Verifica que el usuario autenticado es de tipo `conductor` y redirige si no.
 * El contenido se limita a max-w-lg para experiencia de teléfono cómoda.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";

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
      {/* Cabecera mínima de la PWA con navegación */}
      <header className="sticky top-0 z-30 border-b bg-card shadow-sm">
        <div className="mx-auto flex max-w-lg items-center justify-between px-4 py-3">
          <p className="text-sm font-semibold text-foreground">Mis entregas</p>
          <nav aria-label="Navegación del conductor" className="flex items-center gap-3">
            <Link
              href="/conductor/manifiesto"
              className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Manifiesto
            </Link>
            <Link
              href="/conductor/liquidaciones"
              className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Liquidaciones
            </Link>
          </nav>
        </div>
      </header>

      {/* Contenido mobile-first */}
      <main className="mx-auto max-w-lg px-4 py-4">{children}</main>
    </div>
  );
}
