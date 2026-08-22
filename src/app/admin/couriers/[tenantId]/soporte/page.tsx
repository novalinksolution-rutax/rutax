import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Eye, PackageSearch, Wallet } from "lucide-react";
import { tieneSesionAdmin } from "../../../sesion-admin";
import {
  obtenerVistaSoporteTenant,
  type VistaSoporteTenant,
  type PedidoOperativoSoporte,
  type ResumenPeriodoCobroSoporte,
  type ResumenLiquidacionSoporte,
} from "@/modules/plataforma/vista-soporte";
import { NoHaySesionSoporte } from "@/modules/plataforma/soporte";
import { etiquetaFuentePedido } from "@/lib/ui/etiqueta-fuente-pedido";
import type { EstadoPeriodo, EstadoLiquidacion } from "@/modules/dinero/tipos";
import { Badge } from "@/components/ui/badge";
import { BadgeEstado } from "@/components/ui/badge-estado";
import { EmptyState } from "@/components/ui/empty-state";
import { formatearFecha } from "@/lib/formato-cl";
import { formatearCLPOGuion } from "@/lib/ui/formato-moneda";
import {
  BADGE_ESTADO_PEDIDO,
  BADGE_ESTADO_PERIODO,
  BADGE_ESTADO_LIQUIDACION,
  traducirEstadoPedido,
  traducirEstadoPeriodoCobro,
  traducirEstadoLiquidacion,
} from "@/lib/ui/traduccion-estados";
import { ContenidoDrillDown } from "../page";

export const metadata: Metadata = {
  title: "Modo soporte · Rutax Admin",
};

// Es una PROYECCIÓN en vivo de un tenant ajeno bajo una ventana de tiempo —
// nunca se cachea (además, gateada por `exigirSoporteActivo`, que revisa la
// cookie en cada request).
export const dynamic = "force-dynamic";

/** Orden canónico de despliegue — independiente del orden en que llegan los agregados. */
const ORDEN_ESTADO_PERIODO: EstadoPeriodo[] = ["abierto", "cerrado", "facturado", "anulado"];
const ORDEN_ESTADO_LIQUIDACION: EstadoLiquidacion[] = ["borrador", "emitida", "pagada"];

