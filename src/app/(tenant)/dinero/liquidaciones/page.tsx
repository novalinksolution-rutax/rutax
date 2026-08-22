/**
 * Pantalla D-3 — Liquidaciones de conductores.
 *
 * Server Component. Ordenamiento: emitida primero, luego borrador, luego pagada.
 * Filtros por conductor y estado. Acciones: "Emitir pago" (F19) y "Marcar como pagada".
 * Criterios C-1 (montos CLP), C-3 (signed URL PDF).
 */

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeGestionarLiquidacionesConductores } from "@/modules/identidad/capacidades";
import { listarLiquidaciones } from "@/modules/dinero/index";
import type { Liquidacion, EstadoLiquidacion } from "@/modules/dinero/tipos";
import {
  traducirEstadoLiquidacion,
  BADGE_ESTADO_LIQUIDACION,
} from "@/lib/ui/traduccion-estados";
import { formatearCLPOGuion } from "@/lib/ui/formato-moneda";
import { Badge } from "@/components/ui/badge";
import { BadgeEstado } from "@/components/ui/badge-estado";
import { DialogMarcarPagada } from "./dialog-marcar-pagada";
import { DialogEmitirPago } from "./dialog-emitir-pago";
import { BotonDescargaPdfLiquidacion } from "./boton-descarga-pdf-liquidacion";
import { DialogAjustarLiquidacion } from "./dialog-ajustar";
import { FiltrosLiquidacionesForm } from "./filtros-liquidaciones";
import { AprobacionLote, type ItemLoteUI } from "../_componentes/aprobacion-lote";
import { accionPreflightLotePagos, accionEmitirPagosLote } from "./actions";

export const metadata: Metadata = {
  title: "Liquidaciones",
};

const ESTADOS_LIQ: EstadoLiquidacion[] = ["borrador", "emitida", "pagada"];
const ORDEN_ESTADO: Record<EstadoLiquidacion, number> = {
  emitida: 0,
  borrador: 1,
  pagada: 2,
};

// Estados activos de payout (en tránsito o terminal negativo)
const ESTADOS_PAYOUT_ACTIVOS = [
  "pendiente",
  "procesando",
  "enviado",
  "confirmado",
  "rechazado",
  "fallido",
] as const;

type EstadoPayout = (typeof ESTADOS_PAYOUT_ACTIVOS)[number];

