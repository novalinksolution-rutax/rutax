/**
 * Incidencias del seller — Pantalla portal/incidencias (Flujo 4, Fase B)
 *
 * Server Component. Solo lectura — sin acciones de cambio de estado.
 * RLS garantiza el aislamiento por seller.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, SearchX } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  traducirTipoIncidencia,
  traducirEstadoIncidencia,
  BADGE_ESTADO_INCIDENCIA,
  esIncidenciaSinGestion,
  horasDesde,
} from "@/lib/ui/traduccion-estados";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable } from "@/components/ui/data-table";
import { Pagination } from "@/components/ui/pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Incidencia, TipoIncidencia, EstadoIncidencia } from "@/modules/operacion/tipos";
import { FiltrosIncidenciasSeller } from "./filtros-incidencias-seller";

export const metadata: Metadata = {
  title: "Mis incidencias",
};

const LIMITE = 25;

interface SearchParams {
  tipo?: string;
  estado?: string;
  pagina?: string;
}

export default async function PaginaIncidenciasSeller({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) redirect("/login");
  if (sesion.usuario.tipoUsuario !== "seller" || !sesion.usuario.sellerId) redirect("/portal");

  const params = await searchParams;
  const sellerId = sesion.usuario.sellerId;
  const tenantId = sesion.usuario.tenantId;

  const filtroTipo = (params.tipo as TipoIncidencia | "") ?? "";
  const filtroEstado = (params.estado as EstadoIncidencia | "") ?? "";
  const pagina = Math.max(1, parseInt(params.pagina ?? "1", 10));
  const offset = (pagina - 1) * LIMITE;

  const cliente = crearClienteServiceRole();
  let incidencias: Incidencia[] = [];
  let total = 0;
  let errorCarga = false;

  try {
    let query = cliente
      .from("incidencias")
      .select("*", { count: "exact" })
      .eq("seller_id", sellerId)
      .eq("tenant_id", tenantId)
      .order("abierta_en", { ascending: false })
      .range(offset, offset + LIMITE - 1);

    if (filtroTipo) query = query.eq("tipo", filtroTipo);
    if (filtroEstado) query = query.eq("estado", filtroEstado);

    const { data, error, count } = await query;
    if (error) throw error;

    total = count ?? 0;
    incidencias = (data ?? []).map((inc: Record<string, unknown>) => ({
      id: inc.id as string,
      tenantId: inc.tenant_id as string,
      pedidoId: inc.pedido_id as string,
      sellerId: inc.seller_id as string,
      tipo: inc.tipo as TipoIncidencia,
      estado: inc.estado as EstadoIncidencia,
      descripcion: (inc.descripcion as string | null) ?? null,
      notasResolucion: (inc.notas_resolucion as string | null) ?? null,
      afectaCobro: (inc.afecta_cobro as boolean) ?? false,
      afectaLiquidacion: (inc.afecta_liquidacion as boolean) ?? false,
      abiertaPorUsuarioId: (inc.abierta_por_usuario_id as string | null) ?? null,
      resueltaPorUsuarioId: (inc.resuelta_por_usuario_id as string | null) ?? null,
      abiertaEn: inc.abierta_en as string,
      resueltaEn: (inc.resuelta_en as string | null) ?? null,
      creadoEn: inc.creado_en as string,
      actualizadoEn: inc.actualizado_en as string,
    }));
  } catch {
    errorCarga = true;
  }

  const hayFiltros = !!(filtroTipo || filtroEstado);
  const totalPaginas = Math.ceil(total / LIMITE);

  function urlConFiltros(overrides: Record<string, string>) {
    const sp = new URLSearchParams();
    if (filtroTipo) sp.set("tipo", filtroTipo);
    if (filtroEstado) sp.set("estado", filtroEstado);
    if (pagina > 1) sp.set("pagina", String(pagina));
    Object.entries(overrides).forEach(([k, v]) => {
      if (v) sp.set(k, v);
      else sp.delete(k);
    });
    const s = sp.toString();
    return `/portal/incidencias${s ? `?${s}` : ""}`;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Mis incidencias</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Incidencias registradas en tus pedidos. Solo lectura.
        </p>
      </div>

      {/* Filtros */}
      <FiltrosIncidenciasSeller
        filtroTipo={filtroTipo}
        filtroEstado={filtroEstado}
        hayFiltros={hayFiltros}
      />

      {/* Error */}
      {errorCarga && (
        <div role="alert" className="rounded-lg bg-destructive-subtle px-4 py-3 text-sm text-destructive-subtle-foreground">
          No se pudo cargar la lista de incidencias. Intenta recargar la página.
        </div>
      )}

      {/* Tabla / estados de vista */}
      {!errorCarga && incidencias.length === 0 ? (
        hayFiltros ? (
          <EmptyState
            icon={SearchX}
            tono="filtro"
            titulo="Ninguna incidencia coincide"
            descripcion="No hay incidencias con estos filtros. Prueba cambiando el tipo o el estado."
            accion={
              <Button asChild variant="outline" size="sm">
                <Link href="/portal/incidencias">Limpiar filtros</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={CheckCircle2}
            tono="buen-estado"
            titulo="Sin incidencias — todo va bien"
            descripcion="No hay incidencias registradas en tus pedidos."
          />
        )
      ) : (
        !errorCarga && (
          <DataTable
            toolbar={
              <span className="text-sm text-muted-foreground tabular-nums">
                {total} incidencia{total !== 1 ? "s" : ""}
                {hayFiltros ? " con filtros" : ""}
              </span>
            }
            footer={
              totalPaginas > 1 ? (
                <Pagination
                  pagina={pagina}
                  totalPaginas={totalPaginas}
                  hrefPagina={(p) => urlConFiltros({ pagina: String(p) })}
                />
              ) : undefined
            }
          >
            <Table densidad="relaxed" aria-label="Mis incidencias">
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="px-4">Estado</TableHead>
                  <TableHead className="px-4">Tipo</TableHead>
                  <TableHead className="hidden px-4 sm:table-cell">Pedido</TableHead>
                  <TableHead className="hidden px-4 md:table-cell">Abierta hace</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {incidencias.map((inc) => {
                  const horas = Math.floor(horasDesde(inc.abiertaEn));
                  const sinGestion = esIncidenciaSinGestion(inc.estado, inc.abiertaEn);
                  return (
                    <TableRow key={inc.id}>
                      <TableCell className="px-4">
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge variant={BADGE_ESTADO_INCIDENCIA[inc.estado]}>
                            {traducirEstadoIncidencia(inc.estado)}
                          </Badge>
                          {sinGestion && (
                            <Badge variant="error">Sin gestión: {horas}h</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="px-4 font-medium">
                        {traducirTipoIncidencia(inc.tipo)}
                        {inc.descripcion && (
                          <p className="mt-0.5 text-xs font-normal text-muted-foreground line-clamp-1">
                            {inc.descripcion}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="hidden px-4 sm:table-cell">
                        <span className="font-mono text-xs text-muted-foreground">
                          {inc.pedidoId.slice(0, 8)}…
                        </span>
                      </TableCell>
                      <TableCell className="hidden px-4 text-muted-foreground md:table-cell">
                        <span className={sinGestion ? "font-semibold text-destructive" : ""}>
                          {horas}h
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </DataTable>
        )
      )}
    </div>
  );
}
