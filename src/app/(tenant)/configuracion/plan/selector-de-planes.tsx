"use client";

/**
 * Selector de planes (self-serve) — se renderiza cuando el tenant aún no
 * tiene suscripción (`obtenerMiPlan` devolvió `null`). Al elegir un plan,
 * `crearSuscripcionInicialAction` da de alta la suscripción en `trial` y esta
 * misma ruta se re-renderiza como "Mi plan" (ver `page.tsx`).
 *
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import { cn } from "@/lib/utils";
import { crearSuscripcionInicialAction } from "./actions";
import type { PlanPublico } from "@/modules/plataforma/superficie-courier";

type Periodicidad = "mensual" | "anual";

interface Props {
  planes: PlanPublico[];
}

export function SelectorDePlanes({ planes }: Props) {
  const router = useRouter();
  const [periodicidad, setPeriodicidad] = useState<Periodicidad>("mensual");
  const [planEnviando, setPlanEnviando] = useState<string | null>(null);
  const [exito, setExito] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const planesOrdenados = [...planes].sort((a, b) => a.precioMensualClp - b.precioMensualClp);

  // TODO(heurística "Recomendado"): con exactamente 3 planes activos, el
  // intermedio por precio mensual se marca como recomendado. Esta heurística
  // se ROMPE si el catálogo cambia de tamaño (2 planes, 4+ planes) — falta un
  // flag explícito `destacado` en `plataforma.planes` para no depender de la
  // posición. Mientras el catálogo tenga exactamente 3 planes (seed actual:
  // Starter/Growth/Enterprise), esto es correcto.
  const idRecomendado = planesOrdenados.length === 3 ? planesOrdenados[1].id : null;

  // El ahorro anual (%) es prácticamente el mismo en los 3 planes del seed
  // (~17%, "2 meses gratis") — se muestra el del plan recomendado (o el
  // primero si no hay uno) como representativo del catálogo en el toggle.
  const planReferencia =
    planesOrdenados.find((p) => p.id === idRecomendado) ?? planesOrdenados[0] ?? null;
  const ahorroPct = planReferencia
    ? Math.round(
        ((planReferencia.precioMensualClp * 12 - planReferencia.precioAnualClp) /
          (planReferencia.precioMensualClp * 12)) *
          100,
      )
    : 0;

  function elegirPlan(planId: string) {
    setError(null);
    setPlanEnviando(planId);
    startTransition(async () => {
      const resultado = await crearSuscripcionInicialAction(planId);
      if (!resultado.ok) {
        setError(resultado.error);
        setPlanEnviando(null);
        return;
      }
      setExito(true);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-bold">Elige el plan de Rutax para tu courier</h1>
        <p className="text-sm text-muted-foreground">Prueba sin costo — 14 días, sin tarjeta de crédito.</p>
      </div>

      {planesOrdenados.length === 0 ? (
        <Alert variant="destructive" className="mx-auto max-w-lg">
          <AlertDescription>
            No hay planes disponibles en este momento. Contáctanos para activar tu cuenta.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <div className="flex justify-center">
            <Tabs value={periodicidad} onValueChange={(v) => setPeriodicidad(v as Periodicidad)}>
              <TabsList>
                <TabsTrigger value="mensual">Mensual</TabsTrigger>
                <TabsTrigger value="anual">
                  Anual
                  {ahorroPct > 0 && (
                    <Badge variant="success" className="ml-1">
                      Ahorra {ahorroPct}%
                    </Badge>
                  )}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {error && (
            <Alert variant="destructive" className="mx-auto max-w-lg" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {exito && (
            <Alert className="mx-auto max-w-lg bg-success-subtle text-success-subtle-foreground">
              {/* COPY */}
              <AlertDescription className="text-success-subtle-foreground">
                Tu prueba está lista. Actualizando tu cuenta…
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:items-stretch">
            {planesOrdenados.map((plan) => (
              <TarjetaPlan
                key={plan.id}
                plan={plan}
                periodicidad={periodicidad}
                recomendado={plan.id === idRecomendado}
                enviando={planEnviando === plan.id}
                deshabilitado={isPending}
                onElegir={() => elegirPlan(plan.id)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function TarjetaPlan({
  plan,
  periodicidad,
  recomendado,
  enviando,
  deshabilitado,
  onElegir,
}: {
  plan: PlanPublico;
  periodicidad: Periodicidad;
  recomendado: boolean;
  enviando: boolean;
  deshabilitado: boolean;
  onElegir: () => void;
}) {
  const precio = periodicidad === "mensual" ? plan.precioMensualClp : plan.precioAnualClp;
  const ahorroAnual = plan.precioMensualClp * 12 - plan.precioAnualClp;

  const conductoresMaxRaw = plan.caracteristicas["conductores_max"];
  const conductoresMax =
    typeof conductoresMaxRaw === "number" && Number.isFinite(conductoresMaxRaw) ? conductoresMaxRaw : null;
  const apiPublica = Boolean(plan.caracteristicas["api_publica"]);
  const webhooks = Boolean(plan.caracteristicas["webhooks"]);

  return (
    <Card
      className={cn(
        "flex h-full flex-col",
        recomendado && "border-primary shadow-md ring-1 ring-primary/20",
      )}
    >
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>{plan.nombre}</CardTitle>
          {recomendado && <Badge>Recomendado</Badge>}
        </div>
        {plan.descripcion ? <p className="text-sm text-muted-foreground">{plan.descripcion}</p> : null}
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-4">
        <div>
          <p className="text-3xl font-bold tabular-nums">{formatearCLP(precio)}</p>
          <p className="text-xs text-muted-foreground">{periodicidad === "mensual" ? "por mes" : "por año"}</p>
          {periodicidad === "anual" && ahorroAnual > 0 ? (
            <p className="mt-1 text-xs text-success">Ahorras {formatearCLP(ahorroAnual)} al año</p>
          ) : null}
        </div>

        <ul className="flex-1 space-y-2 text-sm">
          <li className="flex items-start gap-2">
            <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
            <span>
              {plan.limitePedidosMes === null
                ? "Pedidos ilimitados"
                : `Hasta ${plan.limitePedidosMes.toLocaleString("es-CL")} pedidos al mes`}
            </span>
          </li>
          {conductoresMax !== null ? (
            <li className="flex items-start gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
              <span>Hasta {conductoresMax} conductores</span>
            </li>
          ) : null}
          {apiPublica ? (
            <li className="flex items-start gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
              <span>API pública</span>
            </li>
          ) : null}
          {webhooks ? (
            <li className="flex items-start gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
              <span>Webhooks</span>
            </li>
          ) : null}
        </ul>

        <Button
          onClick={onElegir}
          loading={enviando}
          disabled={deshabilitado}
          className="w-full"
          variant={recomendado ? "default" : "outline"}
        >
          {/* COPY */}
          {enviando ? "Creando tu prueba…" : "Empezar prueba gratis"}
        </Button>
      </CardContent>
    </Card>
  );
}
