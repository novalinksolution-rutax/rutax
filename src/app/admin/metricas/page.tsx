import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ArrowRightLeft,
  BarChart3,
  Building2,
  CalendarRange,
  FileText,
  Landmark,
  Package,
  PackageCheck,
  ReceiptText,
  TrendingDown,
  TrendingUp,
  Truck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { tieneSesionAdmin } from "../sesion-admin";
import { obtenerMetricasNegocio, type MetricasNegocio } from "@/modules/plataforma/metricas-negocio";
import { obtenerMetricasUsoPlataforma, type MetricasUsoPlataforma } from "@/modules/plataforma/metricas-uso";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import { BADGE_ESTADO_SUSCRIPCION, TEXTO_ESTADO_SUSCRIPCION } from "@/lib/ui/traduccion-estados";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import type { EstadoSuscripcion } from "@/modules/plataforma/tipos";

export const metadata: Metadata = {
  title: "Métricas de negocio · Rutax Admin",
};

// El tablero refleja ingresos/morosidad en vivo; nunca cachear.
export const dynamic = "force-dynamic";

export default async function PaginaMetricas() {
  // Doble verificación (mismo patrón que el resto de `/admin/*`): el código
  // server que lee `plataforma` cross-tenant vía service_role NUNCA corre sin
  // sesión admin válida.
  if (!(await tieneSesionAdmin())) {
    redirect("/admin/login");
  }

  // Dos fuentes independientes (perímetros de acceso auditables por separado —
  // ver header de `metricas-uso.ts`): se piden en paralelo y cada una degrada
  // sola si falla, sin tumbar la otra sección.
  const [resultadoNegocio, resultadoUso] = await Promise.allSettled([
    obtenerMetricasNegocio(),
    obtenerMetricasUsoPlataforma(),
  ]);

  const metricas: MetricasNegocio | null =
    resultadoNegocio.status === "fulfilled" ? resultadoNegocio.value : null;
  const errorCarga = resultadoNegocio.status === "rejected";

  const metricasUso: MetricasUsoPlataforma | null =
    resultadoUso.status === "fulfilled" ? resultadoUso.value : null;
  const errorCargaUso = resultadoUso.status === "rejected";

  const totalCouriers = metricas
    ? Object.values(metricas.couriersPorEstado).reduce((acc, n) => acc + n, 0)
    : 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Métricas de negocio</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Salud financiera de Rutax como negocio: ingreso recurrente, cobros del mes, morosidad, churn y couriers
          por estado de suscripción.
        </p>
      </div>

      {errorCarga || !metricas ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          No se pudieron cargar las métricas de negocio. Intenta recargar la página.
        </div>
      ) : totalCouriers === 0 ? (
        <EmptyState
          icon={BarChart3}
          titulo="Aún no hay couriers con suscripción"
          // COPY
          descripcion="Cuando se den de alta las primeras suscripciones, el MRR, los ingresos, la morosidad y el churn van a aparecer aquí."
        />
      ) : (
        <>
          {/* KPIs principales */}
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <TarjetaKPI
              icon={TrendingUp}
              etiqueta="MRR"
              valor={formatearCLP(metricas.mrrClp)}
              ayuda="Ingreso recurrente mensual (solo suscripciones activas)"
            />
            <TarjetaKPI
              icon={CalendarRange}
              etiqueta="ARR"
              valor={formatearCLP(metricas.arrClp)}
              ayuda="MRR × 12"
            />
            <TarjetaKPI
              icon={Wallet}
              etiqueta="Ingresos del mes"
              valor={formatearCLP(metricas.ingresosMesClp)}
              ayuda="Pagos confirmados este mes (incluye ajustes de proración)"
            />
            <TarjetaKPI
              icon={AlertTriangle}
              etiqueta="Morosidad total"
              valor={formatearCLP(metricas.morosidadTotalClp)}
              ayuda="Períodos vencidos sin pagar, a la fecha"
              alerta={metricas.morosidadTotalClp > 0}
            />
          </section>

          {/* Churn + couriers por estado */}
          <section className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-lg border bg-card p-4 lg:col-span-1">
              <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <TrendingDown className="size-4" aria-hidden="true" />
                Churn del mes
              </h2>
              <p className="mt-2 text-3xl font-bold tabular-nums">
                {(metricas.churnMes.tasa * 100).toLocaleString("es-CL", { maximumFractionDigits: 1 })}%
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {/* COPY */}
                {metricas.churnMes.canceladas} cancelación{metricas.churnMes.canceladas === 1 ? "" : "es"} este mes
                de ~{metricas.churnMes.activasAlInicioAprox} suscripciones activas al inicio (aproximado).
              </p>
            </div>

            <div className="rounded-lg border bg-card p-4 lg:col-span-2">
              <h2 className="text-sm font-medium text-muted-foreground">Couriers por estado</h2>
              <div className="mt-3">
                <BarrasCouriersPorEstado datos={metricas.couriersPorEstado} total={totalCouriers} />
              </div>
            </div>
          </section>
        </>
      )}

      <SeccionUsoPlataforma metricasUso={metricasUso} errorCarga={errorCargaUso} />
    </div>
  );
}

