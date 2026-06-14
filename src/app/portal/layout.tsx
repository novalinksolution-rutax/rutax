/**
 * Layout del portal del seller — navegación y shell compartida.
 *
 * Verifica que el usuario autenticado es de tipo `seller`.
 * Incluye la navegación principal del portal, incluyendo el enlace
 * "Estado de cuenta" → /portal/cobros (Fase C).
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { BotonCerrarSesion } from "@/components/app-shell/boton-cerrar-sesion";
import { SkipLink } from "@/components/app-shell/skip-link";

export default async function LayoutPortal({
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
  if (sesion.usuario.tipoUsuario !== "seller" || !sesion.usuario.sellerId) {
    redirect("/");
  }

  const navItems = [
    { href: "/portal", etiqueta: "Inicio" },
    { href: "/portal/pedidos", etiqueta: "Mis pedidos" },
    { href: "/portal/cobros", etiqueta: "Estado de cuenta" },
    { href: "/portal/incidencias", etiqueta: "Incidencias" },
  ];

  return (
    <div className="min-h-svh bg-muted/20">
      <SkipLink />
      {/* Cabecera del portal */}
      <header className="sticky top-0 z-30 border-b border-border bg-card shadow-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <p className="font-heading text-sm font-semibold text-foreground">Portal del seller</p>
          <div className="flex items-center gap-1">
            <nav
              aria-label="Navegación del portal"
              className="hidden items-center gap-1 sm:flex"
            >
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  {item.etiqueta}
                </Link>
              ))}
            </nav>
            <BotonCerrarSesion />
          </div>
        </div>
        {/* Navegación móvil */}
        <nav
          aria-label="Navegación móvil del portal"
          className="flex overflow-x-auto border-t px-4 py-1 sm:hidden"
        >
          <div className="flex gap-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                {item.etiqueta}
              </Link>
            ))}
          </div>
        </nav>
      </header>

      <main id="contenido" tabIndex={-1} className="mx-auto max-w-5xl px-4 py-8 outline-none">
        {children}
      </main>
    </div>
  );
}
