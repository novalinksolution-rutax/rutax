/**
 * Panel de incidencias — Pantalla 1-D (Flujo 1)
 *
 * Server Component. Vista consolidada de incidencias del tenant.
 * El panel lateral de acciones es Client Component.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeGestionarIncidencias } from "@/modules/identidad/capacidades";
import { filaAIncidencia } from "@/modules/operacion/incidencias";
import {
  traducirTipoIncidencia,
  traducirEstadoIncidencia,
  COLOR_ESTADO_INCIDENCIA,
  TEXTO_TIPO_INCIDENCIA,
  TEXTO_ESTADO_INCIDENCIA,
  horasDesde,
  esIncidenciaSinGestion,
} from "@/lib/ui/traduccion-estados";
import { TIPOS_INCIDENCIA, ESTADOS_INCIDENCIA } from "@/modules/operacion/tipos";
import type { Incidencia, TipoIncidencia, EstadoIncidencia } from "@/modules/operacion/tipos";
import { PanelIncidencia } from "./panel-incidencia";

// =============================================================================
// Carga de datos
// =============================================================================

interface FiltrosIncidencias {
  seller?: string;
  tipo?: TipoIncidencia;
  estado?: EstadoIncidencia;
  fechaDesde?: string;
}

async function cargarIncidencias(tenantId: string, filtros: FiltrosIncidencias) {
  const cliente = crearClienteServiceRole();
  let query = cliente
    .from("incidencias")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("abierta_en", { ascending: false })
    .limit(100);

  if (filtros.seller) query = query.eq("seller_id", filtros.seller);
  if (filtros.tipo) query = query.eq("tipo", filtros.tipo);
  if (filtros.estado) {
    query = query.eq("estado", filtros.estado);
  } else {
    // Default: abierta + en_gestion
    query = query.in("estado", ["abierta", "en_gestion"]);
  }
  if (filtros.fechaDesde) {
    query = query.gte("abierta_en", `${filtros.fechaDesde}T00:00:00.000Z`);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Error al cargar incidencias: ${error.message}`);
  return (data ?? []).map(filaAIncidencia);
}

// =============================================================================
// Página
// =============================================================================

interface SearchParams {
  seller?: string;
  tipo?: string;
  estado?: string;
  fecha?: string;
}

export default async function PaginaIncidencias({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sesion = await obtenerSesionActual();
  if (!sesion) redirect("/login");
  if (!sesion.usuario.tenantId) redirect("/login");

  const params = await searchParams;
  const tenantId = sesion.usuario.tenantId;
  const puedeGestionar = puedeGestionarIncidencias(sesion.usuario);

  const filtroSeller = params.seller ?? "";
  const filtroTipo = (params.tipo as TipoIncidencia | "") ?? "";
  const filtroEstado = (params.estado as EstadoIncidencia | "") ?? "";
  const filtroFecha = params.fecha ?? "";
  const hayFiltro = !!(filtroSeller || filtroTipo || filtroEstado || filtroFecha);

  let incidencias: Incidencia[] = [];
  let errorCarga = false;

  try {
    incidencias = await cargarIncidencias(tenantId, {
      seller: filtroSeller || undefined,
      tipo: (filtroTipo as TipoIncidencia) || undefined,
      estado: (filtroEstado as EstadoIncidencia) || undefined,
      fechaDesde: filtroFecha || undefined,
    });
  } catch {
    errorCarga = true;
  }

  // Sellers para el filtro
  let sellers: { id: string; nombre: string }[] = [];
  try {
    const cliente = crearClienteServiceRole();
    const { data } = await cliente
      .from("sellers")
      .select("id, razon_social")
      .eq("tenant_id", tenantId)
      .order("razon_social");
    sellers = (data ?? []).map((s: { id: string; razon_social: string }) => ({
      id: s.id,
      nombre: s.razon_social,
    }));
  } catch {
    // Sin bloquear
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/operaciones"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            Pedidos
          </Link>
          <h1 className="text-2xl font-bold">Incidencias</h1>
        </div>
      </div>

      {/* Filtros */}
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="f-seller" className="text-xs font-medium text-muted-foreground">Seller</label>
          <select id="f-seller" name="seller" defaultValue={filtroSeller}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">Todos los sellers</option>
            {sellers.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="f-tipo" className="text-xs font-medium text-muted-foreground">Tipo</label>
          <select id="f-tipo" name="tipo" defaultValue={filtroTipo}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">Todos los tipos</option>
            {TIPOS_INCIDENCIA.map((t) => (
              <option key={t} value={t}>{TEXTO_TIPO_INCIDENCIA[t as TipoIncidencia]}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="f-estado" className="text-xs font-medium text-muted-foreground">Estado</label>
          <select id="f-estado" name="estado" defaultValue={filtroEstado}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">Abiertas + en gestión</option>
            {ESTADOS_INCIDENCIA.map((e) => (
              <option key={e} value={e}>{TEXTO_ESTADO_INCIDENCIA[e as EstadoIncidencia]}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="f-fecha" className="text-xs font-medium text-muted-foreground">Desde fecha</label>
          <input id="f-fecha" name="fecha" type="date" defaultValue={filtroFecha}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm" />
        </div>

        <button type="submit"
          className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
          Filtrar
        </button>

        {hayFiltro && (
          <Link href="/operaciones/incidencias"
            className="h-9 flex items-center px-3 text-sm text-muted-foreground underline-offset-2 hover:underline">
            Limpiar
          </Link>
        )}
      </form>

      {errorCarga && (
        <div role="alert" className="rounded-lg bg-destructive-subtle px-4 py-3 text-sm text-destructive-subtle-foreground">
          No se pudo cargar la lista de incidencias.
        </div>
      )}

      {!errorCarga && incidencias.length === 0 ? (
        <div className="rounded-xl border bg-card px-6 py-12 text-center">
          <p className="text-muted-foreground">No hay incidencias para los filtros seleccionados.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Lista de incidencias">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2">Estado</th>
                  <th className="px-4 py-2">Tipo</th>
                  <th className="hidden px-4 py-2 sm:table-cell">Pedido</th>
                  <th className="hidden px-4 py-2 md:table-cell">Seller</th>
                  <th className="hidden px-4 py-2 lg:table-cell">Abierta hace</th>
                  {puedeGestionar && <th className="px-4 py-2"><span className="sr-only">Acción</span></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {incidencias.map((inc) => {
                  const horas = Math.floor(horasDesde(inc.abiertaEn));
                  const sinGestion = esIncidenciaSinGestion(inc.estado, inc.abiertaEn);
                  return (
                    <tr key={inc.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${COLOR_ESTADO_INCIDENCIA[inc.estado]}`}>
                          {traducirEstadoIncidencia(inc.estado)}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium">{traducirTipoIncidencia(inc.tipo)}</td>
                      <td className="hidden px-4 py-3 sm:table-cell">
                        <Link href={`/operaciones/${inc.pedidoId}`} className="font-mono text-xs text-primary hover:underline">
                          {inc.pedidoId.slice(0, 8)}…
                        </Link>
                      </td>
                      <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">{inc.sellerId}</td>
                      <td className="hidden px-4 py-3 lg:table-cell">
                        <span className={sinGestion ? "font-semibold text-destructive" : "text-muted-foreground"}>
                          {horas}h
                          {sinGestion && <span className="ml-1 text-xs">(sin gestión)</span>}
                        </span>
                      </td>
                      {puedeGestionar && (
                        <td className="px-4 py-3">
                          <PanelIncidencia incidencia={inc} />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