/**
 * Uso agregado de la plataforma (todos los couriers): GMV que el motor
 * entrega→dinero ya procesó, pedidos, DTEs emitidos y alcance (conductores,
 * couriers, sellers). Independiente de la sección de negocio de arriba —
 * distinta fuente, distinto perímetro de acceso (ver `metricas-uso.ts`).
 */
function SeccionUsoPlataforma({
  metricasUso,
  errorCarga,
}: {
  metricasUso: MetricasUsoPlataforma | null;
  errorCarga: boolean;
}) {
  const tasaEntregaMes =
    metricasUso && metricasUso.pedidos.mes > 0
      ? Math.round((metricasUso.pedidos.entregadosMes / metricasUso.pedidos.mes) * 100)
      : null;

  return (
    <section className="space-y-4 border-t pt-8">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Activity className="size-5 text-muted-foreground" aria-hidden="true" />
          Uso de la plataforma
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {/* COPY */}
          Volumen agregado de todos los couriers en Rutax: cuánto se está moviendo en la operación, no cuánto le
          pagan a Rutax (eso es el negocio de arriba).
        </p>
      </div>

      {errorCarga || !metricasUso ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          No se pudieron cargar las métricas de uso de la plataforma. Intenta recargar la página.
        </div>
      ) : (
        <div className="space-y-6">
          <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            {/* COPY */}
            <strong className="font-medium text-foreground">GMV</strong> = valor que el motor entrega→dinero ya
            procesó al cerrar períodos de cobro, sumado entre todos los couriers. Es el negocio{" "}
            <em>de los couriers</em>, no el ingreso de Rutax — el ingreso de Rutax es el MRR de la sección de
            arriba.
          </div>

          <div>
            <h3 className="text-sm font-medium text-muted-foreground">GMV procesado (motor entrega→dinero)</h3>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <TarjetaKPI
                icon={ArrowRightLeft}
                etiqueta="GMV del mes"
                valor={formatearCLP(metricasUso.gmv.mesActualClp)}
                ayuda="Períodos de cobro cerrados este mes, todos los couriers"
              />
              <TarjetaKPI
                icon={Landmark}
                etiqueta="GMV histórico"
                valor={formatearCLP(metricasUso.gmv.totalClp)}
                ayuda="Acumulado desde el inicio"
              />
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium text-muted-foreground">Pedidos</h3>
            <div className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-3">
              <TarjetaKPI
                icon={Package}
                etiqueta="Pedidos del mes"
                valor={metricasUso.pedidos.mes.toLocaleString("es-CL")}
                ayuda="Creados este mes, todos los couriers"
              />
              <TarjetaKPI
                icon={PackageCheck}
                etiqueta="Entregados del mes"
                valor={metricasUso.pedidos.entregadosMes.toLocaleString("es-CL")}
                ayuda={
                  tasaEntregaMes === null
                    ? "Sin pedidos este mes"
                    : `${tasaEntregaMes}% de los pedidos del mes`
                }
              />
              <TarjetaKPI
                icon={Package}
                etiqueta="Pedidos históricos"
                valor={metricasUso.pedidos.total.toLocaleString("es-CL")}
                ayuda="Todos los estados, desde el inicio"
              />
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium text-muted-foreground">DTEs emitidos</h3>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <TarjetaKPI
                icon={FileText}
                etiqueta="DTEs del mes"
                valor={metricasUso.dtesEmitidos.mes.toLocaleString("es-CL")}
                ayuda="Facturas electrónicas emitidas este mes"
              />
              <TarjetaKPI
                icon={ReceiptText}
                etiqueta="DTEs históricos"
                valor={metricasUso.dtesEmitidos.total.toLocaleString("es-CL")}
                ayuda="Acumulado desde el inicio"
              />
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium text-muted-foreground">Alcance de la plataforma</h3>
            <div className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-3">
              <TarjetaKPI
                icon={Truck}
                etiqueta="Conductores activos"
                valor={metricasUso.conductoresActivos.toLocaleString("es-CL")}
                ayuda="Estado 'activo', todos los couriers"
              />
              <TarjetaKPI
                icon={Building2}
                etiqueta="Couriers activos"
                valor={metricasUso.couriersActivos.toLocaleString("es-CL")}
                ayuda="Con suscripción activa a Rutax"
              />
              <TarjetaKPI
                icon={Users}
                etiqueta="Sellers"
                valor={metricasUso.sellersTotal.toLocaleString("es-CL")}
                ayuda="Total registrados, todos los couriers"
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function TarjetaKPI({
  icon: Icon,
  etiqueta,
  valor,
  ayuda,
  alerta = false,
}: {
  icon: LucideIcon;
  etiqueta: string;
  valor: string;
  ayuda: string;
  alerta?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        alerta ? "border-destructive/40 bg-destructive/5" : "bg-card",
      )}
    >
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" aria-hidden="true" />
        {etiqueta}
      </div>
      <div
        className={cn(
          "mt-1 text-xl font-semibold tabular-nums sm:text-2xl",
          alerta && "text-destructive",
        )}
      >
        {valor}
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">{ayuda}</div>
    </div>
  );
}

const ORDEN_ESTADOS: EstadoSuscripcion[] = ["trial", "activa", "suspendida", "cancelada"];

/** Mismos colores semánticos que `BADGE_ESTADO_SUSCRIPCION` (ver `traduccion-estados.ts`):
 *  trial=info, activa=éxito, suspendida=advertencia, cancelada=neutral. */
const COLOR_BARRA_ESTADO: Record<EstadoSuscripcion, string> = {
  trial: "bg-info",
  activa: "bg-success",
  suspendida: "bg-warning",
  cancelada: "bg-muted-foreground/50",
};

function BarrasCouriersPorEstado({
  datos,
  total,
}: {
  datos: Record<EstadoSuscripcion, number>;
  total: number;
}) {
  return (
    <div className="space-y-3" role="img" aria-label="Distribución de couriers por estado de suscripción">
      {ORDEN_ESTADOS.map((estado) => {
        const valor = datos[estado] ?? 0;
        const pct = total > 0 ? Math.round((valor / total) * 100) : 0;
        return (
          <div key={estado} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <Badge variant={BADGE_ESTADO_SUSCRIPCION[estado]}>{TEXTO_ESTADO_SUSCRIPCION[estado]}</Badge>
              <span className="tabular-nums text-muted-foreground">
                {valor.toLocaleString("es-CL")} · {pct}%
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full transition-all", COLOR_BARRA_ESTADO[estado])}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
