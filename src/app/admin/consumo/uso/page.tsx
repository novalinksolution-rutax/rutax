import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Activity, GitCompareArrows, RefreshCw, Server } from "lucide-react";
import { tieneSesionAdmin } from "../../sesion-admin";
import { obtenerKpisUsoConsumo, type KpisUsoConsumo } from "@/modules/plataforma/consumo-agregado";
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
import { resolverVentanaPeriodo, type Periodo } from "../_lib/periodo";
import { resolverNombresUsuario, acortarId } from "../_lib/nombres";
import { TabsConsumo } from "../_componentes/tabs-consumo";
import { SelectorPeriodo } from "../_componentes/selector-periodo";

export const metadata: Metadata = {
  title: "Consumo · Uso · Rutax Admin",
};

// Telemetría de comportamiento en vivo; nunca cachear.
export const dynamic = "force-dynamic";

export default async function PaginaConsumoUso({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  if (!(await tieneSesionAdmin())) {
    redirect("/admin/login");
  }

  const { periodo: periodoCrudo } = await searchParams;
  const ventana = resolverVentanaPeriodo(periodoCrudo);

  // Degradación grácil: las RPCs `consumo_*` pueden no existir todavía en
  // producción (código desplegado antes que la migración). Nunca un 500.
  let kpis: KpisUsoConsumo | null = null;
  let errorCarga = false;
  try {
    kpis = await obtenerKpisUsoConsumo(ventana);
  } catch {
    errorCarga = true;
  }

  let nombresUsuario = new Map<string, string>();
  if (kpis) {
    try {
      nombresUsuario = await resolverNombresUsuario(
        kpis.reoptimizacionesPorConductor.map((f) => f.usuarioId),
      );
    } catch {
      // Cae al UUID acortado si falla — no tumba la pantalla.
    }
  }

  const totalCalculosRuteo =
    (kpis?.ratioLocalVsProveedor.local ?? 0) + (kpis?.ratioLocalVsProveedor.proveedor ?? 0);
  const sinDatos =
    !!kpis &&
    kpis.reoptimizacionesPorConductor.length === 0 &&
    kpis.reordenamientosTotal === 0 &&
    totalCalculosRuteo === 0;

  return (
    <div className="space-y-6">
      <Cabecera periodo={ventana.periodo} etiquetaRango={ventana.etiquetaRango} />

      {errorCarga ? (
        <EmptyState
          icon={Server}
          titulo="El módulo se está activando"
          descripcion="Aún no hay datos de uso disponibles. Si esto persiste más de un día, avisa a Ingeniería — puede faltar aplicar la migración de telemetría."
        />
      ) : !kpis || sinDatos ? (
        <EmptyState
          icon={Activity}
          titulo="Aún no hay actividad registrada en este período"
          descripcion="En cuanto los conductores optimicen o reordenen rutas, aparecerá el detalle de comportamiento aquí."
        />
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <TarjetaKPI
              icon={RefreshCw}
              etiqueta="Reoptimizaciones"
              valor={kpis.reoptimizacionesPorConductor
                .reduce((acc, f) => acc + f.total, 0)
                .toLocaleString("es-CL")}
              ayuda="Optimizar ruta + ir a esta ahora, todos los conductores"
            />
            <TarjetaKPI
              icon={GitCompareArrows}
              etiqueta="Reordenamientos manuales"
              valor={kpis.reordenamientosTotal.toLocaleString("es-CL")}
              ayuda="Arrastres de parada, sin llamar a ningún proveedor"
            />
            <TarjetaKPI
              icon={Activity}
              etiqueta="% de cálculos por motor local"
              valor={
                kpis.ratioLocalVsProveedor.porcentajeLocal !== null
                  ? `${kpis.ratioLocalVsProveedor.porcentajeLocal.toLocaleString("es-CL")}%`
                  : "—"
              }
              ayuda={
                totalCalculosRuteo > 0
                  ? `${kpis.ratioLocalVsProveedor.local.toLocaleString("es-CL")} local / ${kpis.ratioLocalVsProveedor.proveedor.toLocaleString("es-CL")} proveedor`
                  : "Sin cálculos de ruteo en el período"
              }
            />
          </section>

          <section className="rounded-lg border bg-card">
            <div className="p-4">
              <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <RefreshCw className="size-4" aria-hidden="true" />
                El que refresca de más
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Reoptimizaciones por conductor en el período, de mayor a menor. Cada una cuesta
                nº-paradas al proveedor de ruteo.
              </p>
            </div>
            {kpis.reoptimizacionesPorConductor.length === 0 ? (
              <div className="px-4 pb-4">
                <EmptyState
                  icon={RefreshCw}
                  titulo="Sin reoptimizaciones en este período"
                  tono="buen-estado"
                />
              </div>
            ) : (
              <Table densidad="compact">
                <TableHeader>
                  <TableRow>
                    <TableHead>Conductor</TableHead>
                    <TableHead className="text-right">Reoptimizaciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {kpis.reoptimizacionesPorConductor.map((fila) => (
                    <TableRow key={fila.usuarioId ?? "sin-usuario"}>
                      <TableCell className="font-medium text-foreground">
                        {fila.usuarioId
                          ? (nombresUsuario.get(fila.usuarioId) ?? acortarId(fila.usuarioId))
                          : "Sin usuario"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fila.total.toLocaleString("es-CL")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>

          <section className="rounded-lg border bg-card p-4">
            <h2 className="text-sm font-medium text-muted-foreground">Motor local vs. proveedor de pago</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              De los cálculos de optimización de ruta, cuántos resolvió el motor local (haversine,
              gratis) contra cuántos fueron al proveedor de pago (Google Route Optimization).
            </p>
            <div className="mt-4">
              <BarraRatio ratio={kpis.ratioLocalVsProveedor} />
            </div>
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
          Comportamiento: cuánto refrescan los conductores, cuánto reordenan a mano y qué tanto
          del ruteo cae al motor local vs. al proveedor de pago — {etiquetaRango}.
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
  icon: typeof Activity;
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

function BarraRatio({
  ratio,
}: {
  ratio: KpisUsoConsumo["ratioLocalVsProveedor"];
}) {
  const total = ratio.local + ratio.proveedor;
  if (total === 0) {
    return <p className="text-sm text-muted-foreground">Sin cálculos de ruteo en el período.</p>;
  }
  const pctLocal = Math.round((ratio.local / total) * 100);
  const pctProveedor = 100 - pctLocal;

  return (
    <div className="space-y-2">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-success" style={{ width: `${pctLocal}%` }} />
        <div className={cn("h-full bg-info", pctLocal === 100 && "hidden")} style={{ width: `${pctProveedor}%` }} />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>
          <span className="inline-block size-2 rounded-full bg-success" /> Local: {ratio.local.toLocaleString("es-CL")} ({pctLocal}%)
        </span>
        <span>
          Proveedor: {ratio.proveedor.toLocaleString("es-CL")} ({pctProveedor}%) <span className="inline-block size-2 rounded-full bg-info" />
        </span>
      </div>
    </div>
  );
}
