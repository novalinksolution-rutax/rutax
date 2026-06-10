/**
 * Pantalla D-2 — Detalle de período de cobro.
 *
 * Server Component. Lee el período y sus líneas.
 * Criterios C-1 (montos CLP), C-3 (signed URLs PDF/XML), C-5 (badge SII), C-7 (folio).
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, CheckCircle, Clock, XCircle, Settings, PenLine } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeEmitirFacturas } from "@/modules/identidad/capacidades";
import { obtenerPeriodoCobro, listarDocumentosDte } from "@/modules/dinero/index";
import type { DocumentoDte, LineaCobro } from "@/modules/dinero/tipos";
import {
  traducirEstadoPeriodoCobro,
  COLOR_ESTADO_PERIODO,
  traducirEstadoSii,
  colorBadgeEstadoSii,
} from "@/lib/ui/traduccion-estados";
import { formatearCLP, formatearCLPOGuion, formatearAjuste } from "@/lib/ui/formato-moneda";
import { DialogCerrarPeriodo } from "../dialog-cerrar-periodo";
import { BotonDescargaDocumento } from "./boton-descarga-documento";

export const metadata: Metadata = {
  title: "Detalle de período",
};

function formatearFechaCorta(fechaIso: string): string {
  if (!fechaIso || fechaIso.length < 10) return fechaIso;
  const [anio, mes, dia] = fechaIso.slice(0, 10).split("-");
  return `${dia}/${mes}/${anio}`;
}

const LIMITE_LINEAS = 50;

interface PageProps {
  params: Promise<{ periodoId: string }>;
  searchParams: Promise<{ pagina?: string }>;
}

export default async function PaginaDetallePeriodo({ params, searchParams }: PageProps) {
  const sesion = await obtenerSesionActual();
  if (!sesion) redirect("/login");
  if (!sesion.usuario.tenantId) redirect("/login");
  if (!puedeEmitirFacturas(sesion.usuario)) redirect("/dashboard");

  const { periodoId } = await params;
  const sp = await searchParams;
  const pagina = Math.max(1, parseInt(sp.pagina ?? "1", 10));
  const tenantId = sesion.usuario.tenantId;

  const cliente = crearClienteServiceRole();

  let periodo;
  let dte: DocumentoDte | null = null;
  let sellerNombre = "—";
  let errorCarga = false;

  try {
    periodo = await obtenerPeriodoCobro(cliente, tenantId, periodoId);
    if (!periodo) redirect("/dinero/periodos");

    // Obtener nombre del seller
    const { data: sellerData } = await cliente
      .from("sellers")
      .select("razon_social")
      .eq("id", periodo.sellerId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    sellerNombre = (sellerData?.razon_social as string) ?? periodo.sellerId;

    // Obtener DTE si existe
    if (periodo.documentoDteId) {
      const dtes = await listarDocumentosDte(cliente, tenantId, periodo.sellerId);
      dte = dtes.find((d) => d.periodoCobroidId === periodoId) ?? null;
    }
  } catch {
    errorCarga = true;
  }

  if (errorCarga || !periodo) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
      >
        No se pudo cargar el período. Intenta recargar la página.
      </div>
    );
  }

  const lineas: LineaCobro[] = periodo.lineas ?? [];
  const totalPaginas = Math.ceil(lineas.length / LIMITE_LINEAS);
  const offset = (pagina - 1) * LIMITE_LINEAS;
  const lineasPaginadas = lineas.slice(offset, offset + LIMITE_LINEAS);

  const badgeClases = COLOR_ESTADO_PERIODO[periodo.estado];
  const textoBadge = traducirEstadoPeriodoCobro(
    periodo.estado,
    periodo.estado === "facturado" && dte ? dte.folio : undefined,
  );

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav aria-label="Migajas de pan" className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link href="/dinero/periodos" className="hover:text-foreground hover:underline">
          Períodos de cobro
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-foreground">Detalle</span>
      </nav>

      {/* Sección A — Encabezado */}
      <section>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              <Link
                href="/sellers"
                className="font-medium text-foreground hover:underline"
              >
                {sellerNombre}
              </Link>
            </p>
            <p className="text-base text-muted-foreground">
              {formatearFechaCorta(periodo.fechaInicio)} – {formatearFechaCorta(periodo.fechaFin)}
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

          {periodo.estado === "abierto" && (
            <div className="shrink-0">
              <DialogCerrarPeriodo
                periodoId={periodo.id}
                sellerNombre={sellerNombre}
                fechaInicio={periodo.fechaInicio}
                fechaFin={periodo.fechaFin}
                totalLineas={periodo.totalLineas}
                montoTotalClp={periodo.montoTotalClp}
              />
            </div>
          )}
        </div>
      </section>

      {/* Sección B — Bloque DTE (solo si hay DTE) */}
      {dte && (
        <section
          aria-labelledby="dte-titulo"
          className="rounded-xl border bg-card p-5 shadow-sm"
        >
          <h2
            id="dte-titulo"
            className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Factura emitida
          </h2>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <p className="text-2xl font-bold tabular-nums">
                Folio {dte.folio}
              </p>
              <p className="text-sm text-muted-foreground">
                Emitida el {formatearFechaCorta(dte.fechaEmision)}
              </p>

              <div className="flex flex-wrap gap-6 pt-1">
                <div>
                  <p className="text-xs text-muted-foreground">Neto</p>
                  <p className="text-sm font-semibold tabular-nums">
                    {formatearCLP(dte.montoNetoclp)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">IVA</p>
                  <p className="text-sm font-semibold tabular-nums">
                    {formatearCLP(dte.montoIvaClp)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total</p>
                  <p className="text-sm font-bold tabular-nums">
                    {formatearCLP(dte.montoTotalClp)}
                  </p>
                </div>
              </div>

              {/* Badge estado SII — criterio C-5 */}
              <BadgeEstadoSii estadoSii={dte.estadoSii} />

              {/* Mensaje de rechazo — sin datos técnicos */}
              {dte.estadoSii === "rechazado" && dte.errorDescripcion && (
                <div className="mt-2">
                  <p className="text-xs font-semibold text-muted-foreground">
                    Motivo del rechazo:
                  </p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground break-all">
                    {dte.errorDescripcion}
                  </p>
                </div>
              )}
            </div>

            {/* Botones descarga — criterio C-3 */}
            <div className="flex flex-col gap-2 shrink-0">
              {dte.pdfRef && (
                <BotonDescargaDocumento
                  tipo="pdf-dte"
                  referencia={dte.pdfRef}
                  etiqueta="Ver PDF"
                />
              )}
              {dte.xmlDteRef && (
                <BotonDescargaDocumento
                  tipo="xml-dte"
                  referencia={dte.xmlDteRef}
                  etiqueta="Ver XML"
                />
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
          Líneas de cobro ({lineas.length} línea{lineas.length !== 1 ? "s" : ""})
        </h2>

        {lineas.length === 0 ? (
          <div className="rounded-xl border bg-card px-6 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              Este período no tiene líneas todavía. Se agregarán automáticamente a medida que
              se registren entregas.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label="Líneas de cobro del período">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2">Pedido</th>
                    <th className="hidden px-4 py-2 sm:table-cell">Fecha entrega</th>
                    <th className="hidden px-4 py-2 md:table-cell">Tipo</th>
                    <th className="px-4 py-2">Concepto</th>
                    <th className="hidden px-4 py-2 text-right lg:table-cell">Monto base</th>
                    <th className="hidden px-4 py-2 text-right lg:table-cell">Ajuste</th>
                    <th className="px-4 py-2 text-right">Monto final</th>
                    <th className="hidden px-4 py-2 text-center xl:table-cell">Origen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {lineasPaginadas.map((linea) => (
                    <FilaLinea key={linea.id} linea={linea} />
                  ))}
                </tbody>
                {/* Fila de totales sticky al pie */}
                <tfoot className="border-t bg-muted/40">
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-3 text-sm font-semibold"
                    >
                      Total: {lineas.length} línea{lineas.length !== 1 ? "s" : ""}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-bold tabular-nums">
                      {formatearCLPOGuion(
                        lineas.reduce((acc, l) => acc + l.montoFinalClp, 0),
                      )}
                    </td>
                    <td className="hidden xl:table-cell" />
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Paginación de líneas */}
            {totalPaginas > 1 && (
              <div className="flex items-center justify-between border-t px-4 py-3">
                <span className="text-xs text-muted-foreground">
                  Página {pagina} de {totalPaginas}
                </span>
                <div className="flex gap-2">
                  {pagina > 1 && (
                    <Link
                      href={`/dinero/periodos/${periodoId}?pagina=${pagina - 1}`}
                      className="rounded border px-3 py-1 text-xs hover:bg-muted transition-colors"
                    >
                      Anterior
                    </Link>
                  )}
                  {pagina < totalPaginas && (
                    <Link
                      href={`/dinero/periodos/${periodoId}?pagina=${pagina + 1}`}
                      className="rounded border px-3 py-1 text-xs hover:bg-muted transition-colors"
                    >
                      Siguiente
                    </Link>
                  )}
                </div>
              </div>
            )}
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

function FilaLinea({ linea }: { linea: LineaCobro }) {
  const ajuste = formatearAjuste(linea.ajusteIncidenciaClp);

  return (
    <tr className="hover:bg-muted/30 transition-colors">
      <td className="px-4 py-3">
        <span className="font-mono text-xs text-muted-foreground">
          {linea.pedidoId.slice(0, 8)}…
        </span>
      </td>
      <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
        {formatearFechaCorta(linea.fechaEntrega)}
      </td>
      <td className="hidden px-4 py-3 md:table-cell">
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium capitalize">
          {linea.tipoPedido === "flex" ? "Flex" : "Same-day"}
        </span>
      </td>
      <td className="px-4 py-3 text-muted-foreground max-w-[200px] truncate">
        {linea.concepto}
      </td>
      <td className="hidden px-4 py-3 text-right tabular-nums text-muted-foreground lg:table-cell">
        {formatearCLP(linea.montoBaseClp)}
      </td>
      <td className="hidden px-4 py-3 text-right tabular-nums lg:table-cell">
        <span
          className={
            ajuste.esNegativo
              ? "text-red-700"
              : ajuste.esPositivo
              ? "text-green-700"
              : "text-muted-foreground"
          }
        >
          {ajuste.texto}
        </span>
      </td>
      <td className="px-4 py-3 text-right tabular-nums font-semibold">
        {formatearCLP(linea.montoFinalClp)}
      </td>
      <td className="hidden px-4 py-3 text-center xl:table-cell">
        {linea.origenGeneracion === "motor_automatico" ? (
          <span title="Generado automáticamente por el motor">
            <Settings className="size-4 text-muted-foreground mx-auto" aria-label="Motor automático" />
          </span>
        ) : (
          <span title="Ajuste manual">
            <PenLine className="size-4 text-muted-foreground mx-auto" aria-label="Ajuste manual" />
          </span>
        )}
      </td>
    </tr>
  );
}
