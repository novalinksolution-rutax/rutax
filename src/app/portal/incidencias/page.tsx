/**
 * Incidencias del seller — Pantalla portal/incidencias (Flujo 4, Fase B)
 *
 * Server Component. Solo lectura — sin acciones de cambio de estado.
 * RLS garantiza el aislamiento por seller.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  traducirTipoIncidencia,
  traducirEstadoIncidencia,
  COLOR_ESTADO_INCIDENCIA,
  TEXTO_TIPO_INCIDENCIA,
  TEXTO_ESTADO_INCIDENCIA,
  esIncidenciaSinGestion,
  horasDesde,
} from "@/lib/ui/traduccion-estados";
import { TIPOS_INCIDENCIA, ESTADOS_INCIDENCIA } from "@/modules/operacion/tipos";
import type { Incidencia, TipoIncidencia, EstadoIncidencia } from "@/modules/operacion/tipos";

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
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="f-tipo-i" className="text-xs font-medium text-muted-foreground">
            Tipo
          </label>
          <select
            id="f-tipo-i"
            name="tipo"
            defaultValue={filtroTipo}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Todos los tipos</option>
            {TIPOS_INCIDENCIA.map((t) => (
              <option key={t} value={t}>
                {TEXTO_TIPO_INCIDENCIA[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-estado-i" className="text-xs font-medium text-muted-foreground">
            Estado
          </label>
          <select
            id="f-estado-i"
            name="estado"
            defaultValue={filtroEstado}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Todos los estados</option>
            {ESTADOS_INCIDENCIA.map((e) => (
              <option key={e} value={e}>
                {TEXTO_ESTADO_INCIDENCIA[e]}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Filtrar
        </button>
        {hayFiltros && (
          <Link
            href="/portal/incidencias"
            className="h-9 flex items-center px-3 text-sm text-muted-foreground underline-offset-2 hover:underline"
          >
            Limpiar filtros
          </Link>
        )}
      </form>

      {/* Error */}
      {errorCarga && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          No se pudo cargar la lista de incidencias. Intenta recargar la página.
        </div>
      )}

      {/* Contador */}
      {!errorCarga && (
        <p className="text-sm text-muted-foreground">
          {total === 0
            ? "Sin incidencias"
            : `${total} incidencia${total !== 1 ? "s" : ""}`}
          {hayFiltros ? " con los filtros aplicados" : ""}
        </p>
      )}

      {/* Tabla */}
      {!errorCarga && incidencias.length > 0 && (
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Mis incidencias">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2">Estado</th>
                  <th className="px-4 py-2">Tipo</th>
                  <th className="hidden px-4 py-2 sm:table-cell">Pedido</th>
                  <th className="hidden px-4 py-2 md:table-cell">Abierta hace</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {incidencias.map((inc) => {
                  const horas = Math.floor(horasDesde(inc.abiertaEn));
                  const sinGestion = esIncidenciaSinGestion(inc.estado, inc.abiertaEn);
                  return (
                    <tr key={inc.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${COLOR_ESTADO_INCIDENCIA[inc.estado]}`}
                        >
                          {traducirEstadoIncidencia(inc.estado)}
                        </span>
                        {sinGestion && (
                          <span className="ml-1 inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                            Sin gestión: {horas}h
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-medium">
                        {traducirTipoIncidencia(inc.tipo)}
                        {inc.descripcion && (
                          <p className="mt-0.5 text-xs text-muted-foreground font-normal line-clamp-1">
                            {inc.descripcion}
                          </p>
                        )}
                      </td>
                      <td className="hidden px-4 py-3 sm:table-cell">
                        <span className="font-mono text-xs text-muted-foreground">{inc.pedidoId.slice(0, 8)}…</span>
                      </td>
                      <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">
                        <span className={sinGestion ? "font-semibold text-red-700" : ""}>
                          {horas}h
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Vacío */}
      {!errorCarga && incidencias.length === 0 && (
        <div className="rounded-xl border bg-card px-6 py-12 text-center">
          <p className="text-muted-foreground">
            {hayFiltros
              ? "No hay incidencias que coincidan con los filtros."
              : "No tienes incidencias registradas. Todo va bien."}
          </p>
          {hayFiltros && (
            <Link
              href="/portal/incidencias"
              className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
            >
              Limpiar filtros
            </Link>
          )}
        </div>
      )}

      {/* Paginación */}
      {!errorCarga && totalPaginas > 1 && (
        <nav aria-label="Paginación" className="flex items-center justify-center gap-2">
          {pagina > 1 && (
            <Link
              href={urlConFiltros({ pagina: String(pagina - 1) })}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted transition-colors"
            >
              Anterior
            </Link>
          )}
          <span className="text-sm text-muted-foreground">
            Página {pagina} de {totalPaginas}
          </span>
          {pagina < totalPaginas && (
            <Link
              href={urlConFiltros({ pagina: String(pagina + 1) })}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted transition-colors"
            >
              Siguiente
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
