/**
 * Pantalla de gestión de conductores — pool del día (F6, ítem 1.3).
 *
 * Muestra la lista de conductores con sus opciones de configuración:
 *   - Toggle disponible/no-disponible por conductor.
 *   - Editar capacidad de paradas.
 *   - Editar zonas preferentes (multiselect).
 *   - Marcar no disponible + redistribuir (con panel de impacto SLA).
 *
 * El botón "Auto-asignar pendientes del día" que vivía aquí se retiró el
 * 2026-08-12 (Etapa 0 de docs/arquitectura/retiro-y-ruteo-plan.md) — ver el
 * comentario de cabecera de src/modules/operacion/auto-asignacion.ts.
 *
 * Solo accesible con capacidad `asignar_y_reasignar_pedidos`.
 */

import { redirect } from "next/navigation";
import { Users } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import {
  puedeAsignarYReasignarPedidos,
  puedeGestionarLiquidacionesConductores,
} from "@/modules/identidad/capacidades";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { listarConductores } from "@/modules/operacion/conductores";
import { listarZonas } from "@/modules/operacion/zonas";
import { ahoraEnSantiago } from "@/lib/fecha-santiago";
import type { Conductor, Zona } from "@/modules/operacion/tipos";
import { PanelConductores } from "./panel-conductores";

export default async function PaginaConductores() {
  const sesion = await obtenerSesionActual();
  if (!sesion) redirect("/login");
  if (!sesion.usuario.tenantId) redirect("/login");

  if (!puedeAsignarYReasignarPedidos(sesion.usuario)) {
    redirect("/manifiestos");
  }

  const tenantId = sesion.usuario.tenantId;
  const fechaHoy = ahoraEnSantiago().fecha;
  const puedeEditarBanco = puedeGestionarLiquidacionesConductores(sesion.usuario);

  const cliente = crearClienteServiceRole();

  let conductores: Conductor[] = [];
  let zonas: Zona[] = [];
  let errorCarga = false;

  try {
    [conductores, zonas] = await Promise.all([
      listarConductores(cliente, tenantId),
      listarZonas(cliente, tenantId),
    ]);
  } catch {
    errorCarga = true;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Conductores</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Gestiona la disponibilidad, cupo y zonas preferentes del pool del día.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Users className="size-4" aria-hidden="true" />
          <span>
            {conductores.filter((c) => c.estado === "activo").length} activo
            {conductores.filter((c) => c.estado === "activo").length !== 1 ? "s" : ""}
            {" · "}
            {conductores.filter((c) => c.disponible).length} disponible
            {conductores.filter((c) => c.disponible).length !== 1 ? "s" : ""} hoy
          </span>
        </div>
      </div>

      {errorCarga && (
        <div role="alert" className="rounded-lg bg-destructive-subtle px-4 py-3 text-sm text-destructive-subtle-foreground">
          No pudimos cargar los conductores. Intenta recargar la página.
        </div>
      )}

      {!errorCarga && (
        <PanelConductores
          estadoInicial={{ conductores, zonas }}
          fechaHoy={fechaHoy}
          puedeEditarBanco={puedeEditarBanco}
        />
      )}
    </div>
  );
}
