import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { puedeVerTorreControl } from "@/modules/identidad/capacidades";
import { Button } from "@/components/ui/button";
import { cargarTablero } from "@/modules/contexto/composer";
import { Torre } from "./_componentes/torre";

export const metadata: Metadata = {
  title: "Torre de control",
};

/**
 * Torre de control — monitoreo del día, por comuna.
 *
 * El courier opera same-day contra un corte de ~21:00–22:00. Esta pantalla
 * responde una sola pregunta, varias veces al día y en un par de minutos cada
 * vez: **¿cuántos paquetes faltan por entregar, en qué comunas, y hay algo
 * atascado?** El contador baja durante el día; mirarlo es ver si el día cierra.
 *
 * Alcance y decisiones en `docs/torre-de-control/alcance-v2.md`; cómo se ve, en
 * `docs/torre-de-control/lenguaje-visual-v2.md`.
 *
 * POR QUÉ ESTÁ EN `(tenant)` Y NO EN `(consola)`. Porque el grupo `(consola)` se
 * retiró entero: la Torre dejó de ser una consola de viewport fijo y pasó a ser
 * un módulo más del SaaS, dentro del `AppShell`, con el mismo sidebar y la misma
 * navegación que cualquier otra pantalla. Con eso la regla del repo deja de
 * tener excepción — *toda* pantalla del courier vive en `(tenant)`. Lo único
 * propio es el ancho: la ruta está en `rutasAnchas` de `(tenant)/layout.tsx`.
 *
 * RBAC: `ver_torre_control` — dueño, supervisor y coordinador. Es de LECTURA: la
 * Torre no ejecuta, solo muestra y enlaza. Cualquier propuesta de que escriba
 * reabre RBAC y bitácora de auditoría, y es una decisión nueva.
 */
export default async function PaginaTorreDeControl() {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    redirect("/login");
  }

  if (!puedeVerTorreControl(sesion.usuario)) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center justify-center gap-3 px-6 py-14 text-center">
        <ShieldAlert className="size-8 text-muted-foreground" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-medium">No tienes permiso para ver esta sección</p>
          <p className="text-sm text-muted-foreground">
            La Torre de control es para el dueño, el supervisor y el coordinador de tráfico.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/">Volver al inicio</Link>
        </Button>
      </div>
    );
  }

  const estado = await cargarTablero(sesion.usuario.tenantId);

  return <Torre estado={estado} tenantId={sesion.usuario.tenantId} />;
}
