import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DollarSign, Package, Percent, Server } from "lucide-react";
import { tieneSesionAdmin } from "../sesion-admin";
import {
  obtenerKpisCostosConsumo,
  type KpisCostosConsumo,
} from "@/modules/plataforma/consumo-agregado";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { resolverVentanaPeriodo, type Periodo } from "./_lib/periodo";
import { resolverNombresCourier, acortarId } from "./_lib/nombres";
import { formatearUsd, formatearUsdPreciso } from "./_lib/formato";
import { TabsConsumo } from "./_componentes/tabs-consumo";
import { SelectorPeriodo } from "./_componentes/selector-periodo";

export const metadata: Metadata = {
  title: "Consumo · Costos · Rutax Admin",
};

// Telemetría de costo en vivo (crudo de `infra.eventos_consumo`); nunca cachear.
export const dynamic = "force-dynamic";

export default async function PaginaConsumoCostos({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  // Doble verificación (mismo patrón que el resto de `/admin/*`): el código
  // server que lee `plataforma`/`infra` cross-tenant vía service_role NUNCA
  // corre sin sesión admin válida.
  if (!(await tieneSesionAdmin())) {
    redirect("/admin/login");
  }

  const { periodo: periodoCrudo } = await searchParams;
  const ventana = resolverVentanaPeriodo(periodoCrudo);

  // Las RPCs `consumo_*` pueden no existir todavía en producción (el código se
  // despliega antes que la migración) — degradación grácil obligatoria: nunca
  // un 500, siempre un estado vacío explicando qué pasa.
  let kpis: KpisCostosConsumo | null = null;
  let errorCarga = false;
  try {
    kpis = await obtenerKpisCostosConsumo(ventana);
  } catch {
    errorCarga = true;
  }

  let nombresCourier = new Map<string, string>();
  if (kpis) {
    try {
      nombresCourier = await resolverNombresCourier(kpis.topCouriers.map((c) => c.tenantId));
    } catch {
      // Si falla la resolución de nombres, se cae al UUID acortado — no se
      // tumba la pantalla por un problema cosmético.
    }
  }

  return (
    <div className="space-y-6">
      <Cabecera periodo={ventana.periodo} etiquetaRango={ventana.etiquetaRango} />

      {errorCarga ? (
        <EmptyState
          icon={Server}
          titulo="El módulo se está activando"
          descripcion="Aún no hay datos de consumo disponibles. Si esto persiste más de un día, avisa a Ingeniería — puede faltar aplicar la migración de telemetría."
        />
      ) : !kpis || (kpis.costoTotalUsd === 0 && kpis.entregasEfectivas === 0) ? (
        <EmptyState
          icon={DollarSign}
          titulo="Aún no hay datos de consumo en este período"
          descripcion="En cuanto se registren llamadas a proveedores externos (ruteo, geocoding, WhatsApp, etc.) o entregas cerradas, aparecerán aquí."
        />
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <TarjetaKPI
              icon={DollarSign}
              etiqueta="Costo total del período"
              valor={formatearUsd(kpis.costoTotalUsd)}
              ayuda="Suma de todos los proveedores, todos los couriers"
            />
            <TarjetaKPI
              icon={Package}
              etiqueta="Entregas efectivas"
              valor={kpis.entregasEfectivas.toLocaleString("es-CL")}
              ayuda="Eventos entrega.cerrar en el período"
            />
            <TarjetaKPI
              icon={DollarSign}
              etiqueta="Costo por entrega"
              valor={kpis.costoPorEntregaUsd !== null ? formatearUsdPreciso(kpis.costoPorEntregaUsd) : "—"}
              ayuda={kpis.costoPorEntregaUsd !== null ? "Costo total / entregas efectivas" : "Sin entregas en el período"}
            />
            <TarjetaKPI
              icon={Percent}
              etiqueta="Proveedores con free tier"
              valor={`${kpis.desglosePorProveedor.filter((p) => p.freeTierMensual !== null).length} de ${kpis.desglosePorProveedor.length}`}
              ayuda="Con tarifario y cuota gratuita vigente"
            />
          </section>

          <section className="rounded-lg border bg-card p-4">
            <h2 className="text-sm font-medium text-muted-foreground">Costo por proveedor</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Barra a escala del proveedor de mayor costo en el período. El % de free tier es sobre
              la cuota mensual vigente, no sobre el período mostrado si este no coincide con un mes.
            </p>
            <div className="mt-4">
              <BarrasProveedor filas={kpis.desglosePorProveedor} />
            </div>
          </section>

          <section className="rounded-lg border bg-card">
            <div className="p-4">
              <h2 className="text-sm font-medium text-muted-foreground">Top couriers por costo</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Los que más consumo generaron en el período. Haz clic para ver su detalle por conductor.
              </p>
            </div>
            {kpis.topCouriers.length === 0 ? (
              <div className="px-4 pb-4">
                <EmptyState
                  icon={Package}
                  titulo="Ningún courier con consumo en este período"
                  tono="buen-estado"
                />
              </div>
            ) : (
              <Table densidad="compact">
                <TableHeader>
                  <TableRow>
                    <TableHead>Courier</TableHead>
                    <TableHead className="text-right">Eventos</TableHead>
                    <TableHead className="text-right">Unidades</TableHead>
                    <TableHead className="text-right">Costo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {kpis.topCouriers.map((fila) => (
                    <TableRow key={fila.tenantId ?? "sin-tenant"}>
                      <TableCell>
                        {fila.tenantId ? (
                          <Link
                            href={`/admin/consumo/${fila.tenantId}?periodo=${ventana.periodo}`}
                            className="font-medium text-foreground underline-offset-2 hover:underline"
                          >
                            {nombresCourier.get(fila.tenantId) ?? acortarId(fila.tenantId)}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">Sin tenant</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fila.eventos.toLocaleString("es-CL")}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fila.totalUnidades.toLocaleString("es-CL")}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatearUsd(fila.totalCostoUsd)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Cabecera({ periodo, etiquetaRango }: { periodo: Periodo; etiquetaRango: string }) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Consumo</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Costo de plataforma en APIs de terceros (ruteo, geocoding, WhatsApp, correo) y su
          relación con la operación real — {etiquetaRango}.
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <TabsConsumo />
        <SelectorPeriodo periodoActual={periodo} />
      </div>
    </div>
  );
}

function TarjetaKPI({
  icon: Icon,
  etiqueta,
  valor,
  ayuda,
}: {
  icon: typeof DollarSign;
  etiqueta: string;
  valor: string;
  ayuda: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" aria-hidden="true" />
        {etiqueta}
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums sm:text-2xl">{valor}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{ayuda}</div>
    </div>
  );
}

/**
 * Barras horizontales de costo por proveedor, a escala del mayor del período.
 * Sin librería de charts, mismo patrón que `metricas/page.tsx`. El % de free
 * tier se pinta como marcador aparte, en ámbar si ya se pasó del 100%.
 */
function BarrasProveedor({
  filas,
}: {
  filas: KpisCostosConsumo["desglosePorProveedor"];
}) {
  if (filas.length === 0) {
    return <p className="text-sm text-muted-foreground">Sin proveedores con costo en el período.</p>;
  }

  const maximo = Math.max(...filas.map((f) => f.totalCostoUsd), 0.0001);

  return (
    <div className="space-y-3">
      {filas
        .slice()
        .sort((a, b) => b.totalCostoUsd - a.totalCostoUsd)
        .map((fila) => {
          const pct = Math.round((fila.totalCostoUsd / maximo) * 100);
          const nombre = fila.proveedorCosto ?? "Sin proveedor (motor local)";
          const sobreFreeTier = fila.porcentajeFreeTier !== null && fila.porcentajeFreeTier >= 100;
          return (
            <div key={`${fila.proveedorCosto}|${fila.sku}`} className="space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-sm">
                <span className="font-medium text-foreground">
                  {nombre}
                  {fila.sku ? <span className="text-muted-foreground"> · {fila.sku}</span> : null}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {formatearUsd(fila.totalCostoUsd)} · {fila.totalUnidades.toLocaleString("es-CL")} unid.
                  {fila.porcentajeFreeTier !== null ? (
                    <span className={cn("ml-1", sobreFreeTier && "font-medium text-warning")}>
                      · {fila.porcentajeFreeTier.toLocaleString("es-CL")}% free tier
                    </span>
                  ) : null}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full transition-all", sobreFreeTier ? "bg-warning" : "bg-info")}
                  style={{ width: `${Math.max(pct, fila.totalCostoUsd > 0 ? 2 : 0)}%` }}
                />
              </div>
            </div>
          );
        })}
    </div>
  );
}
