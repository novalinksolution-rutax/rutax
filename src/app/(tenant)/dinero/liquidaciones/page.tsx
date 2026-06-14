/**
 * Pantalla D-3 — Liquidaciones de conductores.
 *
 * Server Component. Ordenamiento: emitida primero, luego borrador, luego pagada.
 * Filtros por conductor y estado. Acción "Marcar como pagada".
 * Criterios C-1 (montos CLP), C-3 (signed URL PDF).
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeGestionarLiquidacionesConductores } from "@/modules/identidad/capacidades";
import { listarLiquidaciones } from "@/modules/dinero/index";
import type { Liquidacion, EstadoLiquidacion } from "@/modules/dinero/tipos";
import {
  traducirEstadoLiquidacion,
  BADGE_ESTADO_LIQUIDACION,
  TEXTO_ESTADO_LIQUIDACION,
} from "@/lib/ui/traduccion-estados";
import { formatearCLPOGuion } from "@/lib/ui/formato-moneda";
import { Badge } from "@/components/ui/badge";
import { DialogMarcarPagada } from "./dialog-marcar-pagada";
import { BotonDescargaPdfLiquidacion } from "./boton-descarga-pdf-liquidacion";

export const metadata: Metadata = {
  title: "Liquidaciones",
};

const ESTADOS_LIQ: EstadoLiquidacion[] = ["borrador", "emitida", "pagada"];
const ORDEN_ESTADO: Record<EstadoLiquidacion, number> = {
  emitida: 0,
  borrador: 1,
  pagada: 2,
};

interface SearchParams {
  conductor?: string;
  estado?: string;
}

interface LiquidacionConNombre extends Liquidacion {
  conductorNombre: string;
}

function formatearFechaCorta(fechaIso: string): string {
  if (!fechaIso || fechaIso.length < 10) return fechaIso;
  const [anio, mes, dia] = fechaIso.slice(0, 10).split("-");
  return `${dia}/${mes}/${anio}`;
}

export default async function PaginaLiquidaciones({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sesion = await obtenerSesionActual();
  if (!sesion) redirect("/login");
  if (!sesion.usuario.tenantId) redirect("/login");
  if (!puedeGestionarLiquidacionesConductores(sesion.usuario)) redirect("/dashboard");

  const params = await searchParams;
  const tenantId = sesion.usuario.tenantId;

  const filtroConductor = params.conductor ?? "";
  const filtroEstado = (params.estado as EstadoLiquidacion | "") ?? "";

  const cliente = crearClienteServiceRole();
  let liquidaciones: LiquidacionConNombre[] = [];
  let conductoresDisponibles: { id: string; nombre: string }[] = [];
  let errorCarga = false;

  // Contadores para chips
  let contBorrador = 0;
  let contEmitidas = 0;
  let contPagadas = 0;

  try {
    // Conductores disponibles para el filtro
    const { data: conductoresData } = await cliente
      .from("conductores")
      .select("id, nombre_completo")
      .eq("tenant_id", tenantId)
      .order("nombre_completo");
    conductoresDisponibles = (conductoresData ?? []).map((c: Record<string, unknown>) => ({
      id: c.id as string,
      nombre: c.nombre_completo as string,
    }));
    const conductoresMap = new Map(conductoresDisponibles.map((c) => [c.id, c.nombre]));

    // Todas las liquidaciones (sin filtro de estado para contadores)
    const todasLiquidaciones = await listarLiquidaciones(
      cliente,
      tenantId,
      filtroConductor || undefined,
    );

    for (const l of todasLiquidaciones) {
      if (l.estado === "borrador") contBorrador++;
      else if (l.estado === "emitida") contEmitidas++;
      else if (l.estado === "pagada") contPagadas++;
    }

    // Filtrar y ordenar
    const filtradas = filtroEstado
      ? todasLiquidaciones.filter((l) => l.estado === filtroEstado)
      : todasLiquidaciones;

    const ordenadas = [...filtradas].sort((a, b) => {
      const diff = ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado];
      if (diff !== 0) return diff;
      return b.fechaFin.localeCompare(a.fechaFin);
    });

    liquidaciones = ordenadas.map((l) => ({
      ...l,
      conductorNombre: conductoresMap.get(l.driverId) ?? l.driverId,
    }));
  } catch {
    errorCarga = true;
  }

  const hayFiltroActivo = !!(filtroConductor || filtroEstado);

  const chips = [
    {
      key: "borrador",
      label: "Borrador",
      count: contBorrador,
      color: "bg-muted text-muted-foreground",
    },
    {
      key: "emitida",
      label: "Emitidas",
      count: contEmitidas,
      color: "bg-info-subtle text-info-subtle-foreground",
    },
    {
      key: "pagada",
      label: "Pagadas",
      count: contPagadas,
      color: "bg-success-subtle text-success-subtle-foreground",
    },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Liquidaciones de conductores</h1>

      {/* Chips de resumen */}
      {!errorCarga && (
        <div className="flex flex-wrap gap-2" role="list" aria-label="Resumen de liquidaciones">
          {chips.map((chip) => (
            <div
              key={chip.key}
              role="listitem"
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${chip.color}`}
            >
              {chip.label}: <span className="font-bold tabular-nums">{chip.count}</span>
            </div>
          ))}
        </div>
      )}

      {/* Filtros */}
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="f-conductor-l" className="text-xs font-medium text-muted-foreground">
            Conductor
          </label>
          <select
            id="f-conductor-l"
            name="conductor"
            defaultValue={filtroConductor}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Todos</option>
            {conductoresDisponibles.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="f-estado-l" className="text-xs font-medium text-muted-foreground">
            Estado
          </label>
          <select
            id="f-estado-l"
            name="estado"
            defaultValue={filtroEstado}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Todos</option>
            {ESTADOS_LIQ.map((e) => (
              <option key={e} value={e}>
                {TEXTO_ESTADO_LIQUIDACION[e]}
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

        {hayFiltroActivo && (
          <a
            href="/dinero/liquidaciones"
            className="h-9 flex items-center px-3 text-sm text-muted-foreground underline-offset-2 hover:underline"
          >
            Limpiar filtros
          </a>
        )}
      </form>

      {/* Error */}
      {errorCarga && (
        <div
          role="alert"
          className="rounded-lg bg-destructive-subtle px-4 py-3 text-sm text-destructive-subtle-foreground"
        >
          No se pudo cargar la lista de liquidaciones. Intenta recargar la página.
        </div>
      )}

      {/* Tabla / vacío */}
      {!errorCarga && liquidaciones.length === 0 ? (
        <div className="rounded-xl border bg-card px-6 py-12 text-center">
          <p className="text-muted-foreground">
            {hayFiltroActivo
              ? "No hay liquidaciones que coincidan con los filtros aplicados."
              : "Aún no hay liquidaciones. Se generan automáticamente cuando el motor registra la primera entrega de un conductor."}
          </p>
          {hayFiltroActivo && (
            <a
              href="/dinero/liquidaciones"
              className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
            >
              Limpiar filtros
            </a>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Liquidaciones de conductores">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2" style={{ width: "22%" }}>Conductor</th>
                  <th className="hidden px-4 py-2 sm:table-cell" style={{ width: "18%" }}>Período</th>
                  <th className="px-4 py-2" style={{ width: "10%" }}>Estado</th>
                  <th className="hidden px-4 py-2 text-right md:table-cell" style={{ width: "8%" }}>Entregas</th>
                  <th className="hidden px-4 py-2 text-right lg:table-cell" style={{ width: "15%" }}>Monto total</th>
                  <th className="hidden px-4 py-2 text-center xl:table-cell" style={{ width: "8%" }}>PDF</th>
                  <th className="px-4 py-2 text-right" style={{ width: "19%" }}>
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {liquidaciones.map((liq) => (
                  <FilaLiquidacion key={liq.id} liquidacion={liq} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Fila de liquidación
// =============================================================================

function FilaLiquidacion({
  liquidacion,
}: {
  liquidacion: LiquidacionConNombre;
}) {
  const textoEstado = traducirEstadoLiquidacion(liquidacion.estado);

  return (
    <tr className="group hover:bg-muted/30 transition-colors">
      <td className="px-4 py-3">
        <p className="font-medium truncate max-w-[160px]">{liquidacion.conductorNombre}</p>
      </td>
      <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
        <span className="tabular-nums">
          {formatearFechaCorta(liquidacion.fechaInicio)} –{" "}
          {formatearFechaCorta(liquidacion.fechaFin)}
        </span>
      </td>
      <td className="px-4 py-3">
        <Badge variant={BADGE_ESTADO_LIQUIDACION[liquidacion.estado]}>
          {textoEstado}
        </Badge>
      </td>
      <td className="hidden px-4 py-3 text-right tabular-nums text-muted-foreground md:table-cell">
        {liquidacion.totalEntregas}
      </td>
      <td className="hidden px-4 py-3 text-right tabular-nums font-medium lg:table-cell">
        {formatearCLPOGuion(liquidacion.montoTotalClp)}
      </td>
      <td className="hidden px-4 py-3 text-center xl:table-cell">
        {liquidacion.pdfRef ? (
          <BotonDescargaPdfLiquidacion pdfRef={liquidacion.pdfRef} />
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        {liquidacion.estado === "emitida" ? (
          <DialogMarcarPagada
            liquidacionId={liquidacion.id}
            conductorNombre={liquidacion.conductorNombre}
            fechaInicio={liquidacion.fechaInicio}
            fechaFin={liquidacion.fechaFin}
            montoTotalClp={liquidacion.montoTotalClp}
          />
        ) : null}
      </td>
    </tr>
  );
}
