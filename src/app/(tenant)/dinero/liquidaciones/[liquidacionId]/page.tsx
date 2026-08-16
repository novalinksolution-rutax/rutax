/**
 * Pantalla D-3.1 — Detalle de liquidación (sentido inverso de la trazabilidad
 * financiera bidireccional, §1.1 P1 del audit externo jul 2026).
 *
 * Server Component. Calca el patrón de `dinero/periodos/[periodoId]/page.tsx`:
 * breadcrumb, encabezado con conductor/período/estado/monto, bloque de payout
 * (si existe) y tabla de líneas con link a cada pedido + Popover "por qué".
 * 100% de solo lectura — ninguna acción de mutación nueva.
 */

import type { Metadata } from "next";
import { redirect, unstable_rethrow } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, AlertTriangle } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeGestionarLiquidacionesConductores } from "@/modules/identidad/capacidades";
import { obtenerLiquidacion, obtenerPayoutPorLiquidacion } from "@/modules/dinero/index";
import type { LineaLiquidacion, PayoutConductor, MetodoPayout } from "@/modules/dinero/tipos";
import {
  traducirEstadoLiquidacion,
  BADGE_ESTADO_LIQUIDACION,
  traducirEstadoPayout,
  BADGE_ESTADO_PAYOUT,
} from "@/lib/ui/traduccion-estados";
import { formatearCLP, formatearCLPOGuion, formatearAjuste } from "@/lib/ui/formato-moneda";
import { referenciaLineaLiquidacion } from "@/lib/ui/referencia-linea-liquidacion";
import { Badge } from "@/components/ui/badge";
import { BadgeEstado } from "@/components/ui/badge-estado";
import { PopoverSnapshotRegla } from "@/components/dinero/popover-snapshot-regla";
import { BotonDescargaPdfLiquidacion } from "../boton-descarga-pdf-liquidacion";

export const metadata: Metadata = {
  title: "Detalle de liquidación",
};

const TEXTO_METODO_PAYOUT: Record<MetodoPayout, string> = {
  fintoc: "Transferencia (Fintoc)",
  manual: "Pago manual",
  nomina: "Nómina",
};

function formatearFechaCorta(fechaIso: string): string {
  if (!fechaIso || fechaIso.length < 10) return fechaIso;
  const [anio, mes, dia] = fechaIso.slice(0, 10).split("-");
  return `${dia}/${mes}/${anio}`;
}

function formatearFechaHora(fechaIso: string | null): string | null {
  if (!fechaIso) return null;
  const fecha = new Date(fechaIso);
  if (Number.isNaN(fecha.getTime())) return fechaIso;
  return fecha.toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" });
}

interface PageProps {
  params: Promise<{ liquidacionId: string }>;
}