interface PayoutResumen {
  estado: EstadoPayout;
  errorDescripcion: string | null;
}

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
  const payoutPorLiquidacion = new Map<string, PayoutResumen>();
  // Elegibles para pagar en lote: liquidaciones 'emitida' sin payout en tránsito.
  let itemsLotePagos: ItemLoteUI[] = [];
  let errorCarga = false;

  // Contadores para chips
  let contBorrador = 0;
  let contEmitidas = 0;
  let contPagadas = 0;

  try {
    // Conductores y liquidaciones no dependen entre sí: en paralelo. (El payout de
    // más abajo sí depende de los ids de las liquidaciones, y por eso sigue después.)
    const [{ data: conductoresData }, todasLiquidaciones] = await Promise.all([
      // Conductores disponibles para el filtro
      cliente
        .from("conductores")
        .select("id, nombre_completo")
        .eq("tenant_id", tenantId)
        .order("nombre_completo"),
      // Todas las liquidaciones (sin filtro de estado para contadores)
      listarLiquidaciones(cliente, tenantId, filtroConductor || undefined),
    ]);

    conductoresDisponibles = (conductoresData ?? []).map((c: Record<string, unknown>) => ({
      id: c.id as string,
      nombre: c.nombre_completo as string,
    }));
    const conductoresMap = new Map(conductoresDisponibles.map((c) => [c.id, c.nombre]));

    for (const l of todasLiquidaciones) {
      if (l.estado === "borrador") contBorrador++;
      else if (l.estado === "emitida") contEmitidas++;
      else if (l.estado === "pagada") contPagadas++;
    }

    // Payout más reciente por liquidación (F19)
    const liquidacionIds = todasLiquidaciones.map((l) => l.id);
    if (liquidacionIds.length > 0) {
      const { data: payoutsData } = await cliente
        .schema("dinero")
        .from("payouts_conductor")
        .select("liquidacion_id, estado, error_descripcion, created_at")
        .eq("tenant_id", tenantId)
        .in("liquidacion_id", liquidacionIds)
        .in("estado", [...ESTADOS_PAYOUT_ACTIVOS])
        .order("created_at", { ascending: false });

      // Solo el primer payout por liquidación (ya viene ordenado DESC)
      for (const p of payoutsData ?? []) {
        const liqId = p.liquidacion_id as string;
        if (!payoutPorLiquidacion.has(liqId)) {
          payoutPorLiquidacion.set(liqId, {
            estado: p.estado as EstadoPayout,
            errorDescripcion: (p.error_descripcion as string | null) ?? null,
          });
        }
      }
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

    // Elegibles para pagar en lote: 'emitida' sin un payout en tránsito/confirmado
    // (mismo criterio que el botón "Emitir pago" individual de la tabla).
    itemsLotePagos = liquidaciones
      .filter((l) => {
        if (l.estado !== "emitida") return false;
        const p = payoutPorLiquidacion.get(l.id);
        return !(
          p &&
          (p.estado === "pendiente" ||
            p.estado === "procesando" ||
            p.estado === "enviado" ||
            p.estado === "confirmado")
        );
      })
      .map((l) => ({
        id: l.id,
        etiqueta: l.conductorNombre,
        sub: `${formatearFechaCorta(l.fechaInicio)}–${formatearFechaCorta(l.fechaFin)}`,
        montoClp: (l.montoTotalClp ?? 0) + l.bonoClp - l.penalizacionClp,
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
      <h1 className="text-2xl font-semibold">Liquidaciones de conductores</h1>

      {/* Chips de resumen */}
      {!errorCarga && (
        <div className="flex flex-wrap gap-2" role="list" aria-label="Resumen de liquidaciones">
          {chips.map((chip) => (
            <div
              key={chip.key}
              role="listitem"
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium ${chip.color}`}
            >
              {chip.label}: <span className="font-semibold tabular-nums">{chip.count}</span>
            </div>
          ))}
        </div>
      )}

      {/* Filtros */}
      <FiltrosLiquidacionesForm
        conductores={conductoresDisponibles}
        estados={ESTADOS_LIQ}
        filtroConductor={filtroConductor}
        filtroEstado={filtroEstado}
        hayFiltroActivo={hayFiltroActivo}
      />

      {/* Error */}
      {errorCarga && (
        <div
          role="alert"
          className="rounded-lg bg-destructive-subtle px-4 py-3 text-sm text-destructive-subtle-foreground"
        >
          No pudimos cargar las liquidaciones. Intenta recargar la página.
        </div>
      )}

      {/* Aprobación por lotes — pagar varias liquidaciones emitidas de una vez */}
      {!errorCarga && itemsLotePagos.length > 0 && (
        <AprobacionLote
          items={itemsLotePagos}
          tipo="pago"
          accionPreflight={accionPreflightLotePagos}
          accionEmitir={accionEmitirPagosLote}
        />
      )}

      {/* Tabla / vacío */}
      {!errorCarga && liquidaciones.length === 0 ? (
        <div className="rounded-lg border bg-card px-6 py-12 text-center">
          <p className="text-muted-foreground">
            {hayFiltroActivo
              ? "No hay liquidaciones que coincidan con los filtros."
              : "Aún no tienes liquidaciones. Se generan automáticamente cuando tus conductores registran entregas."}
          </p>
          {hayFiltroActivo && (
            <Link
              href="/dinero/liquidaciones"
              className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
            >
              Limpiar filtros
            </Link>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
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
                  <FilaLiquidacion
                    key={liq.id}
                    liquidacion={liq}
                    payout={payoutPorLiquidacion.get(liq.id)}
                  />
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
  payout,
}: {
  liquidacion: LiquidacionConNombre;
  payout?: PayoutResumen;
}) {
  const textoEstado = traducirEstadoLiquidacion(liquidacion.estado);

  // Determina qué mostrar en la celda de acciones según estado de payout
  const payoutEnProceso =
    payout &&
    (payout.estado === "pendiente" ||
      payout.estado === "procesando" ||
      payout.estado === "enviado");

  const payoutConfirmado = payout?.estado === "confirmado";

  const payoutFallido =
    payout &&
    (payout.estado === "fallido" || payout.estado === "rechazado");

  return (
    <tr className="group hover:bg-muted/30 transition-colors">
      <td className="px-4 py-3">
        <Link
          href={`/conductores/${liquidacion.driverId}`}
          className="font-medium truncate max-w-[160px] inline-block hover:underline"
        >
          {liquidacion.conductorNombre}
        </Link>
      </td>
      <td className="hidden px-4 py-3 sm:table-cell">
        <Link
          href={`/dinero/liquidaciones/${liquidacion.id}`}
          className="tabular-nums text-primary hover:underline"
        >
          {formatearFechaCorta(liquidacion.fechaInicio)} –{" "}
          {formatearFechaCorta(liquidacion.fechaFin)}
        </Link>
      </td>
      <td className="px-4 py-3">
        <BadgeEstado variante={BADGE_ESTADO_LIQUIDACION[liquidacion.estado]} eje="liquidacion" valor={liquidacion.estado} texto={textoEstado} />
      </td>
      <td className="hidden px-4 py-3 text-right tabular-nums text-muted-foreground md:table-cell">
        {liquidacion.totalEntregas}
      </td>
      <td className="hidden px-4 py-3 text-right lg:table-cell">
        {liquidacion.montoTotalClp !== null ? (
          <div className="flex flex-col items-end gap-0.5">
            <span className="tabular-nums font-medium">
              {formatearCLPOGuion(
                liquidacion.montoTotalClp + liquidacion.bonoClp - liquidacion.penalizacionClp,
              )}
            </span>
            {(liquidacion.bonoClp > 0 || liquidacion.penalizacionClp > 0) && (
              <span className="text-xs text-muted-foreground tabular-nums">
                base {formatearCLPOGuion(liquidacion.montoTotalClp)}
                {liquidacion.bonoClp > 0 && ` +${formatearCLPOGuion(liquidacion.bonoClp)}`}
                {liquidacion.penalizacionClp > 0 && ` −${formatearCLPOGuion(liquidacion.penalizacionClp)}`}
              </span>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="hidden px-4 py-3 text-center xl:table-cell">
        {liquidacion.pdfRef ? (
          <BotonDescargaPdfLiquidacion pdfRef={liquidacion.pdfRef} />
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        {liquidacion.estado === "borrador" ? (
          <DialogAjustarLiquidacion
            liquidacionId={liquidacion.id}
            montoBaseClp={liquidacion.montoTotalClp ?? 0}
            bonoActual={liquidacion.bonoClp}
            penalizacionActual={liquidacion.penalizacionClp}
            notaActual={liquidacion.notaAjuste}
          />
        ) : liquidacion.estado === "emitida" ? (
          <div className="flex flex-col items-end gap-1.5">
            {payoutEnProceso ? (
              /* Payout en tránsito: solo badge informativo, sin botones */
              <Badge variant="info">Pago en proceso</Badge>
            ) : payoutConfirmado ? (
              /* Payout confirmado pero liquidación todavía figura emitida (edge case) */
              <Badge variant="success">Pago confirmado</Badge>
            ) : (
              /* Sin payout, o payout fallido/rechazado → mostrar ambos botones */
              <>
                <DialogEmitirPago
                  liquidacionId={liquidacion.id}
                  conductorNombre={liquidacion.conductorNombre}
                  fechaInicio={liquidacion.fechaInicio}
                  fechaFin={liquidacion.fechaFin}
                  montoTotalClp={liquidacion.montoTotalClp}
                />
                <DialogMarcarPagada
                  liquidacionId={liquidacion.id}
                  conductorNombre={liquidacion.conductorNombre}
                  fechaInicio={liquidacion.fechaInicio}
                  fechaFin={liquidacion.fechaFin}
                  montoTotalClp={liquidacion.montoTotalClp}
                />
              </>
            )}

            {/* Indicador de error del payout si fue rechazado */}
            {payoutFallido && payout.errorDescripcion && (
              <p className="text-xs text-destructive leading-tight max-w-[180px] text-right">
                Rechazado: {payout.errorDescripcion}
              </p>
            )}
          </div>
        ) : null}
      </td>
    </tr>
  );
}
