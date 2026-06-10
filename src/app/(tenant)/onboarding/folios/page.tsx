import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { puedeGestionarConfiguracionDte } from "@/modules/identidad/capacidades";
import { Button } from "@/components/ui/button";
import { obtenerEstadoFoliosCaf } from "./actions";
import { PanelFoliosCaf } from "./panel-folios-caf";

export const metadata: Metadata = {
  title: "Folios CAF",
};

/**
 * Pantalla F — Folios CAF (RF-008 parte 2).
 *
 * "Se decide en tiempo de ejecución según el proveedor elegido" (§1.2): el
 * server component resuelve sesión + capacidad + estado (incluido el "caso"
 * A/B) y delega a `PanelFoliosCaf`, que renderiza la variante correspondiente
 * sin que el dueño tenga que adivinar cuál de las dos pantallas está viendo.
 */
export default async function PaginaFoliosCaf() {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    redirect("/login");
  }

  if (!puedeGestionarConfiguracionDte(sesion.usuario)) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-6 py-14 text-center">
        <ShieldAlert className="size-8 text-muted-foreground" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-medium text-foreground">No tienes permiso para ver esta sección</p>
          <p className="text-sm text-muted-foreground">
            Los folios CAF solo los pueden ver y gestionar el dueño de la cuenta o administración.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/onboarding">Volver al panel de activación</Link>
        </Button>
      </div>
    );
  }

  const resultado = await obtenerEstadoFoliosCaf();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Folios CAF</h1>
        <p className="text-sm text-muted-foreground">
          Los folios autorizan a tu courier a timbrar documentos tributarios ante el SII.
        </p>
      </div>

      <PanelFoliosCaf estadoInicial={resultado.ok ? resultado.estado : null} errorInicial={resultado.ok ? null : resultado.mensaje} />
    </div>
  );
}
