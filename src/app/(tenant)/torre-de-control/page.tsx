import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Radar, ShieldAlert } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { puedeVerTorreControl } from "@/modules/identidad/capacidades";
import { Button } from "@/components/ui/button";
import { cargarTablero } from "@/modules/contexto/composer";

export const metadata: Metadata = {
  title: "Torre de control",
};

/**
 * Torre de control — monitoreo del día, por comuna.
 *
 * ⚠️ **Pantalla en reconstrucción (Vía C del rediseño v2).** Lo que hay acá es el
 * mínimo que sostiene la ruta mientras se construye la pantalla: el guard de
 * RBAC y las cifras del día en texto. El mapa, el zoom de tres niveles y el
 * panel de conductores llegan con la Vía C.
 *
 * **La capa de datos ya está terminada** (Vía A): `cargarTablero` devuelve
 * pendientes por comuna en vivo, puntos de entrega con su código de envío,
 * incidencias abiertas, avance por conductor y las olas entrantes. Alcance y
 * decisiones en `docs/torre-de-control/alcance-v2.md`.
 *
 * POR QUÉ ESTÁ EN `(tenant)` Y NO EN `(consola)`. Porque el grupo `(consola)` se
 * retiró entero: la Torre dejó de ser una consola de viewport fijo y pasó a ser
 * un módulo más del SaaS, dentro del `AppShell`, con el mismo sidebar y la misma
 * navegación que cualquier otra pantalla. Con eso la regla del repo deja de tener
 * excepción — *toda* pantalla del courier vive en `(tenant)`.
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

  const torre = await cargarTablero(sesion.usuario.tenantId);
  const { resumen, comunas } = torre;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Radar className="size-4.5 text-muted-foreground" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Torre de control</h1>
          <p className="text-sm text-muted-foreground">
            {resumen.total === 0
              ? "No hay pedidos con compromiso para hoy."
              : `${resumen.pendientes} de ${resumen.total} por entregar`}
          </p>
        </div>
      </div>

      {resumen.sinUbicar > 0 ? (
        // Regla 5 del alcance: el mapa nunca esconde carga. Todavía no hay mapa,
        // pero la regla se cumple igual — lo que no se pudo ubicar se declara.
        <p className="text-sm text-muted-foreground">
          {resumen.sinUbicar}{" "}
          {resumen.sinUbicar === 1 ? "pedido sin ubicar" : "pedidos sin ubicar"} en el mapa.
        </p>
      ) : null}

      {comunas.length > 0 ? (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {comunas.map((comuna) => (
            <li key={comuna.nombre} className="flex items-center justify-between px-4 py-3">
              <span className="text-sm font-medium">{comuna.nombre}</span>
              <span className="text-sm tabular-nums text-muted-foreground">
                {comuna.pendientes} de {comuna.total}
                {comuna.incidenciasAbiertas > 0 ? (
                  // El rojo está reservado a la incidencia abierta: es lo único
                  // accionable de la pantalla.
                  <span className="ml-3 text-destructive">
                    {comuna.incidenciasAbiertas}{" "}
                    {comuna.incidenciasAbiertas === 1 ? "incidencia" : "incidencias"}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="text-xs text-muted-foreground">
        El mapa por comuna y el panel de conductores están en construcción.
      </p>
    </div>
  );
}
