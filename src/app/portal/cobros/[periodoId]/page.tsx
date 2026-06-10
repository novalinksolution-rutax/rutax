/**
 * Pantalla S-2 — Detalle de período (vista seller).
 *
 * Server Component. Solo lectura. RLS garantiza que el seller solo ve sus datos.
 * Criterios C-1, C-2 (sin datos de conductor), C-3 (signed URL), C-5, C-7.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, CheckCircle, Clock, XCircle } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { obtenerPeriodoCobro, listarDocumentosDte } from "@/modules/dinero/index";
import type { DocumentoDte, LineaCobro } from "@/modules/dinero/tipos";
import {
  traducirEstadoPeriodoCobro,
  COLOR_ESTADO_PERIODO,
  traducirEstadoSii,
  colorBadgeEstadoSii,
} from "@/lib/ui/traduccion-estados";
import { formatearCLP, formatearCLPOGuion } from "@/lib/ui/formato-moneda";
import { BotonDescargaFacturaPdf } from "./boton-descarga-factura-pdf";

export const metadata: Metadata = {
  title: "Detalle de período",
};

function formatearFechaCorta(fechaIso: string): string {
  if (!fechaIso || fechaIso.length < 10) return fechaIso;
  const [anio, mes, dia] = fechaIso.slice(0, 10).split("-");
  return `${dia}/${mes}/${anio}`;
}

interface PageProps {
  params: Promise<{ periodoId: string }>;
}

export default async function PaginaDetallePeriodoSeller({ params }: PageProps) {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) redirect("/login");
  if (sesion.usuario.tipoUsuario !== "seller" || !sesion.usuario.sellerId) redirect("/portal");

  const { periodoId } = await params;
  const sellerId = sesion.usuario.sellerId;
  const tenantId = sesion.usuario.tenantId;

  const cliente = crearClienteServiceRole();
  let periodo;
  let dte: DocumentoDte | null = null;
  let errorCarga = false;

  try {
    periodo = await obtenerPeriodoCobro(cliente, tenantId, periodoId);

    // Verificar que el período pertenece al seller autenticado
    // (RLS lo garantiza en BD, pero verificamos también en la app)
    if (!periodo || periodo.sellerId !== sellerId) {
      redirect("/portal/cobros");
    }

    if (periodo.documentoDteId) {
      const dtes = await listarDocumentosDte(cliente, tenantId, sellerId);
      dte = dtes.find((d) => d.periodoCobroidId === periodoId) ?? null;
    }
  } catch {
    errorCarga = true;
  }

  if (errorCarga || !periodo) {
    return (
      <div className="mx-auto max-w-4xl">
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          No se pudo cargar el período. Intenta recargar la página.
        </div>
      </div>
    );
  }

  const badgeClases = COLOR_ESTADO_PERIODO[periodo.estado];
  const textoBadge = traducirEstadoPeriodoCobro(
    periodo.estado,
    periodo.estado === "facturado" && dte ? dte.folio : undefined,
  );

  const lineas: LineaCobro[] = periodo.lineas ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Breadcrumb */}
      <nav aria-label="Migajas de pan" className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link href="/portal/cobros" className="hover:text-foreground hover:underline">
          Estado de cuenta
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-foreground">Detalle</span>
      </nav>

      {/* Sección A — Encabezado */}
      <section>
        <div className="space-y-2">
          <p className="text-base text-muted-foreground">
            {formatearFechaCorta(periodo.fechaInicio)} –{" "}
            {formatearFechaCorta(periodo.fechaFin)}
          </p>
          <span
            className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${badgeClases}`}
          >
            {textoBadge}
          </span>
          <p className="text-3xl font-bold tabular-nums">
            {formatearCLPOGuion(periodo.montoTotalClp)}
          </p>
        </div>
      </section>

      {/* Sección B — Bloque "Factura" (solo si hay DTE) */}
      {dte && (
        <section
          aria-labelledby="factura-titulo"
          className="rounded-xl border bg-card p-5 shadow-sm"
        >
          <h2
            id="factura-titulo"
            className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Tu factura
          </h2>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <p className="text-2xl font-bold tabular-nums">Folio {dte.folio}</p>
              <p className="text-sm text-muted-foreground">
                Emitida el {formatearFechaCorta(dte.fechaEmision)}
              </p>
              <p className="text-xl font-bold tabular-nums">
                {formatearCLP(dte.montoTotalClp)}
              </p>

              {/* Badge estado SII — criterio C-5 */}
              <BadgeEstadoSii estadoSii={dte.estadoSii} />

              {/* Mensajes contextuales (sin detalles técnicos para el seller) */}
              {dte.estadoSii === "aceptado_con_discrepancias" && (
                <p className="mt-2 rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
                  Esta factura fue aceptada por el SII con observaciones. Si tienes dudas,
                  contacta a tu empresa de despacho.
                </p>
              )}
              {dte.estadoSii === "rechazado" && (
                <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  Esta factura fue rechazada por el SII. Tu empresa de despacho está
                  trabajando en resolverlo.
                </p>
              )}
            </div>

            {/* Botón descarga — criterio C-3, solo PDF para el seller */}
            {dte.pdfRef && (
              <div className="shrink-0">
                <BotonDescargaFacturaPdf pdfRef={dte.pdfRef} />
              </div>
            )}
          </div>
        </section>
      )}

      {/* Sección C — Lista de líneas (sin monto base ni ajuste — criterio C-2) */}
      <section aria-labelledby="lineas-titulo">
        <h2
          id="lineas-titulo"
          className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Detalle de entregas ({lineas.length} línea{lineas.length !== 1 ? "s" : ""})
        </h2>

        {lineas.length === 0 ? (
          <div className="rounded-xl border bg-card px-6 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              Este período aún no tiene líneas registradas.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label="Detalle de líneas del período">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2">Pedido</th>
                    <th className="hidden px-4 py-2 sm:table-cell">Fecha entrega</th>
                    <th className="px-4 py-2">Concepto</th>
                    <th className="px-4 py-2 text-right">Monto</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {lineas.map((linea) => (
                    <tr key={linea.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-muted-foreground">
                          #{linea.pedidoId.slice(0, 8)}
                        </span>
                      </td>
                      <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
                        {formatearFechaCorta(linea.fechaEntrega)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground max-w-[200px] truncate">
                        {linea.concepto}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">
                        {formatearCLP(linea.montoFinalClp)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t bg-muted/40">
                  <tr>
                    <td colSpan={3} className="px-4 py-3 text-sm font-semibold">
                      Total
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-bold tabular-nums">
                      {formatearCLPOGuion(periodo.montoTotalClp)}
                    </td>
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
// Componentes auxiliares
// =============================================================================

function BadgeEstadoSii({ estadoSii }: { estadoSii: DocumentoDte["estadoSii"] }) {
  const trad = traducirEstadoSii(estadoSii);
  const colorClases = colorBadgeEstadoSii(trad.variante);

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${colorClases}`}
    >
      {trad.variante === "advertencia" && (
        <AlertTriangle className="size-3.5 flex-shrink-0" aria-hidden="true" />
      )}
      {trad.variante === "exito" && (
        <CheckCircle className="size-3.5 flex-shrink-0" aria-hidden="true" />
      )}
      {trad.variante === "error" && (
        <XCircle className="size-3.5 flex-shrink-0" aria-hidden="true" />
      )}
      {trad.variante === "neutro" && (
        <Clock className="size-3.5 flex-shrink-0" aria-hidden="true" />
      )}
      {trad.texto}
    </span>
  );
}