export default async function PaginaSoporteCourier({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  // Doble verificación (mismo patrón que el resto de `/admin/*`).
  if (!(await tieneSesionAdmin())) {
    redirect("/admin/login");
  }

  const { tenantId } = await params;

  let vista: VistaSoporteTenant | null = null;
  let errorCarga = false;

  try {
    vista = await obtenerVistaSoporteTenant(tenantId);
  } catch (err) {
    if (err instanceof NoHaySesionSoporte) {
      // No hay ventana de soporte vigente para este tenant (nunca se abrió,
      // expiró, o es de otro tenant/admin) — vuelve al drill-down normal, que
      // es donde se abre una nueva.
      redirect(`/admin/couriers/${tenantId}`);
    }
    errorCarga = true;
  }

  if (errorCarga || !vista) {
    return (
      <div className="space-y-4">
        <Link
          href={`/admin/couriers/${tenantId}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Volver al detalle del courier
        </Link>
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          No se pudo cargar la vista de soporte de este courier. Intenta recargar la página.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* El banner de sesión suplantada ya NO se pinta acá: lo pone el marco
          (`admin/layout.tsx`) para todas las pantallas del backstage mientras la
          ventana esté abierta. Mientras vivía en esta página desaparecía en la
          rama de error de abajo, que es justo cuando más falta hace. */}
      <div className="space-y-1">
        <Link
          href={`/admin/couriers/${tenantId}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Volver al detalle del courier
        </Link>
        <div className="flex items-start gap-2 rounded-lg border border-info-subtle bg-info-subtle/60 px-4 py-3 text-sm text-info-subtle-foreground">
          <Eye className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            Esta es una <strong>proyección de solo lectura de Rutax</strong>, no la cuenta real del
            courier: no hay ningún control de acción aquí, y nada de lo que veas puede modificar sus
            datos.
          </p>
        </div>
      </div>

      <ContenidoDrillDown datos={vista.observabilidad} />

      <SeccionUltimosPedidos pedidos={vista.ultimosPedidos} />

      <SeccionResumenDinero resumen={vista.resumenDinero} />
    </div>
  );
}

// =============================================================================
// Últimos pedidos — solo campos operativos (ver minimización PII en
// `vista-soporte.ts`: sin destinatario, sin conductor).
// =============================================================================

function SeccionUltimosPedidos({ pedidos }: { pedidos: PedidoOperativoSoporte[] }) {
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <PackageSearch className="size-4" aria-hidden="true" />
        Últimos pedidos
        <Badge variant="neutral" className="font-normal">
          Solo lectura
        </Badge>
      </h2>

      {pedidos.length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          tono="arranque"
          titulo="Sin pedidos registrados"
          descripcion="Este courier todavía no tiene pedidos en su operación."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Últimos pedidos del courier">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="px-4 py-2">
                    Pedido
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Estado
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Fuente
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Fecha
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pedidos.map((p) => (
                  <tr key={p.id} className="transition-colors hover:bg-muted/30">
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {p.codigoInterno ?? `${p.id.slice(0, 12)}…`}
                    </td>
                    <td className="px-4 py-3">
                      <BadgeEstado variante={BADGE_ESTADO_PEDIDO[p.estado]} eje="pedido" valor={p.estado} texto={traducirEstadoPedido(p.estado)} />
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="neutral">{etiquetaFuentePedido(p.fuente)}</Badge>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                      {formatearFecha(p.fecha)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

// =============================================================================
// Resumen de dinero — agregado por estado (nunca fila por pedido/conductor).
// =============================================================================

function SeccionResumenDinero({
  resumen,
}: {
  resumen: { periodosCobro: ResumenPeriodoCobroSoporte[]; liquidaciones: ResumenLiquidacionSoporte[] };
}) {
  const periodosPorEstado = new Map(resumen.periodosCobro.map((p) => [p.estado, p]));
  const liquidacionesPorEstado = new Map(resumen.liquidaciones.map((l) => [l.estado, l]));

  const hayPeriodos = resumen.periodosCobro.some((p) => p.cantidad > 0);
  const hayLiquidaciones = resumen.liquidaciones.some((l) => l.cantidad > 0);

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Wallet className="size-4" aria-hidden="true" />
        Resumen de dinero
        <Badge variant="neutral" className="font-normal">
          Solo lectura
        </Badge>
      </h2>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Períodos de cobro */}
        <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
          <div className="border-b bg-muted/40 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Períodos de cobro
          </div>
          {!hayPeriodos ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              Sin períodos de cobro todavía.
            </p>
          ) : (
            <table className="w-full text-sm" aria-label="Resumen de períodos de cobro por estado">
              <thead className="sr-only">
                <tr>
                  <th scope="col">Estado</th>
                  <th scope="col">Cantidad</th>
                  <th scope="col">Monto total</th>
                  <th scope="col">Monto pagado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {ORDEN_ESTADO_PERIODO.map((estado) => {
                  const fila = periodosPorEstado.get(estado);
                  if (!fila || fila.cantidad === 0) return null;
                  return (
                    <tr key={estado}>
                      <td className="px-4 py-2.5">
                        <BadgeEstado variante={BADGE_ESTADO_PERIODO[estado]} eje="periodo" valor={estado} texto={traducirEstadoPeriodoCobro(estado)} />
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                        {fila.cantidad} período{fila.cantidad !== 1 ? "s" : ""}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                        {formatearCLPOGuion(fila.montoTotalClp)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                        Pagado: {formatearCLPOGuion(fila.montoPagadoClp)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Liquidaciones */}
        <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
          <div className="border-b bg-muted/40 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Liquidaciones
          </div>
          {!hayLiquidaciones ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              Sin liquidaciones todavía.
            </p>
          ) : (
            <table className="w-full text-sm" aria-label="Resumen de liquidaciones por estado">
              <thead className="sr-only">
                <tr>
                  <th scope="col">Estado</th>
                  <th scope="col">Cantidad</th>
                  <th scope="col">Monto total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {ORDEN_ESTADO_LIQUIDACION.map((estado) => {
                  const fila = liquidacionesPorEstado.get(estado);
                  if (!fila || fila.cantidad === 0) return null;
                  return (
                    <tr key={estado}>
                      <td className="px-4 py-2.5">
                        <BadgeEstado variante={BADGE_ESTADO_LIQUIDACION[estado]} eje="liquidacion" valor={estado} texto={traducirEstadoLiquidacion(estado)} />
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                        {fila.cantidad} liquidación{fila.cantidad !== 1 ? "es" : ""}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                        {formatearCLPOGuion(fila.montoTotalClp)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}
