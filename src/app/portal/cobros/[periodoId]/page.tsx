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
  BADGE_ESTADO_PERIODO,
  traducirEstadoSii,
  badgeEstadoSii,
  traducirEstadoCobroPeriodo,
  BADGE_ESTADO_COBRO_PERIODO,
} from "@/lib/ui/traduccion-estados";
import { formatearCLP, formatearCLPOGuion } from "@/lib/ui/formato-moneda";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  // Si el período fue anulado, la nota de crédito (61) que referencia al 33.
  let notaCredito: DocumentoDte | null = null;
  let errorCarga = false;

  try {
    periodo = await obtenerPeriodoCobro(cliente, tenantId, periodoId);

    // Verificar que el período pertenece al seller autenticado
    // (RLS lo garantiza en BD, pero verificamos también en la app)
    if (!periodo || periodo.sellerId !== sellerId) {
      redirect("/portal/cobros");
    }

    // El seller debe poder cuadrar AMBOS documentos del SII: la factura (33) y,
    // si la hubo, su nota de crédito (61). Por eso se buscan los dos por tipo.
    const dtes = await listarDocumentosDte(cliente, tenantId, sellerId);
    dte = dtes.find((d) => d.periodoCobroidId === periodoId && d.tipoDocumento === 33) ?? null;
    notaCredito = dtes.find((d) => d.periodoCobroidId === periodoId && d.tipoDocumento === 61) ?? null;
  } catch {
    errorCarga = true;
  }

  if (errorCarga || !periodo) {
    return (
      <div className="mx-auto max-w-4xl">
        <div
          role="alert"
          className="rounded-lg bg-destructive-subtle px-4 py-3 text-sm text-destructive-subtle-foreground"
        >
          No se pudo cargar el período. Intenta recargar la página.
        </div>
      </div>
    );
  }

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
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={BADGE_ESTADO_PERIODO[periodo.estado]}>{textoBadge}</Badge>
            {periodo.estadoCobro !== "no_aplica" && (
              <Badge variant={BADGE_ESTADO_COBRO_PERIODO[periodo.estadoCobro]}>
                {traducirEstadoCobroPeriodo(periodo.estadoCobro)}
              </Badge>
            )}
          </div>
          <p className="text-3xl font-bold tabular-nums">
            {formatearCLPOGuion(periodo.montoTotalClp)}
          </p>
          {periodo.estadoCobro === "parcial" && (
            <p className="text-sm text-muted-foreground">
              Pagado: <span className="font-medium tabular-nums">{formatearCLP(periodo.montoPagadoClp)}</span> · Saldo:{" "}
              <span className="font-medium tabular-nums">
                {formatearCLP(Math.max(0, (periodo.montoTotalClp ?? 0) - periodo.montoPagadoClp))}
              </span>
            </p>
          )}
          {periodo.estadoCobro === "pagado" && (
            <p className="text-sm font-medium text-success">Pago recibido. Gracias.</p>
          )}
        </div>
      </section>

      {/* Sección A.1 — Anulación con nota de crédito (RF-038) */}
      {periodo.estado === "anulado" && (
        <section
          aria-labelledby="anulacion-titulo"
          className="rounded-xl bg-warning-subtle p-5 text-warning-subtle-foreground"
        >
          <h2 id="anulacion-titulo" className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
            Factura anulada con nota de crédito
          </h2>
          <p className="text-sm">
            Esta factura fue anulada por tu empresa de despacho. No tienes saldo por pagar de este
            período; las entregas se vuelven a facturar en el período en curso.
            {periodo.anuladoEn ? ` Anulada el ${formatearFechaCorta(periodo.anuladoEn)}.` : ""}
          </p>
          {periodo.motivoAnulacion && (
            <p className="mt-2 text-sm">
              <span className="font-medium">Motivo:</span> {periodo.motivoAnulacion}
            </p>
          )}
          {notaCredito ? (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm">
                Nota de crédito{" "}
                <span className="font-semibold tabular-nums">Folio {notaCredito.folio}</span>
                {" · "}
                <span className="tabular-nums">{formatearCLP(notaCredito.montoTotalClp)}</span>
              </p>
              {notaCredito.pdfRef && (
                <div className="shrink-0">
                  <BotonDescargaFacturaPdf
                    pdfRef={notaCredito.pdfRef}
                    etiqueta="Descargar nota de crédito (PDF)"
                  />
                </div>
              )}
            </div>
          ) : (
            <p className="mt-2 text-sm opacity-80">
              La nota de crédito se está emitiendo. Recarga la página en unos segundos.
            </p>
          )}
        </section>
      )}

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
                <p className="mt-2 rounded-lg bg-warning-subtle px-3 py-2 text-sm text-warning-subtle-foreground">
                  Esta factura fue aceptada por el SII con observaciones. Si tienes dudas,
                  contacta a tu empresa de despacho.
                </p>
              )}
              {dte.estadoSii === "rechazado" && (
                <p className="mt-2 rounded-lg bg-destructive-subtle px-3 py-2 text-sm text-destructive-subtle-foreground">
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
          <DataTable>
            <Table densidad="relaxed" aria-label="Detalle de líneas del período">
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="px-4">Pedido</TableHead>
                  <TableHead className="hidden px-4 sm:table-cell">Fecha entrega</TableHead>
                  <TableHead className="px-4">Concepto</TableHead>
                  <TableHead className="px-4 text-right">Monto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lineas.map((linea) => (
                  <TableRow key={linea.id}>
                    <TableCell className="px-4">
                      <span className="font-mono text-xs text-muted-foreground">
                        #{linea.pedidoId.slice(0, 8)}
                      </span>
                    </TableCell>
                    <TableCell className="hidden px-4 text-muted-foreground sm:table-cell">
                      {formatearFechaCorta(linea.fechaEntrega)}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate px-4 text-muted-foreground">
                      {linea.concepto}
                    </TableCell>
                    <TableCell className="px-4 text-right font-semibold tabular-nums">
                      {formatearCLP(linea.montoFinalClp)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3} className="px-4 text-sm font-semibold">
                    Total
                  </TableCell>
                  <TableCell className="px-4 text-right text-sm font-bold tabular-nums">
                    {formatearCLPOGuion(periodo.montoTotalClp)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </DataTable>
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

  return (
    <Badge variant={badgeEstadoSii(trad.variante)} className="gap-1.5 px-2.5">
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
    </Badge>
  );
}
