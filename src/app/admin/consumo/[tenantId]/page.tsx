import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, DollarSign, Server, Truck } from "lucide-react";
import { tieneSesionAdmin } from "../../sesion-admin";
import {
  obtenerConsumoPorConductor,
  type ConsumoPorConductor,
} from "@/modules/plataforma/consumo-agregado";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { resolverVentanaPeriodo } from "../_lib/periodo";
import { resolverNombresUsuario, acortarId } from "../_lib/nombres";
import { formatearUsd } from "../_lib/formato";
import { SelectorPeriodo } from "../_componentes/selector-periodo";

export const metadata: Metadata = {
  title: "Consumo por courier · Rutax Admin",
};

// Telemetría en vivo; nunca cachear.
export const dynamic = "force-dynamic";

export default async function PaginaConsumoPorCourier({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ periodo?: string }>;
}) {
  if (!(await tieneSesionAdmin())) {
    redirect("/admin/login");
  }

  const { tenantId } = await params;
  const { periodo: periodoCrudo } = await searchParams;
  const ventana = resolverVentanaPeriodo(periodoCrudo);

  let nombreCourier: string | null = null;
  try {
    const { data } = await crearClienteServiceRole()
      .schema("identidad")
      .from("tenants")
      .select("nombre_fantasia")
      .eq("id", tenantId)
      .maybeSingle();
    nombreCourier = (data?.nombre_fantasia as string | undefined) ?? null;
  } catch {
    nombreCourier = null;
  }

  // Degradación grácil: la RPC `consumo_por_conductor` puede no existir
  // todavía en producción. Nunca un 500.
  let filas: ConsumoPorConductor[] | null = null;
  let errorCarga = false;
  try {
    filas = await obtenerConsumoPorConductor(tenantId, ventana);
  } catch {
    errorCarga = true;
  }

  let nombresUsuario = new Map<string, string>();
  if (filas) {
    try {
      nombresUsuario = await resolverNombresUsuario(filas.map((f) => f.usuarioId));
    } catch {
      // Cae al UUID acortado.
    }
  }

  const costoTotal = filas?.reduce((acc, f) => acc + f.totalCostoUsd, 0) ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/admin/consumo?periodo=${ventana.periodo}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Volver a Consumo
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">
          {nombreCourier ?? acortarId(tenantId)}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Consumo por conductor — {ventana.etiquetaRango}.
        </p>
      </div>

      <SelectorPeriodo periodoActual={ventana.periodo} />

      {errorCarga ? (
        <EmptyState
          icon={Server}
          titulo="El módulo se está activando"
          descripcion="Aún no hay datos de consumo disponibles. Si esto persiste más de un día, avisa a Ingeniería — puede faltar aplicar la migración de telemetría."
        />
      ) : !filas || filas.length === 0 ? (
        <EmptyState
          icon={Truck}
          titulo="Sin consumo registrado en este período"
          descripcion="Este courier no generó eventos de consumo (ruteo, geocoding, WhatsApp, etc.) en la ventana seleccionada."
          tono="buen-estado"
        />
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <div className="rounded-lg border bg-card p-4">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <DollarSign className="size-3.5" aria-hidden="true" />
                Costo total del courier
              </div>
              <div className="mt-1 text-xl font-semibold tabular-nums sm:text-2xl">
                {formatearUsd(costoTotal)}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">Suma de todos sus conductores</div>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Truck className="size-3.5" aria-hidden="true" />
                Conductores con consumo
              </div>
              <div className="mt-1 text-xl font-semibold tabular-nums sm:text-2xl">
                {filas.length.toLocaleString("es-CL")}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">En el período seleccionado</div>
            </div>
          </section>

          <section className="rounded-lg border bg-card">
            <div className="p-4">
              <h2 className="text-sm font-medium text-muted-foreground">Consumo por conductor</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Ordenado por costo descendente.
              </p>
            </div>
            <Table densidad="compact">
              <TableHeader>
                <TableRow>
                  <TableHead>Conductor</TableHead>
                  <TableHead className="text-right">Eventos</TableHead>
                  <TableHead className="text-right">Unidades</TableHead>
                  <TableHead className="text-right">Costo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filas
                  .slice()
                  .sort((a, b) => b.totalCostoUsd - a.totalCostoUsd)
                  .map((fila) => (
                    <TableRow key={fila.usuarioId ?? "sin-usuario"}>
                      <TableCell className="font-medium text-foreground">
                        {fila.usuarioId
                          ? (nombresUsuario.get(fila.usuarioId) ?? acortarId(fila.usuarioId))
                          : "Sin usuario"}
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
          </section>
        </>
      )}
    </div>
  );
}
