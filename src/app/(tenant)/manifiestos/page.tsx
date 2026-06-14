/**
 * Lista de manifiestos — Flujo 2
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus, Truck } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeGenerarManifiestos } from "@/modules/identidad/capacidades";
import {
  traducirEstadoManifiesto,
  BADGE_ESTADO_MANIFIESTO,
} from "@/lib/ui/traduccion-estados";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable } from "@/components/ui/data-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Manifiesto, EstadoManifiesto } from "@/modules/operacion/tipos";
import { FiltrosManifiestos } from "./filtros-manifiestos";

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
        <h1 className="font-heading text-2xl font-bold">Manifiestos</h1>
        {puedeCrear && (
          <Button asChild>
            <Link href="/manifiestos/nuevo">
              <Plus className="size-4" aria-hidden="true" />
              Nuevo manifiesto
            </Link>
          </Button>
        )}
      </div>

      {/* Filtros */}
      <FiltrosManifiestos
        filtroEstado={filtroEstado}
        filtroFecha={filtroFecha}
        hayFiltros={!!(filtroEstado || filtroFecha)}
      />

      {errorCarga && (
        <div role="alert" className="rounded-lg bg-destructive-subtle px-4 py-3 text-sm text-destructive-subtle-foreground">
          No se pudo cargar la lista de manifiestos.
        </div>
      )}

      {!errorCarga && manifiestos.length === 0 ? (
        <EmptyState
          icon={Truck}
          titulo={
            filtroEstado || filtroFecha
              ? "Ningún manifiesto coincide"
              : "Aún no hay manifiestos"
          }
          descripcion={
            filtroEstado || filtroFecha
              ? "Prueba cambiando el estado o la fecha."
              : "Crea un manifiesto para organizar la ruta del día de un conductor."
          }
          tono={filtroEstado || filtroFecha ? "filtro" : "arranque"}
          accion={
            puedeCrear ? (
              <Button asChild size="sm" variant={filtroEstado || filtroFecha ? "outline" : "default"}>
                <Link href="/manifiestos/nuevo">Crear manifiesto</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        !errorCarga && (
          <DataTable
            toolbar={
              <span className="text-sm text-muted-foreground tabular-nums">
                {manifiestos.length} manifiesto{manifiestos.length !== 1 ? "s" : ""}
              </span>
            }
          >
            <Table densidad="comfortable" aria-label="Lista de manifiestos">
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="px-4">Estado</TableHead>
                  <TableHead className="px-4">Nombre</TableHead>
                  <TableHead className="hidden px-4 sm:table-cell">Fecha</TableHead>
                  <TableHead className="hidden px-4 md:table-cell">Conductor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {manifiestos.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="px-4">
                      <Badge variant={BADGE_ESTADO_MANIFIESTO[m.estado]}>
                        {traducirEstadoManifiesto(m.estado)}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-4">
                      <Link href={`/manifiestos/${m.id}`} className="font-medium hover:underline">
                        {m.nombre}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden px-4 text-muted-foreground sm:table-cell">
                      {m.fechaOperacion}
                    </TableCell>
                    <TableCell className="hidden px-4 text-muted-foreground md:table-cell">
                      {m.driverId}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataTable>
        )
      )}
    </div>
  );
}
