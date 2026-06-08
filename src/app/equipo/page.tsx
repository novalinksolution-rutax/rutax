import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { puedeGestionarUsuariosYRoles, puedeInvitarUsuarios, puedeRevocarInvitaciones } from "@/modules/identidad/capacidades";
import { Button } from "@/components/ui/button";
import { obtenerEstadoEquipo } from "./actions";
import { PanelEquipo } from "./panel-equipo";

export const metadata: Metadata = {
  title: "Equipo",
};

/**
 * Pantalla H — Lista de usuarios e invitaciones (RF-005, §2.2).
 *
 * "Una sola tabla con dos grupos visuales" — el dueño/admin necesita ver, en
 * un vistazo, "quién tiene acceso, con qué rol, y qué invitaciones están en
 * el aire" sin ir a buscar en dos lugares distintos. El server component
 * resuelve sesión + capacidades; el panel de cliente arma pestañas/filtro y
 * abre la Pantalla I (formulario de invitación) en un panel lateral.
 */
export default async function PaginaEquipo() {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    redirect("/login");
  }

  if (!puedeGestionarUsuariosYRoles(sesion.usuario)) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-6 py-14 text-center">
        <ShieldAlert className="size-8 text-muted-foreground" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-medium text-foreground">No tienes permiso para ver esta sección</p>
          <p className="text-sm text-muted-foreground">
            La gestión de usuarios y roles solo la pueden ver el dueño de la cuenta o administración.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/onboarding">Volver al panel de activación</Link>
        </Button>
      </div>
    );
  }

  const resultado = await obtenerEstadoEquipo();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Equipo</h1>
          <p className="text-sm text-muted-foreground">
            Quién tiene acceso a tu cuenta, con qué rol, y qué invitaciones siguen pendientes.
          </p>
        </div>
      </div>

      <PanelEquipo
        estadoInicial={resultado.ok ? resultado.estado : null}
        errorInicial={resultado.ok ? null : resultado.mensaje}
        puedeInvitar={puedeInvitarUsuarios(sesion.usuario)}
        puedeRevocar={puedeRevocarInvitaciones(sesion.usuario)}
      />
    </div>
  );
}
