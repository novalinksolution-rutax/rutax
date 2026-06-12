import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import {
  puedeGestionarConfiguracionDte,
  puedeGestionarTarifas,
  puedeVerConciliacion,
} from "@/modules/identidad/capacidades";
import { resolverEstadoOnboarding } from "./estado";
import { PanelOnboarding } from "./panel-onboarding";

export const metadata: Metadata = {
  title: "Onboarding",
};

/**
 * Pantalla D — Panel de onboarding (checklist persistente, RF-006..009).
 *
 * "Centro de mando": el dueño siempre sabe qué falta. NO es un wizard
 * bloqueante (§0 del documento UX) — cada paso es navegable de forma
 * independiente y el dueño puede usar cualquier sección de la app desde el
 * día 1. Esta pantalla nunca está "vacía" (siempre hay 3 pasos que mostrar).
 */
export default async function PaginaOnboarding() {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    redirect("/login");
  }

  const estado = await resolverEstadoOnboarding(sesion.usuario.tenantId);

  return (
    <div className="space-y-6">
      <PanelOnboarding
        estado={estado}
        puedeGestionarDte={puedeGestionarConfiguracionDte(sesion.usuario)}
        puedeGestionarTarifas={puedeGestionarTarifas(sesion.usuario)}
        puedeGestionarCobranza={puedeVerConciliacion(sesion.usuario)}
      />
    </div>
  );
}