export default async function PaginaDetalleLiquidacion({ params }: PageProps) {
  const sesion = await obtenerSesionActual();
  if (!sesion) redirect("/login");
  if (!sesion.usuario.tenantId) redirect("/login");
  if (!puedeGestionarLiquidacionesConductores(sesion.usuario)) redirect("/dashboard");

  const { liquidacionId } = await params;
  const tenantId = sesion.usuario.tenantId;
  const cliente = crearClienteServiceRole();

  let liquidacion;
  let payout: PayoutConductor | null = null;
  let conductorNombre = "—";
  let errorCarga = false;

  try {
    liquidacion = await obtenerLiquidacion(cliente, tenantId, liquidacionId);
    if (!liquidacion) redirect("/dinero/liquidaciones");

    const [{ data: conductorData }, payoutData] = await Promise.all([
      cliente
        .from("conductores")
        .select("nombre_completo")
        .eq("id", liquidacion.driverId)
        .eq("tenant_id", tenantId)
        .maybeSingle(),
      obtenerPayoutPorLiquidacion(cliente, tenantId, liquidacionId),
    ]);
    conductorNombre = (conductorData?.nombre_completo as string) ?? liquidacion.driverId;
    payout = payoutData;
  } catch (error) {
    // `redirect()` (arriba, cuando la liquidación no existe o es de otro
    // tenant) funciona lanzando una excepción interna de Next.js con un
    // digest especial que el framework intercepta más arriba en el árbol.
    // Un `catch` genérico como este la atraparía como si fuera un error de
    // datos real y la convertiría en el mensaje "no se pudo cargar" en vez
    // de redirigir — `unstable_rethrow` reenvía esa excepción de control de
    // Next.js intacta y solo trata como error real lo que de verdad lo es.
    unstable_rethrow(error);
    errorCarga = true;
  }

  if (errorCarga || !liquidacion) {
    return (
      <div
        role="alert"
        className="rounded-lg bg-destructive-subtle px-4 py-3 text-sm text-destructive-subtle-foreground"
      >
        No se pudo cargar la liquidación. Intenta recargar la página.
      </div>
    );
  }

  const lineas: LineaLiquidacion[] = liquidacion.lineas ?? [];
  const montoConAjustes =
    liquidacion.montoTotalClp !== null
      ? liquidacion.montoTotalClp + liquidacion.bonoClp - liquidacion.penalizacionClp
      : null;

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav aria-label="Migajas de pan" className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link href="/dinero/liquidaciones" className="hover:text-foreground hover:underline">
          Liquidaciones
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-foreground">Detalle</span>
      </nav>

      <Link
        href="/dinero/liquidaciones"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        Volver a liquidaciones
      </Link>

      {/* Sección A — Encabezado */}
      <section>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              <Link
                href={`/conductores/${liquidacion.driverId}`}
                className="font-medium text-foreground hover:underline"
              >
                {conductorNombre}
              </Link>
            </p>
            <p className="text-base text-muted-foreground">
              {formatearFechaCorta(liquidacion.fechaInicio)} – {formatearFechaCorta(liquidacion.fechaFin)}
            </p>
            <BadgeEstado variante={BADGE_ESTADO_LIQUIDACION[liquidacion.estado]} texto={traducirEstadoLiquidacion(liquidacion.estado)} />
            <p className="text-3xl font-semibold tabular-nums">{formatearCLPOGuion(montoConAjustes)}</p>
            {(liquidacion.bonoClp > 0 || liquidacion.penalizacionClp > 0) && (
              <p className="text-sm text-muted-foreground">
                Base: <span className="font-medium tabular-nums">{formatearCLPOGuion(liquidacion.montoTotalClp)}</span>
                {liquidacion.bonoClp > 0 && (
                  <>
                    {" "}
                    · Bono: <span className="font-medium tabular-nums text-success">+{formatearCLP(liquidacion.bonoClp)}</span>
                  </>
                )}
                {liquidacion.penalizacionClp > 0 && (
                  <>
                    {" "}
                    · Penalización:{" "}
                    <span className="font-medium tabular-nums text-destructive">
                      −{formatearCLP(liquidacion.penalizacionClp)}
                    </span>
                  </>
                )}
              </p>
            )}
            {liquidacion.notaAjuste && (
              <p className="text-sm text-muted-foreground italic">&ldquo;{liquidacion.notaAjuste}&rdquo;</p>
            )}
          </div>

          {liquidacion.pdfRef && (
            <div className="shrink-0">
              <BotonDescargaPdfLiquidacion pdfRef={liquidacion.pdfRef} />
            </div>
          )}
        </div>
      </section>

      {/* Sección B — Bloque de payout (si existe) */}
      {payout && (
        <section aria-labelledby="payout-titulo" className="rounded-lg border bg-card p-5 shadow-sm">
          <h2
            id="payout-titulo"
            className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Pago al conductor
          </h2>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <BadgeEstado variante={BADGE_ESTADO_PAYOUT[payout.estado]} texto={traducirEstadoPayout(payout.estado)} />

              <div className="flex flex-wrap gap-6 pt-1">
                <div>
                  <p className="text-xs text-muted-foreground">Monto bruto</p>
                  <p className="text-sm font-semibold tabular-nums">{formatearCLP(payout.montoBrutoClp)}</p>
                </div>
                {payout.montoRetencionClp > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground">Retención</p>
                    <p className="text-sm font-semibold tabular-nums">{formatearCLP(payout.montoRetencionClp)}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-muted-foreground">Monto líquido</p>
                  <p className="text-sm font-bold tabular-nums">{formatearCLP(payout.montoLiquidoClp)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Método</p>
                  <p className="text-sm font-semibold">{TEXTO_METODO_PAYOUT[payout.metodo] ?? payout.metodo}</p>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                Solicitado el {formatearFechaHora(payout.solicitadoEn)}
                {payout.confirmadoEn && <> · Confirmado el {formatearFechaHora(payout.confirmadoEn)}</>}
              </p>

              {(payout.estado === "rechazado" || payout.estado === "fallido") && payout.errorDescripcion && (
                <div className="mt-2 flex items-start gap-1.5 rounded-md bg-destructive-subtle px-2.5 py-2 text-xs text-destructive-subtle-foreground">
                  <AlertTriangle className="mt-0.5 size-3.5 flex-shrink-0" aria-hidden="true" />
                  <span>{payout.errorDescripcion}</span>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Sección C — Tabla de líneas */}
      <section aria-labelledby="lineas-titulo">
        <h2
          id="lineas-titulo"
          className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Entregas liquidadas ({lineas.length} línea{lineas.length !== 1 ? "s" : ""})
        </h2>

        {lineas.length === 0 ? (
          <div className="rounded-lg border bg-card px-6 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              Esta liquidación no tiene líneas todavía. Se agregarán automáticamente a medida que
              se registren entregas del conductor.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label="Líneas de liquidación">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2">Pedido</th>
                    <th className="hidden px-4 py-2 sm:table-cell">Fecha entrega</th>
                    <th className="px-4 py-2">Concepto</th>
                    <th className="hidden px-4 py-2 text-right lg:table-cell">Monto base</th>
                    <th className="hidden px-4 py-2 text-right lg:table-cell">Ajuste</th>
                    <th className="px-4 py-2 text-right">Monto final</th>
                    <th className="hidden px-4 py-2 text-center xl:table-cell">Por qué</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {lineas.map((linea) => (
                    <FilaLinea key={linea.id} linea={linea} />
                  ))}
                </tbody>
                <tfoot className="border-t bg-muted/40">
                  <tr>
                    <td colSpan={5} className="px-4 py-3 text-sm font-semibold">
                      Total: {lineas.length} línea{lineas.length !== 1 ? "s" : ""}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-bold tabular-nums">
                      {formatearCLPOGuion(lineas.reduce((acc, l) => acc + l.montoFinalClp, 0))}
                    </td>
                    <td className="hidden xl:table-cell" />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

// =============================================================================
// Fila de línea de liquidación
// =============================================================================

function FilaLinea({ linea }: { linea: LineaLiquidacion }) {
  const ajuste = formatearAjuste(linea.ajusteIncidenciaClp);
  const referencia = referenciaLineaLiquidacion(linea);

  return (
    <tr className="hover:bg-muted/30 transition-colors">
      <td className="px-4 py-3">
        {referencia.href ? (
          <Link
            href={referencia.href}
            title={referencia.titulo ?? undefined}
            className="font-mono text-xs text-primary hover:underline"
          >
            {referencia.etiqueta}
          </Link>
        ) : (
          // Una línea de retiro no lleva a ningún pedido: no se pinta un enlace
          // muerto ni un id que no existe.
          <span title={referencia.titulo ?? undefined} className="text-xs text-muted-foreground">
            {referencia.etiqueta}
          </span>
        )}
      </td>
      <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
        {formatearFechaCorta(linea.fechaHecho)}
      </td>
      <td className="px-4 py-3 text-muted-foreground max-w-[220px] truncate">{linea.concepto}</td>
      <td className="hidden px-4 py-3 text-right tabular-nums text-muted-foreground lg:table-cell">
        {formatearCLP(linea.montoBaseClp)}
      </td>
      <td className="hidden px-4 py-3 text-right tabular-nums lg:table-cell">
        <span
          className={
            ajuste.esNegativo ? "text-destructive" : ajuste.esPositivo ? "text-success" : "text-muted-foreground"
          }
        >
          {ajuste.texto}
        </span>
      </td>
      <td className="px-4 py-3 text-right tabular-nums font-semibold">{formatearCLP(linea.montoFinalClp)}</td>
      <td className="hidden px-4 py-3 text-center xl:table-cell">
        <PopoverSnapshotRegla snapshotRegla={linea.snapshotRegla} iconoSolo />
      </td>
    </tr>
  );
}
