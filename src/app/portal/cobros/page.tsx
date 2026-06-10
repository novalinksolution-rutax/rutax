/**
 * Pantalla S-1 — Estado de cuenta del seller.
 *
 * Server Component. Solo lectura. RLS garantiza que el seller solo ve sus períodos.
 * Criterios C-1 (montos CLP), C-7 (badge facturado con folio).
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, CheckCircle, Clock, XCircle } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { listarPeriodosCobro, listarDocumentosDte } from "@/modules/dinero/index";
import type { PeriodoCobro, DocumentoDte } from "@/modules/dinero/tipos";
import {
  traducirEstadoPeriodoCobro,
  COLOR_ESTADO_PERIODO,
  traducirEstadoSii,
  colorBadgeEstadoSii,
} from "@/lib/ui/traduccion-estados";
import { formatearCLPOGuion } from "@/lib/ui/formato-moneda";

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
    {
      label: "Abiertos",
      count: contAbiertos,
      color: "bg-blue-50 border-blue-200 text-blue-800",
    },
    {
      label: "Facturados",
      count: contFacturados,
      color: "bg-green-50 border-green-200 text-green-800",
    },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
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
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium ${chip.color}`}
            >
              {chip.label}: <span className="font-bold">{chip.count}</span>
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {errorCarga && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          No se pudo cargar tu estado de cuenta. Intenta recargar la página.
        </div>
      )}

      {/* Lista / vacío */}
      {!errorCarga && periodosConDte.length === 0 ? (
        <div className="rounded-xl border bg-card px-6 py-12 text-center">
          <p className="text-muted-foreground">
            Aún no tienes períodos de cobro. Aparecerán aquí cuando comencemos a registrar
            entregas.
          </p>
        </div>
      ) : (
        !errorCarga && (
          <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label="Mis períodos de cobro">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2" style={{ width: "22%" }}>Período</th>
                    <th className="px-4 py-2" style={{ width: "18%" }}>Estado</th>
                    <th className="hidden px-4 py-2 text-right sm:table-cell" style={{ width: "10%" }}>Líneas</th>
                    <th className="hidden px-4 py-2 text-right md:table-cell" style={{ width: "20%" }}>Monto total</th>
                    <th className="px-4 py-2" style={{ width: "30%" }}>Factura</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {periodosConDte.map((periodo) => (
                    <FilaPeriodoSeller key={periodo.id} periodo={periodo} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
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
    <tr className="group hover:bg-muted/30 transition-colors">
      <td className="px-4 py-3">
        <Link
          href={`/portal/cobros/${periodo.id}`}
          className="font-medium hover:underline tabular-nums"
        >
          {formatearFechaCorta(periodo.fechaInicio)} –{" "}
          {formatearFechaCorta(periodo.fechaFin)}
        </Link>
      </td>
      <td className="px-4 py-3">
        <span
          className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${badgeClases}`}
        >
          {textoBadge}
        </span>
      </td>
      <td className="hidden px-4 py-3 text-right tabular-nums text-muted-foreground sm:table-cell">
        {periodo.totalLineas}
      </td>
      <td className="hidden px-4 py-3 text-right tabular-nums font-medium md:table-cell">
        {formatearCLPOGuion(periodo.montoTotalClp)}
      </td>
      <td className="px-4 py-3">
        {periodo.dte ? (
          <div className="flex items-center gap-2 flex-wrap">
            <BadgeEstadoSiiCompacto estadoSii={periodo.dte.estadoSii} />
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Sin factura</span>
        )}
      </td>
    </tr>
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
