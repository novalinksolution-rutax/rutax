/**
 * Pantalla D-1 — Dashboard de períodos de cobro.
 *
 * Server Component. Filtros por seller y estado via searchParams (GET).
 * Criterios C-1 (montos CLP), C-3 (signed URLs), C-7 (folio en badge facturado).
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeEmitirFacturas } from "@/modules/identidad/capacidades";
import {
  listarPeriodosCobro,
  listarDocumentosDte,
} from "@/modules/dinero/index";
import type { PeriodoCobro, DocumentoDte, EstadoPeriodo } from "@/modules/dinero/tipos";
import {
  BADGE_ESTADO_SII,
  traducirEstadoSiiTexto,
  traducirEstadoPeriodoCobro,
  BADGE_ESTADO_PERIODO,
  traducirEstadoCobroPeriodo,
  BADGE_ESTADO_COBRO_PERIODO,
} from "@/lib/ui/traduccion-estados";
import { formatearCLPOGuion } from "@/lib/ui/formato-moneda";

import { BadgeEstado } from "@/components/ui/badge-estado";
import { DialogCerrarPeriodo } from "./dialog-cerrar-periodo";
import { FiltrosPeriodosForm } from "./filtros-periodos";
import { AprobacionLote, type ItemLoteUI } from "../_componentes/aprobacion-lote";
import { accionPreflightLoteFacturas, accionEmitirFacturasLote } from "./actions";
import { EnlaceDetalle } from "@/components/app-shell/enlace-detalle";

export const metadata: Metadata = {
  title: "Períodos de cobro",
};

const ESTADOS_PERIODO: EstadoPeriodo[] = ["abierto", "cerrado", "facturado", "anulado"];
const LIMITE = 20;

interface SearchParams {
  seller?: string;
  estado?: string;
  pagina?: string;
}

// Tipo enriquecido con datos del DTE y nombre del seller
interface PeriodoConDte extends PeriodoCobro {
  dte: DocumentoDte | null;
  sellerNombre: string;
}

export default async function PaginaPeriodosCobro({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sesion = await obtenerSesionActual();
  if (!sesion) redirect("/login");
  if (!sesion.usuario.tenantId) redirect("/login");
  if (!puedeEmitirFacturas(sesion.usuario)) redirect("/dashboard");

  const params = await searchParams;
  const tenantId = sesion.usuario.tenantId;

  const filtroSeller = params.seller ?? "";
  const filtroEstado = (params.estado as EstadoPeriodo | "") ?? "";
  const pagina = Math.max(1, parseInt(params.pagina ?? "1", 10));
  const hayFiltroActivo = !!(filtroSeller || filtroEstado);

  const cliente = crearClienteServiceRole();
  let periodos: PeriodoCobro[] = [];
  let periodosConDte: PeriodoConDte[] = [];
  let sellersDisponibles: { id: string; nombre: string }[] = [];
  // Elementos elegibles para la aprobación en lote: períodos 'cerrado' listos
  // para facturar (de TODO el conjunto, no solo la página visible).
  let itemsLoteFacturas: ItemLoteUI[] = [];
  let errorCarga = false;

  // Contadores para chips (siempre sin filtro de estado para mostrar totales reales)
  let contAbiertos = 0;
  let contCerrados = 0;
  let contFacturados = 0;
  let contAnulados = 0;
  let contConProblemas = 0;

  try {
    // Las tres consultas son independientes entre sí (solo dependen de tenantId y
    // del filtro de seller), así que van en paralelo: encadenadas costaban tres
    // round-trips a la base en vez de uno.
    const [{ data: sellersData }, todosPeriodos, todosDte] = await Promise.all([
      // Sellers disponibles para el filtro
      cliente
        .from("sellers")
        .select("id, razon_social")
        .eq("tenant_id", tenantId)
        .order("razon_social"),
      // Todos los períodos (sin filtro de estado) para contadores
      listarPeriodosCobro(cliente, tenantId, filtroSeller || undefined),
      // Documentos DTE para cruzar datos
      listarDocumentosDte(cliente, tenantId, filtroSeller || undefined),
    ]);

    sellersDisponibles = (sellersData ?? []).map((s: Record<string, unknown>) => ({
      id: s.id as string,
      nombre: s.razon_social as string,
    }));

    const sellersMap = new Map(sellersDisponibles.map((s) => [s.id, s.nombre]));
    // Solo facturas (33): la nota de crédito (61) comparte periodo_cobro_id
    // con la factura que anula y no debe pisarla en este mapa.
    const dteMap = new Map<string, DocumentoDte>(
      todosDte
        .filter((d) => d.tipoDocumento === 33)
        .map((d) => [d.periodoCobroidId, d]),
    );

    // Calcular contadores
    for (const p of todosPeriodos) {
      if (p.estado === "abierto") contAbiertos++;
      else if (p.estado === "cerrado") contCerrados++;
      else if (p.estado === "facturado") contFacturados++;
      else if (p.estado === "anulado") contAnulados++;

      // "Con problemas" = DTE rechazado o aceptado_con_discrepancias
      const dte = p.documentoDteId ? dteMap.get(p.id) : null;
      if (
        dte &&
        (dte.estadoSii === "rechazado" || dte.estadoSii === "aceptado_con_discrepancias")
      ) {
        contConProblemas++;
      }
    }

    // Filtrar para la tabla
    periodos = filtroEstado
      ? todosPeriodos.filter((p) => p.estado === filtroEstado)
      : todosPeriodos;

    // Paginar
    const offset = (pagina - 1) * LIMITE;
    const periodosPaginados = periodos.slice(offset, offset + LIMITE);

    // Enriquecer con DTE y nombre seller
    periodosConDte = periodosPaginados.map((p) => ({
      ...p,
      dte: dteMap.get(p.id) ?? null,
      sellerNombre: sellersMap.get(p.sellerId) ?? p.sellerId,
    }));

    // Elegibles para facturar en lote: todos los 'cerrado' del conjunto filtrado.
    itemsLoteFacturas = todosPeriodos
      .filter((p) => p.estado === "cerrado")
      .map((p) => ({
        id: p.id,
        etiqueta: sellersMap.get(p.sellerId) ?? p.sellerId,
        sub: `${formatearFechaCorta(p.fechaInicio)}–${formatearFechaCorta(p.fechaFin)}`,
        montoClp: p.montoTotalClp ?? 0,
      }));
  } catch {
    errorCarga = true;
  }

  const totalPaginas = Math.ceil(periodos.length / LIMITE);

  function urlConFiltros(overrides: Record<string, string>) {
    const sp = new URLSearchParams();
    if (filtroSeller) sp.set("seller", filtroSeller);
    if (filtroEstado) sp.set("estado", filtroEstado);
    Object.entries(overrides).forEach(([k, v]) => {
      if (v) sp.set(k, v);
      else sp.delete(k);
    });
    const s = sp.toString();
    return `/dinero/periodos${s ? `?${s}` : ""}`;
  }

  const chips = [
    { key: "abierto", label: "Abiertos", count: contAbiertos, color: "bg-info-subtle text-info-subtle-foreground" },
    { key: "cerrado", label: "Cerrados", count: contCerrados, color: "bg-muted text-muted-foreground" },
    { key: "facturado", label: "Facturados", count: contFacturados, color: "bg-success-subtle text-success-subtle-foreground" },
    { key: "anulado", label: "Anulados", count: contAnulados, color: "bg-destructive-subtle text-destructive-subtle-foreground" },
    { key: "", label: "Con problemas", count: contConProblemas, color: "bg-destructive-subtle text-destructive-subtle-foreground" },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Períodos de cobro</h1>

      {/* Chips de resumen */}
      {!errorCarga && (
        <div className="flex flex-wrap gap-2" role="list" aria-label="Resumen de períodos">
          {chips.map((chip) => {
            const estaActivo = filtroEstado === chip.key && chip.key !== "";
            return (
              <Link
                key={`chip-${chip.key || "problemas"}`}
                href={
                  chip.key === ""
                    ? "/dinero/periodos"
                    : estaActivo
                    ? "/dinero/periodos"
                    : urlConFiltros({ estado: chip.key, pagina: "" })
                }
                role="listitem"
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium transition-all ${chip.color} ${
                  estaActivo ? "ring-2 ring-current ring-offset-1" : "hover:opacity-80"
                }`}
              >
                {chip.label}: <span className="font-semibold tabular-nums">{chip.count}</span>
              </Link>
            );
          })}
        </div>
      )}

      {/* Filtros */}
      <FiltrosPeriodosForm
        sellers={sellersDisponibles}
        estados={ESTADOS_PERIODO}
        filtroSeller={filtroSeller}
        filtroEstado={filtroEstado}
        hayFiltroActivo={hayFiltroActivo}
      />

      {/* Error de carga */}
      {errorCarga && (
        <div
          role="alert"
          className="rounded-lg bg-destructive-subtle px-4 py-3 text-sm text-destructive-subtle-foreground"
        >
          No pudimos cargar los períodos. Intenta recargar la página.
        </div>
      )}

      {/* Aprobación por lotes — facturar varios períodos cerrados de una vez */}
      {!errorCarga && itemsLoteFacturas.length > 0 && (
        <AprobacionLote
          items={itemsLoteFacturas}
          tipo="factura"
          accionPreflight={accionPreflightLoteFacturas}
          accionEmitir={accionEmitirFacturasLote}
        />
      )}

      {/* Tabla */}
      {!errorCarga && periodosConDte.length === 0 ? (
        <div className="rounded-lg border bg-card px-6 py-12 text-center">
          {hayFiltroActivo ? (
            <>
              <p className="text-muted-foreground">
                No hay períodos que coincidan con los filtros aplicados.
              </p>
              <Link
                href="/dinero/periodos"
                className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
              >
                Limpiar filtros
              </Link>
            </>
          ) : (
            <p className="text-muted-foreground">
              Aún no tienes períodos de cobro. Se generan automáticamente cuando tus sellers registran entregas.
            </p>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Períodos de cobro">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2" style={{ width: "20%" }}>Seller</th>
                  <th className="hidden px-4 py-2 sm:table-cell" style={{ width: "20%" }}>Período</th>
                  <th className="px-4 py-2" style={{ width: "12%" }}>Estado</th>
                  <th className="hidden px-4 py-2 text-right md:table-cell" style={{ width: "8%" }}>Líneas</th>
                  <th className="hidden px-4 py-2 text-right lg:table-cell" style={{ width: "13%" }}>Monto total</th>
                  <th className="hidden px-4 py-2 lg:table-cell" style={{ width: "11%" }}>Cobro</th>
                  <th className="hidden px-4 py-2 xl:table-cell" style={{ width: "11%" }}>Estado SII</th>
                  <th className="px-4 py-2 text-right" style={{ width: "12%" }}>
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {periodosConDte.map((periodo) => (
                  <FilaPeriodo key={periodo.id} periodo={periodo} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Footer con conteo */}
          <div className="flex items-center justify-between border-t bg-muted/20 px-4 py-2">
            <span className="text-xs text-muted-foreground">
              Mostrando {periodosConDte.length} de {periodos.length} período{periodos.length !== 1 ? "s" : ""}
            </span>

            {totalPaginas > 1 && (
              <div className="flex gap-2">
                {pagina > 1 && (
                  <Link
                    href={urlConFiltros({ pagina: String(pagina - 1) })}
                    className="rounded border px-3 py-1 text-xs hover:bg-muted transition-colors"
                  >
                    Anterior
                  </Link>
                )}
                <span className="flex items-center text-xs text-muted-foreground">
                  {pagina} / {totalPaginas}
                </span>
                {pagina < totalPaginas && (
                  <Link
                    href={urlConFiltros({ pagina: String(pagina + 1) })}
                    className="rounded border px-3 py-1 text-xs hover:bg-muted transition-colors"
                  >
                    Siguiente
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Componentes auxiliares
// =============================================================================

function BadgeEstadoSiiInline({ estadoSii }: { estadoSii: DocumentoDte["estadoSii"] }) {
  return (
    <BadgeEstado
      variante={BADGE_ESTADO_SII[estadoSii] ?? "neutral"}
      texto={traducirEstadoSiiTexto(estadoSii)}
      eje="sii"
      valor={estadoSii}
         />
  );
}

function BadgeEstadoCobro({ periodo }: { periodo: PeriodoConDte }) {
  // El cobro solo aplica a períodos facturados; mientras no lo estén, no hay
  // nada que cobrar todavía.
  if (periodo.estadoCobro === "no_aplica") {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span
      title={
        periodo.estadoCobro === "parcial"
          ? `Pagado: ${formatearCLPOGuion(periodo.montoPagadoClp)}`
          : undefined
      }
    >
      <BadgeEstado
        variante={BADGE_ESTADO_COBRO_PERIODO[periodo.estadoCobro]}
        texto={traducirEstadoCobroPeriodo(periodo.estadoCobro)}
        eje="cobro-periodo"
        valor={periodo.estadoCobro}
      />
    </span>
  );
}

function FilaPeriodo({ periodo }: { periodo: PeriodoConDte }) {
  const textoBadge = traducirEstadoPeriodoCobro(
    periodo.estado,
    periodo.estado === "facturado" && periodo.dte ? periodo.dte.folio : undefined,
  );

  const fechaInicio = formatearFechaCorta(periodo.fechaInicio);
  const fechaFin = formatearFechaCorta(periodo.fechaFin);

  return (
    <tr className="group hover:bg-muted/30 transition-colors">
      {/* Seller */}
      <td className="px-4 py-3">
        <p className="font-medium truncate max-w-[160px]">{periodo.sellerNombre}</p>
      </td>

      {/* Período */}
      <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
        <span className="tabular-nums">
          {fechaInicio} – {fechaFin}
        </span>
      </td>

      {/* Estado */}
      <td className="px-4 py-3">
        <BadgeEstado variante={BADGE_ESTADO_PERIODO[periodo.estado]} eje="periodo" valor={periodo.estado} texto={textoBadge} />
      </td>

      {/* Líneas */}
      <td className="hidden px-4 py-3 text-right tabular-nums text-muted-foreground md:table-cell">
        {periodo.totalLineas}
      </td>

      {/* Monto total */}
      <td className="hidden px-4 py-3 text-right tabular-nums font-medium lg:table-cell">
        {formatearCLPOGuion(periodo.montoTotalClp)}
      </td>

      {/* Estado de cobro */}
      <td className="hidden px-4 py-3 lg:table-cell">
        <BadgeEstadoCobro periodo={periodo} />
      </td>

      {/* Estado SII */}
      <td className="hidden px-4 py-3 xl:table-cell">
        {periodo.dte ? (
          <BadgeEstadoSiiInline estadoSii={periodo.dte.estadoSii} />
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>

      {/* Acciones */}
      <td className="px-4 py-3 text-right">
        <AccionesPeriodo periodo={periodo} />
      </td>
    </tr>
  );
}

function AccionesPeriodo({ periodo }: { periodo: PeriodoConDte }) {
  if (periodo.estado === "abierto") {
    return (
      <DialogCerrarPeriodo
        periodoId={periodo.id}
        sellerNombre={periodo.sellerNombre}
        fechaInicio={periodo.fechaInicio}
        fechaFin={periodo.fechaFin}
        totalLineas={periodo.totalLineas}
        montoTotalClp={periodo.montoTotalClp}
      />
    );
  }

  return (
    <div className="flex items-center justify-end gap-2 flex-wrap">
      <EnlaceDetalle
        href={`/dinero/periodos/${periodo.id}`}
        className="text-xs font-medium text-primary hover:underline"
      >
        Ver detalle
      </EnlaceDetalle>
      {(periodo.estado === "facturado") && periodo.dte && (
        <>
          {periodo.dte.pdfRef && (
            <form action={`/dinero/periodos/${periodo.id}`}>
              <Link
                href={`/dinero/periodos/${periodo.id}?descargar=pdf`}
                className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
              >
                Ver PDF
              </Link>
            </form>
          )}
          {periodo.dte.xmlDteRef && (
            <Link
              href={`/dinero/periodos/${periodo.id}?descargar=xml`}
              className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
            >
              Ver XML
            </Link>
          )}
        </>
      )}
    </div>
  );
}

// Formatea 'YYYY-MM-DD' → 'DD/MM/AAAA'
function formatearFechaCorta(fechaIso: string): string {
  if (!fechaIso || fechaIso.length < 10) return fechaIso;
  const [anio, mes, dia] = fechaIso.slice(0, 10).split("-");
  return `${dia}/${mes}/${anio}`;
}
