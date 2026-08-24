import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { puedeGestionarTarifas } from "@/modules/identidad/capacidades";
import { Button } from "@/components/ui/button";
import { obtenerEstadoZonas } from "./actions";
import {
  PantallaConfiguracion,
  SinPermisoConfiguracion,
} from "../_componentes/pantalla-configuracion";
import { PanelZonas } from "./panel-zonas";

export const metadata: Metadata = {
  title: "Zonas y horarios de corte",
};

/**
 * Pantalla de configuración de zonas, comunas y ventanas de corte (F7, ítem 1.2).
 *
 * Ubicada en (tenant)/configuracion/zonas/ (no en onboarding) porque es
 * configuración permanente: el operador la ajusta en cualquier momento del
 * ciclo de vida del courier, no solo al arrancar. El onboarding de tarifas
 * tiene su propio flujo con checklist de activación.
 *
 * RBAC: `gestionar_tarifas` — la misma capacidad que el panel de tarifas,
 * ya que zonas y ventanas de corte son configuración operativa-tarifaria.
 */
export default async function PaginaZonasYCortes() {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    redirect("/login");
  }

  if (!puedeGestionarTarifas(sesion.usuario)) {
    return (
      <SinPermisoConfiguracion frase="Las zonas y los horarios de corte solo los pueden ver y cambiar el dueño de la cuenta o administración." />
    );
  }

  const resultado = await obtenerEstadoZonas();

  if (!resultado.ok) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-3 rounded-lg border border-dashed border-destructive-subtle bg-muted/30 px-6 py-14 text-center">
        <ShieldAlert className="size-8 text-destructive" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-medium text-foreground">Error al cargar la configuración</p>
          <p className="text-sm text-muted-foreground">{resultado.mensaje}</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard">Volver al dashboard</Link>
        </Button>
      </div>
    );
  }

  return (
    <PantallaConfiguracion
      titulo="Zonas y horarios de corte"
      bajada="Cómo agrupas las comunas de la RM y a qué hora cierra cada seller. De acá sale el cálculo de si una entrega same-day llegó a tiempo."
    >
      <PanelZonas estadoInicial={resultado.datos} />
    </PantallaConfiguracion>
  );
}
