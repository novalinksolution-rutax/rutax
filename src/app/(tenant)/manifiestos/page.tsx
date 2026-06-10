/**
 * Lista de manifiestos — Flujo 2
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeGenerarManifiestos } from "@/modules/identidad/capacidades";
import {
  traducirEstadoManifiesto,
  COLOR_ESTADO_MANIFIESTO,
  TEXTO_ESTADO_MANIFIESTO,
} from "@/lib/ui/traduccion-estados";
import { ESTADOS_MANIFIESTO } from "@/modules/operacion/tipos";
import type { Manifiesto, EstadoManifiesto } from "@/modules/operacion/tipos";

interface SearchParams {
  estado?: string;
  conductor?: string;
  fecha?: string;
}

export default async function PaginaManifiestos({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sesion = await obtenerSesionActual();
  if (!sesion) redirect("/login");
  if (!sesion.usuario.tenantId) redirect("/login");

  const params = await searchParams;
  const tenantId = sesion.usuario.tenantId;
  const puedeCrear = puedeGenerarManifiestos(sesion.usuario);

  const filtroEstado = (params.estado as EstadoManifiesto | "") ?? "";
  const filtroFecha = params.fecha ?? "";

  const cliente = crearClienteServiceRole();
  let manifiestos: Manifiesto[] = [];
  let errorCarga = false;

  try {
    let query = cliente
      .from("manifiestos")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("fecha_operacion", { ascending: false })
      .limit(50);

    if (filtroEstado) query = query.eq("estado", filtroEstado);
    if (filtroFecha) query = query.eq("fecha_operacion", filtroFecha);

    const { data, error } = await query;
    if (error) throw error;
    manifiestos = (data ?? []).map((m: Record<string, unknown>) => ({
      id: m.id as string,
      tenantId: m.tenant_id as string,
      driverId: m.driver_id as string,
      nombre: m.nombre as string,
      fechaOperacion: m.fecha_operacion as string,
      estado: m.estado as EstadoManifiesto,
      notas: (m.notas as string | null) ?? null,
      creadoPorUsuarioId: (m.creado_por_usuario_id as string | null) ?? null,
      confirmadoEn: (m.confirmado_en as string | null) ?? null,
      completadoEn: (m.completado_en as string | null) ?? null,
      creadoEn: m.creado_en as string,
      actualizadoEn: m.actualizado_en as string,
    }));
  } catch {
    errorCarga = true;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Manifiestos</h1>
        {puedeCrear && (
          <Link
            href="/manifiestos/nuevo"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="size-4" aria-hidden="true" />
            Nuevo manifiesto
          </Link>
        )}
      </div>

      {/* Filtros */}
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="f-estado-m" className="text-xs font-medium text-muted-foreground">Estado</label>
          <select id="f-estado-m" name="estado" defaultValue={filtroEstado}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">Todos</option>
            {ESTADOS_MANIFIESTO.map((e) => (
              <option key={e} value={e}>{TEXTO_ESTADO_MANIFIESTO[e as EstadoManifiesto]}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-fecha-m" className="text-xs font-medium text-muted-foreground">Fecha de operación</label>
          <input id="f-fecha-m" name="fecha" type="date" defaultValue={filtroFecha}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm" />
        </div>
        <button type="submit"
          className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
          Filtrar
        </button>
        {(filtroEstado || filtroFecha) && (
          <Link href="/manifiestos"
            className="h-9 flex items-center px-3 text-sm text-muted-foreground underline-offset-2 hover:underline">
            Limpiar
          </Link>
        )}
      </form>

      {errorCarga && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          No se pudo cargar la lista de manifiestos.
        </div>
      )}

      {!errorCarga && manifiestos.length === 0 ? (
        <div className="rounded-xl border bg-card px-6 py-12 text-center">
          <p className="text-muted-foreground">No hay manifiestos para los filtros seleccionados.</p>
          {puedeCrear && (
            <Link href="/manifiestos/nuevo"
              className="mt-3 inline-block text-sm font-medium text-primary hover:underline">
              Crear el primero
            </Link>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Lista de manifiestos">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2">Estado</th>
                  <th className="px-4 py-2">Nombre</th>
                  <th className="hidden px-4 py-2 sm:table-cell">Fecha</th>
                  <th className="hidden px-4 py-2 md:table-cell">Conductor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {manifiestos.map((m) => (
                  <tr key={m.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${COLOR_ESTADO_MANIFIESTO[m.estado]}`}>
                        {traducirEstadoManifiesto(m.estado)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/manifiestos/${m.id}`} className="font-medium hover:underline">
                        {m.nombre}
                      </Link>
                    </td>
                    <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
                      {m.fechaOperacion}
                    </td>
                    <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">
                      {m.driverId}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
