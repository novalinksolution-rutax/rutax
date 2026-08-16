"use client";

/**
 * "Cambiar de plan" — sección interactiva de "Mi plan" (F2, item I). Permite
 * al courier cambiar de plan y/o periodicidad (mensual/anual) sobre una
 * suscripción YA existente (distinto de `SelectorDePlanes`, que da de alta la
 * PRIMERA suscripción del tenant).
 *
 * Regla de negocio (ver `cambiarPlanCourier` en `superficie-courier.ts`):
 *  - UPGRADE (precio nuevo >= actual): efecto INMEDIATO + cargo prorrateado
 *    por lo que resta del ciclo vigente.
 *  - DOWNGRADE (precio nuevo < actual): efecto DIFERIDO al fin del ciclo
 *    vigente, sin cobro ahora.
 * Un upgrade posterior cancela cualquier downgrade programado.
 *
 * El monto mostrado ANTES de confirmar es una ESTIMACIÓN calculada en el
 * cliente (mismo cálculo que `calcularAjustePlan`, pero no se puede importar
 * ese módulo aquí: carga `service_role` y no debe llegar al bundle del
 * cliente). El monto EXACTO lo calcula el servidor al aplicar el cambio y es
 * el que se muestra en el mensaje de éxito.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownCircle, ArrowUpCircle, Check, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { DialogConfirmacionDinero } from "@/components/ui/dialog-confirmacion-dinero";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import { formatearFecha } from "@/lib/formato-cl";
import { ahoraEnSantiago, diferenciaEnDiasCalendario } from "@/lib/fecha-santiago";
import { cn } from "@/lib/utils";
import { EMAIL_SOPORTE_RUTAX, MAILTO_SOPORTE_RUTAX } from "@/lib/contacto-rutax";
import { solicitarCambioDePlanAction } from "./actions";
import type { PlanPublico, CambioPlanPendiente } from "@/modules/plataforma/superficie-courier";
import type { Periodicidad } from "@/modules/plataforma/tipos";

interface Props {
  /** Catálogo de planes ACTIVOS (self-serve) — el plan actual del courier
   *  puede no estar aquí si fue desactivado después de que lo contratara. */
  planes: PlanPublico[];
  planActual: PlanPublico;
  periodicidadActual: Periodicidad;
  /** Límites del ciclo vigente — insumo de la estimación de proración. `null`
   *  si aún no se generó el primer período (courier recién en trial). */
  periodoActual: { periodoInicio: string; periodoFin: string } | null;
  cambioPendiente: CambioPlanPendiente | null;
}

interface Estimacion {
  tipo: "upgrade" | "downgrade" | "periodicidad";
  /** `null` = no se pudo estimar (sin período vigente aún, o cambio de
   *  periodicidad que no se prorratea); el servidor igual calcula el monto
   *  real al confirmar. */
  montoEstimado: number | null;
}

/**
 * Mirror EN EL CLIENTE, solo para UI, de la clasificación de `cambiarPlanCourier`
 * (`superficie-courier.ts`). Es deliberadamente una ESTIMACIÓN: el servidor es
 * la única fuente de verdad del monto que realmente se cobra.
 *
 * Un cambio de periodicidad (mensual↔anual) NUNCA se prorratea: se difiere al
 * próximo ciclo. Por eso se decide ANTES de comparar precios — así nunca se
 * restan precios de unidades de tiempo distintas (fix de dinero ALTO, Ola 2).
 */
