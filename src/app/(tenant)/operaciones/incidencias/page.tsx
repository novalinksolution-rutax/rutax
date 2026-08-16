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
  BADGE_ESTADO_INCIDENCIA,
  horasDesde,
  esIncidenciaSinGestion,
} from "@/lib/ui/traduccion-estados";
import { BadgeEstado } from "@/components/ui/badge-estado";
import type { Incidencia, TipoIncidencia, EstadoIncidencia } from "@/modules/operacion/tipos";
import { PanelIncidencia } from "./panel-incidencia";
import { FiltrosIncidencias } from "./filtros-incidencias";
import { IndicadorEnVivo } from "@/components/tiempo-real/indicador-en-vivo";
import { obtenerSellersDelTenant, type SellerFiltro } from "@/lib/datos-tenant/sellers";
import { hoyEnSantiago } from "@/lib/fecha-santiago";
import { parsearRangoFecha, ventanaFechaSantiago, type RangoFecha } from "@/lib/filtros/fecha";

// =============================================================================
// Carga de datos
// =============================================================================

interface FiltrosIncidencias {
  seller?: string;
  tipo?: TipoIncidencia;
  estado?: EstadoIncidencia;
  /** Rango de `abierta_en` (día exacto o entre dos fechas). */
  rangoFecha?: RangoFecha;
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
  if (filtros.rangoFecha?.hayFecha) {
    // `abierta_en` es `timestamptz`: el filtro es por DÍA CIVIL de Santiago, así
    // que se traduce a la ventana de instantes UTC de ese día (o del rango).
    // Pegar `T00:00:00.000Z` correría la ventana 3–4 h y colaría incidencias de
    // la noche anterior — por eso pasa por `ventanaFechaSantiago`.
    const { gte, lt } = ventanaFechaSantiago(filtros.rangoFecha);
    if (gte) query = query.gte("abierta_en", gte);
    if (lt) query = query.lt("abierta_en", lt);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Error al cargar incidencias: ${error.message}`);
  return (data ?? []).map(filaAIncidencia);
}

/**
 * Referencia LEGIBLE de cada pedido citado por las incidencias.
 *
 * La tabla mostraba el UUID recortado (`6d000000…`), que no le dice nada a nadie:
 * el coordinador identifica un pedido por su código same-day o por su envío de
 * Flex. Se resuelve en una sola consulta y se mapea id → referencia, igual que
 * ya se hace con el nombre del seller.
 */
async function cargarReferenciasPedido(
  tenantId: string,
  pedidoIds: string[],
): Promise<Record<string, string>> {
  if (pedidoIds.length === 0) return {};
  try {
    const cliente = crearClienteServiceRole();
    const { data } = await cliente
      .schema("operacion")
      .from("pedidos")
      .select("id, codigo_interno, ml_shipment_id, destinatario_nombre")
      .eq("tenant_id", tenantId)
      .in("id", pedidoIds);

    return Object.fromEntries(
      (data ?? []).map((p) => [
        p.id as string,
        (p.codigo_interno as string | null) ??
          (p.ml_shipment_id as string | null) ??
          (p.destinatario_nombre as string | null) ??
          (p.id as string).slice(0, 8),
      ]),
    );
  } catch {
    return {};
  }
}

// =============================================================================
// Página
// =============================================================================

interface SearchParams {
  seller?: string;
  tipo?: string;
  estado?: string;
  fecha?: string;
  fecha_desde?: string;
  fecha_hasta?: string;
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
  const rangoFecha = parsearRangoFecha({
    exacto: params.fecha,
    desde: params.fecha_desde,
    hasta: params.fecha_hasta,
  });
  const hoyIso = hoyEnSantiago();
  const hayFiltro = !!(filtroSeller || filtroTipo || filtroEstado || rangoFecha.hayFecha);

  // Incidencias y sellers son independientes entre sí: van en paralelo para no
  // pagar dos round-trips en fila. Cada una conserva su propio manejo de error —
  // si fallan las incidencias la pantalla lo avisa, si fallan los sellers no
  // bloquea (el filtro queda vacío).
  const [resIncidencias, sellers] = await Promise.all([
    cargarIncidencias(tenantId, {
      seller: filtroSeller || undefined,
      tipo: (filtroTipo as TipoIncidencia) || undefined,
      estado: (filtroEstado as EstadoIncidencia) || undefined,
      rangoFecha: rangoFecha.hayFecha ? rangoFecha : undefined,
    }).catch(() => null),
    // Sellers para el filtro — lista cacheada por tenant (datos-tenant/sellers).
    obtenerSellersDelTenant(tenantId).catch(() => [] as SellerFiltro[]),
  ]);

  const errorCarga = resIncidencias === null;
  const incidencias: Incidencia[] = resIncidencias ?? [];

  // Nombre legible del seller en la tabla (en vez del UUID).
  const nombreSellerPorId = Object.fromEntries(sellers.map((s) => [s.id, s.nombre]));

  // Referencia legible del pedido (código same-day o envío Flex) en vez del UUID.
  const referenciaPedidoPorId = await cargarReferenciasPedido(
    tenantId,
    [...new Set(incidencias.map((i) => i.pedidoId))],
  );

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
          <h1 className="text-2xl font-semibold">Incidencias</h1>
          <IndicadorEnVivo
            tenantId={tenantId}
            tablas={[{ schema: "operacion", tabla: "incidencias" }]}
          />
        </div>
      </div>

      {/* Filtros */}
      <FiltrosIncidencias
        sellers={sellers}
        hoy={hoyIso}
        filtroSeller={filtroSeller}
        filtroTipo={filtroTipo}
        filtroEstado={filtroEstado}
        filtroFecha={rangoFecha.exacto}
        filtroFechaDesde={rangoFecha.desde}
        filtroFechaHasta={rangoFecha.hasta}
        hayFiltro={hayFiltro}
      />

      {errorCarga && (
        <div role="alert" className="rounded-lg bg-destructive-subtle px-4 py-3 text-sm text-destructive-subtle-foreground">
          No pudimos cargar las incidencias. Intenta recargar la página.
        </div>
      )}

      {!errorCarga && incidencias.length === 0 ? (
        <div className="rounded-lg border bg-card px-6 py-12 text-center">
          <p className="text-muted-foreground">No hay incidencias para los filtros seleccionados.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
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
                        <BadgeEstado
                          variante={BADGE_ESTADO_INCIDENCIA[inc.estado]}
                          texto={traducirEstadoIncidencia(inc.estado)}
                        />
                      </td>
                      <td className="px-4 py-3 font-medium">{traducirTipoIncidencia(inc.tipo)}</td>
                      <td className="hidden px-4 py-3 sm:table-cell">
                        <Link href={`/operaciones/${inc.pedidoId}`} className="font-mono text-xs text-primary hover:underline">
                          {referenciaPedidoPorId[inc.pedidoId] ?? `${inc.pedidoId.slice(0, 8)}…`}
                        </Link>
                      </td>
                      <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">
                        {nombreSellerPorId[inc.sellerId] ?? inc.sellerId}
                      </td>
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
