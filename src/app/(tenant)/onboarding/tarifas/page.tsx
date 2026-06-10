import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { puedeGestionarTarifas } from "@/modules/identidad/capacidades";
import { Button } from "@/components/ui/button";
import { obtenerEstadoTarifas } from "./actions";
import { PanelTarifas } from "./panel-tarifas";

export const metadata: Metadata = {
  title: "Tarifas iniciales",
};

/**
 * Pantalla G — Tarifas iniciales (RF-009).
 *
 * Prioriza "una tarifa por defecto en menos de un minuto" (§1.2): el server
 * component resuelve sesión + capacidad + estado, y el panel de cliente separa
 * "lo simple" (tarifa por defecto del tenant) de "lo específico" (overrides
 * por seller/zona, sección colapsada por defecto para no intimidar).
 */
export default async function PaginaTarifas() {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    redirect("/login");
  }

  if (!puedeGestionarTarifas(sesion.usuario)) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-6 py-14 text-center">
        <ShieldAlert className="size-8 text-muted-foreground" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-medium text-foreground">No tienes permiso para ver esta sección</p>
          <p className="text-sm text-muted-foreground">
            Las tarifas solo las pueden ver y gestionar el dueño de la cuenta o administración.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/onboarding">Volver al panel de activación</Link>
        </Button>
      </div>
    );
  }

  const resultado = await obtenerEstadoTarifas();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Tarifas</h1>
        <p className="text-sm text-muted-foreground">
          Define un monto base para empezar a cobrar — podrás ajustar por seller o zona cuando lo necesites.
        </p>
      </div>

      <PanelTarifas estadoInicial={resultado.ok ? resultado.estado : null} errorInicial={resultado.ok ? null : resultado.mensaje} />
    </div>
  );
}