function estimarCambio(params: {
  precioActual: number;
  precioNuevo: number;
  periodoActual: { periodoInicio: string; periodoFin: string } | null;
  cambioPeriodicidad: boolean;
}): Estimacion {
  if (params.cambioPeriodicidad) return { tipo: "periodicidad", montoEstimado: null };
  const delta = params.precioNuevo - params.precioActual;
  if (delta < 0) return { tipo: "downgrade", montoEstimado: null };
  if (delta === 0) return { tipo: "upgrade", montoEstimado: 0 };
  if (!params.periodoActual) return { tipo: "upgrade", montoEstimado: null };

  const { fecha: hoy } = ahoraEnSantiago();
  const diasDelPeriodo =
    diferenciaEnDiasCalendario(params.periodoActual.periodoInicio, params.periodoActual.periodoFin) + 1;
  if (diasDelPeriodo <= 0) return { tipo: "upgrade", montoEstimado: null };

  const diasRestantesCrudo = diferenciaEnDiasCalendario(hoy, params.periodoActual.periodoFin) + 1;
  const diasRestantes = Math.max(0, Math.min(diasRestantesCrudo, diasDelPeriodo));
  const montoEstimado = Math.max(0, Math.round((delta * diasRestantes) / diasDelPeriodo));
  return { tipo: "upgrade", montoEstimado };
}

interface ExitoCambio {
  tipo: "upgrade" | "downgrade" | "periodicidad";
  montoAjuste: number | null;
  efectivoDesde: string | null;
  planNombre: string;
  periodicidadNueva: Periodicidad;
}

