/**
 * Layout de la PWA del conductor — sin navegación lateral, mobile-first.
 *
 * Verifica que el usuario autenticado es de tipo `conductor` y redirige si no.
 * El contenido se limita a max-w-lg para experiencia de teléfono cómoda.
 */

import { redirect } from "next/navigation";
import { MapPin } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { obtenerPuntoTerminoPropio } from "@/modules/operacion/punto-termino-conductor";
import { RegistrarSW } from "@/components/pwa/registrar-sw";
import { SkipLink } from "@/components/app-shell/skip-link";
import { MenuCuenta, type EnlaceMenuCuenta } from "@/components/app-shell/menu-cuenta";
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

  if (!sesion.usuario.driverId || !sesion.usuario.tenantId) {
    redirect("/login");
  }

  // Estado corto del punto de término, para la fila del menú de cuenta (§4 del
  // copy: "No configurado" / "Guardado en [Comuna]"). Un fallo acá NUNCA
  // bloquea el shell: el enlace igual se muestra, solo sin subtítulo — es una
  // comodidad de navegación, no una condición de acceso.
  let subtituloPuntoTermino = "No configurado";
  try {
    const punto = await obtenerPuntoTerminoPropio(
      crearClienteServiceRole(),
      sesion.usuario.tenantId,
      sesion.usuario.driverId,
    );
    if (punto) {
      subtituloPuntoTermino = punto.comuna ? `Guardado en ${punto.comuna}` : "Guardado";
    }
  } catch {
    subtituloPuntoTermino = "";
  }

  const enlacesCuenta: EnlaceMenuCuenta[] = [
    {
      href: "/conductor/punto-termino",
      etiqueta: "Punto de término",
      subtitulo: subtituloPuntoTermino || undefined,
      // El ícono va RENDERIZADO, no como componente: esto es servidor y
      // `MenuCuenta` es cliente. Ver la nota en `EnlaceMenuCuenta`.
      icono: <MapPin className="size-4" aria-hidden="true" />,
    },
  ];

  return (
    <div className="min-h-svh bg-background">
      <RegistrarSW />
      <SkipLink />
      {/* Cabecera mínima de la PWA: marca + cuenta (tema · cerrar sesión) */}
      <header className="sticky top-0 z-20 border-b border-border bg-card">
        <div className="mx-auto flex max-w-lg items-center justify-between px-4 py-2">
          <p className="font-heading text-sm font-semibold text-foreground">Mis entregas</p>
          <div className="shrink-0">
            <MenuCuenta
              nombre={sesion.nombreCompleto ?? "Conductor"}
              subtitulo="Conductor"
              colapsado
              lado="bottom"
              enlaces={enlacesCuenta}
            />
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
