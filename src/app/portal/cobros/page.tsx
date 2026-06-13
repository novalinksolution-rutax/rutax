/**
 * Pantalla S-1 — Estado de cuenta del seller.
 *
 * Server Component. Solo lectura. RLS garantiza que el seller solo ve sus períodos.
 * Criterios C-1 (montos CLP), C-7 (badge facturado con folio).
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, CheckCircle, Clock, XCircle, Receipt } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { listarPeriodosCobro, listarDocumentosDte } from "@/modules/dinero/index";
import type { PeriodoCobro, DocumentoDte } from "@/modules/dinero/tipos";
import {
  traducirEstadoPeriodoCobro,
  COLOR_ESTADO_PERIODO,
  traducirEstadoSii,
  colorBadgeEstadoSii,
  traducirEstadoCobroPeriodo,
  COLOR_ESTADO_COBRO_PERIODO,
} from "@/lib/ui/traduccion-estados";
import { formatearCLPOGuion } from "@/lib/ui/formato-moneda";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable } from "@/components/ui/data-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata: Metadata = {
  title: "Estado de cuenta",
};

function formatearFechaCorta(fechaIso: string): string {
  if (!fechaIso || fechaIso.length < 10) return fechaIso;
  const [anio, mes, dia] = fechaIso.slice(0, 10).split("-");
  return `${dia}/${mes}/${anio}`;
}

interface PeriodoConDte extends PeriodoCobro {
  dte: DocumentoDte | null;
}

export default async function PaginaCobrosPortal() {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) redirect("/login");
  if (sesion.usuario.tipoUsuario !== "seller" || !sesion.usuario.sellerId) redirect("/portal");

  const sellerId = sesion.usuario.sellerId;
  const tenantId = sesion.usuario.tenantId;

  const cliente = crearClienteServiceRole();
  let periodosConDte: PeriodoConDte[] = [];
  let contAbiertos = 0;
  let contFacturados = 0;
  let errorCarga = false;

  try {
    const [periodos, dtes] = await Promise.all([
      listarPeriodosCobro(cliente, tenantId, sellerId),
      listarDocumentosDte(cliente, tenantId, sellerId),
    ]);

    const dteMap = new Map<string, DocumentoDte>(
      dtes.map((d) => [d.periodoCobroidId, d]),
    );

    for (const p of periodos) {
      if (p.estado === "abierto") contAbiertos++;
      else if (p.estado === "facturado") contFacturados++;
    }

    periodosConDte = periodos.map((p) => ({
      ...p,
      dte: dteMap.get(p.id) ?? null,
    }));
  } catch {
    errorCarga = true;
  }

  const chips = [
    { label: "Abiertos", count: contAbiertos, clases: "bg-info-subtle text-info-subtle-foreground" },
    { label: "Facturados", count: contFacturados, clases: "bg-success-subtle text-success-subtle-foreground" },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
          Estado de cuenta
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tus períodos de cobro y facturas. Solo lectura.
        </p>
      </div>

      {/* Chips de resumen */}
      {!errorCarga && (
        <div className="flex flex-wrap gap-2" role="list" aria-label="Resumen de períodos">
          {chips.map((chip) => (
            <div
              key={chip.label}
              role="listitem"
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${chip.clases}`}
            >
              {chip.label}: <span className="font-bold tabular-nums">{chip.count}</span>
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {errorCarga && (
        <div
          role="alert"
          className="rounded-lg bg-destructive-subtle px-4 py-3 text-sm text-destructive-subtle-foreground"
        >
          No se pudo cargar tu estado de cuenta. Intenta recargar la página.
        </div>
      )}

      {/* Lista / vacío */}
      {!errorCarga && periodosConDte.length === 0 ? (
        <EmptyState
          icon={Receipt}
          titulo="Aún no tienes cobros"
          descripcion="Aquí verás tus períodos y facturas cuando tu empresa de despacho registre tus entregas."
        />
      ) : (
        !errorCarga && (
          <DataTable>
            <Table densidad="relaxed" aria-label="Mis períodos de cobro">
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="px-4" style={{ width: "22%" }}>Período</TableHead>
                  <TableHead className="px-4" style={{ width: "18%" }}>Estado</TableHead>
                  <TableHead className="hidden px-4 text-right sm:table-cell" style={{ width: "10%" }}>
                    Líneas
                  </TableHead>
                  <TableHead className="hidden px-4 text-right md:table-cell" style={{ width: "18%" }}>
                    Monto total
                  </TableHead>
                  <TableHead className="px-4" style={{ width: "22%" }}>Factura</TableHead>
                  <TableHead className="px-4" style={{ width: "14%" }}>Pago</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {periodosConDte.map((periodo) => (
                  <FilaPeriodoSeller key={periodo.id} periodo={periodo} />
                ))}
              </TableBody>
            </Table>
          </DataTable>
        )
      )}
    </div>
  );
}

// =============================================================================
// Fila de período para el seller
// =============================================================================

function FilaPeriodoSeller({ periodo }: { periodo: PeriodoConDte }) {
  const badgeClases = COLOR_ESTADO_PERIODO[periodo.estado];
  const textoBadge = traducirEstadoPeriodoCobro(
    periodo.estado,
    periodo.estado === "facturado" && periodo.dte ? periodo.dte.folio : undefined,
  );

  return (
    <TableRow className="group">
      <TableCell className="px-4">
        <Link
          href={`/portal/cobros/${periodo.id}`}
          className="font-medium tabular-nums hover:underline"
        >
          {formatearFechaCorta(periodo.fechaInicio)} –{" "}
          {formatearFechaCorta(periodo.fechaFin)}
        </Link>
      </TableCell>
      <TableCell className="px-4">
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${badgeClases}`}>
          {textoBadge}
        </span>
      </TableCell>
      <TableCell className="hidden px-4 text-right text-muted-foreground tabular-nums sm:table-cell">
        {periodo.totalLineas}
      </TableCell>
      <TableCell className="hidden px-4 text-right font-medium tabular-nums md:table-cell">
        {formatearCLPOGuion(periodo.montoTotalClp)}
      </TableCell>
      <TableCell className="px-4">
        {periodo.dte ? (
          <BadgeEstadoSiiCompacto estadoSii={periodo.dte.estadoSii} />
        ) : (
          <span className="text-xs text-muted-foreground">Sin factura</span>
        )}
      </TableCell>
      <TableCell className="px-4">
        {periodo.estadoCobro === "no_aplica" ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${COLOR_ESTADO_COBRO_PERIODO[periodo.estadoCobro]}`}
          >
            {traducirEstadoCobroPeriodo(periodo.estadoCobro)}
          </span>
        )}
      </TableCell>
    </TableRow>
  );
}

function BadgeEstadoSiiCompacto({
  estadoSii,
}: {
  estadoSii: DocumentoDte["estadoSii"];
}) {
  const trad = traducirEstadoSii(estadoSii);
  const colorClases = colorBadgeEstadoSii(trad.variante);

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${colorClases}`}
    >
      {trad.variante === "advertencia" && (
        <AlertTriangle className="size-3 flex-shrink-0" aria-hidden="true" />
      )}
      {trad.variante === "exito" && (
        <CheckCircle className="size-3 flex-shrink-0" aria-hidden="true" />
      )}
      {trad.variante === "error" && (
        <XCircle className="size-3 flex-shrink-0" aria-hidden="true" />
      )}
      {trad.variante === "neutro" && (
        <Clock className="size-3 flex-shrink-0" aria-hidden="true" />
      )}
      {trad.texto}
    </span>
  );
}