export function CambiarPlan({ planes, planActual, periodicidadActual, periodoActual, cambioPendiente }: Props) {
  const router = useRouter();
  const [periodicidad, setPeriodicidad] = useState<Periodicidad>(periodicidadActual);
  const [planSeleccionado, setPlanSeleccionado] = useState<PlanPublico | null>(null);
  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<ExitoCambio | null>(null);
  const [isPending, startTransition] = useTransition();

  const planesOrdenados = useMemo(
    () => [...planes].sort((a, b) => a.precioMensualClp - b.precioMensualClp),
    [planes],
  );

  const precioActualEfectivo =
    periodicidadActual === "mensual" ? planActual.precioMensualClp : planActual.precioAnualClp;

  const nombrePlanPendiente = cambioPendiente
    ? (planesOrdenados.find((p) => p.id === cambioPendiente.planId)?.nombre ?? "el plan elegido")
    : null;

  const estimacion: Estimacion | null = planSeleccionado
    ? estimarCambio({
        precioActual: precioActualEfectivo,
        precioNuevo: periodicidad === "mensual" ? planSeleccionado.precioMensualClp : planSeleccionado.precioAnualClp,
        periodoActual,
        cambioPeriodicidad: periodicidad !== periodicidadActual,
      })
    : null;

  function abrirDialogo(plan: PlanPublico) {
    setError(null);
    setPlanSeleccionado(plan);
    setDialogoAbierto(true);
  }

  function cerrarDialogo(open: boolean) {
    if (isPending) return; // acción de dinero en curso: no se cierra a mitad de camino
    setDialogoAbierto(open);
    if (!open) setPlanSeleccionado(null);
  }

  function confirmar() {
    if (!planSeleccionado) return;
    setError(null);
    startTransition(async () => {
      const resultado = await solicitarCambioDePlanAction(planSeleccionado.id, periodicidad);
      if (!resultado.ok) {
        setError(resultado.error);
        return;
      }
      setDialogoAbierto(false);
      setExito({
        tipo: resultado.tipo,
        montoAjuste: resultado.montoAjuste,
        efectivoDesde: resultado.efectivoDesde,
        planNombre: planSeleccionado.nombre,
        periodicidadNueva: periodicidad,
      });
      setPlanSeleccionado(null);
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="cambiar-plan-titulo" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="cambiar-plan-titulo" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Cambiar de plan
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Compara con tu plan actual ({planActual.nombre}). Los cambios pueden ser inmediatos o diferidos según el tipo.
          </p>
        </div>
        {planesOrdenados.length > 0 ? (
          <Tabs value={periodicidad} onValueChange={(v) => setPeriodicidad(v as Periodicidad)}>
            <TabsList>
              <TabsTrigger value="mensual">Mensual</TabsTrigger>
              <TabsTrigger value="anual">Anual</TabsTrigger>
            </TabsList>
          </Tabs>
        ) : null}
      </div>

      {cambioPendiente ? (
        <Alert className="bg-info-subtle text-info-subtle-foreground">
          <Clock className="size-4" aria-hidden="true" />
          <AlertDescription className="text-info-subtle-foreground">
            Tienes un cambio programado: el <strong>{formatearFecha(cambioPendiente.efectivoDesde)}</strong> bajarás a{" "}
            <strong>{nombrePlanPendiente}</strong>. Hasta entonces sigues en tu plan {planActual.nombre}, sin cargo.
            Si quieres cancelarlo, elige un plan de igual o mayor valor. Para otros ajustes,{" "}
            <a href={MAILTO_SOPORTE_RUTAX} className="underline underline-offset-2">
              escríbenos
            </a>
            .
          </AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {exito ? (
        <Alert className="bg-success-subtle text-success-subtle-foreground">
          <AlertDescription className="text-success-subtle-foreground">
            {exito.tipo === "upgrade"
              ? exito.montoAjuste && exito.montoAjuste > 0
                ? `Tu plan se actualizó a ${exito.planNombre}. Cargamos ${formatearCLP(exito.montoAjuste)} prorrateado.`
                : `Tu plan se actualizó a ${exito.planNombre}. Sin cargo adicional este período.`
              : exito.tipo === "periodicidad"
                ? `Tu facturación pasará a ${exito.periodicidadNueva === "anual" ? "anual" : "mensual"}${exito.planNombre ? ` (plan ${exito.planNombre})` : ""} el ${exito.efectivoDesde ? formatearFecha(exito.efectivoDesde) : ""}. Hasta entonces sigues pagando ${exito.periodicidadNueva === "anual" ? "mensualmente" : "anualmente"}.`
                : `Tu plan bajará a ${exito.planNombre} el ${exito.efectivoDesde ? formatearFecha(exito.efectivoDesde) : ""}. Hasta entonces sigues con tu plan actual.`}
          </AlertDescription>
        </Alert>
      ) : null}

      {planesOrdenados.length === 0 ? (
        <EmptyState
          icon={ArrowUpCircle}
          titulo="No hay otros planes disponibles"
          descripcion={`No hay más planes activos en este momento. Si necesitas un plan diferente, escríbenos a ${EMAIL_SOPORTE_RUTAX}.`}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {planesOrdenados.map((plan) => (
            <TarjetaPlanCambio
              key={plan.id}
              plan={plan}
              periodicidad={periodicidad}
              esActual={plan.id === planActual.id && periodicidad === periodicidadActual}
              deshabilitado={isPending}
              onElegir={() => abrirDialogo(plan)}
            />
          ))}
        </div>
      )}

      {planSeleccionado && estimacion ? (
        <DialogConfirmacionDinero
          open={dialogoAbierto}
          onOpenChange={cerrarDialogo}
          titulo={
            estimacion.tipo === "upgrade"
              ? `Actualizar a ${planSeleccionado.nombre}`
              : estimacion.tipo === "periodicidad"
                ? `Cambiar a facturación ${periodicidad === "anual" ? "anual" : "mensual"}`
                : `Bajar a ${planSeleccionado.nombre}`
          }
          consecuencia={
            estimacion.tipo === "upgrade" ? (
              <span className="flex items-start gap-2">
                <ArrowUpCircle className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                <span>
                  Este cambio es <strong>inmediato</strong>. Te cobraremos el diferencial prorrateado por los días
                  restantes de tu ciclo actual
                  {periodoActual ? ` (hasta el ${formatearFecha(periodoActual.periodoFin)})` : ""}.{" "}
                  {estimacion.montoEstimado !== null && estimacion.montoEstimado > 0 ? (
                    <>
                      Estimado: <strong>{formatearCLP(estimacion.montoEstimado)}</strong> (el monto exacto se
                      calcula al confirmar).
                    </>
                  ) : (
                    "Sin cargo adicional este período."
                  )}
                </span>
              </span>
            ) : estimacion.tipo === "periodicidad" ? (
              <span className="flex items-start gap-2">
                <Clock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span>
                  Este cambio <strong>toma efecto en el próximo ciclo</strong>
                  {periodoActual ? ` (desde el ${formatearFecha(periodoActual.periodoFin)})` : ""}, sin cargo ahora.
                  Hasta entonces sigues pagando en {periodicidadActual === "anual" ? "forma anual" : "forma mensual"}.
                </span>
              </span>
            ) : (
              <span className="flex items-start gap-2">
                <ArrowDownCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span>
                  Este cambio <strong>toma efecto en el próximo ciclo</strong>. Sigues con tu plan {planActual.nombre}{" "}
                  hasta el {periodoActual ? formatearFecha(periodoActual.periodoFin) : "fin de tu período actual"},
                  sin cargo. Desde el día siguiente pasas a {planSeleccionado.nombre}.
                </span>
              </span>
            )
          }
          onConfirmar={confirmar}
          cargando={isPending}
          textoConfirmar={
            estimacion.tipo === "upgrade" ? "Actualizar y pagar" : "Programar cambio"
          }
        >
          {error ? <p className="text-destructive">{error}</p> : undefined}
        </DialogConfirmacionDinero>
      ) : null}
    </section>
  );
}

function TarjetaPlanCambio({
  plan,
  periodicidad,
  esActual,
  deshabilitado,
  onElegir,
}: {
  plan: PlanPublico;
  periodicidad: Periodicidad;
  esActual: boolean;
  deshabilitado: boolean;
  onElegir: () => void;
}) {
  const precio = periodicidad === "mensual" ? plan.precioMensualClp : plan.precioAnualClp;

  const conductoresMaxRaw = plan.caracteristicas["conductores_max"];
  const conductoresMax =
    typeof conductoresMaxRaw === "number" && Number.isFinite(conductoresMaxRaw) ? conductoresMaxRaw : null;
  const apiPublica = Boolean(plan.caracteristicas["api_publica"]);
  const webhooks = Boolean(plan.caracteristicas["webhooks"]);

  return (
    <Card className={cn("flex h-full flex-col", esActual && "border-primary ring-1 ring-primary/20")}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{plan.nombre}</CardTitle>
          {esActual ? <Badge variant="outline">Tu plan actual</Badge> : null}
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-3">
        <div>
          <p className="text-2xl font-semibold tabular-nums">{formatearCLP(precio)}</p>
          <p className="text-xs text-muted-foreground">{periodicidad === "mensual" ? "por mes" : "por año"}</p>
        </div>

        <ul className="flex-1 space-y-1.5 text-sm text-muted-foreground">
          <li className="flex items-start gap-2">
            <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden="true" />
            <span>
              {plan.limitePedidosMes === null
                ? "Pedidos ilimitados"
                : `Hasta ${plan.limitePedidosMes.toLocaleString("es-CL")} pedidos al mes`}
            </span>
          </li>
          {conductoresMax !== null ? (
            <li className="flex items-start gap-2">
              <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden="true" />
              <span>Hasta {conductoresMax} conductores</span>
            </li>
          ) : null}
          {apiPublica ? (
            <li className="flex items-start gap-2">
              <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden="true" />
              <span>API pública</span>
            </li>
          ) : null}
          {webhooks ? (
            <li className="flex items-start gap-2">
              <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden="true" />
              <span>Webhooks</span>
            </li>
          ) : null}
        </ul>

        <Button
          onClick={onElegir}
          disabled={esActual || deshabilitado}
          variant={esActual ? "outline" : "default"}
          className="w-full"
        >
          {esActual ? "Tu plan actual" : "Cambiar a este plan"}
        </Button>
      </CardContent>
    </Card>
  );
}
