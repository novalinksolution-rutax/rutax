"use client";

/**
 * El switcher multi-courier del seller (RF-010 rediseño) — mismo patrón que
 * el del conductor (F4): una identidad Google puede ser seller de N couriers
 * y elige con cuál opera.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { DistintivoEstado } from "@/components/ui/distintivo-estado";
import { cambiarCourierActivoAction, type ResultadoListarCouriers } from "./actions";

type Courier = Extract<ResultadoListarCouriers, { ok: true }>["couriers"][number];

export function SelectorCourier({ couriers }: { couriers: Courier[] }) {
  const router = useRouter();
  const [cambiandoA, setCambiandoA] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function elegir(courier: Courier) {
    if (courier.esActual || courier.estado === "bloqueada") return;
    setError(null);
    setCambiandoA(courier.tenantId);
    startTransition(async () => {
      const r = await cambiarCourierActivoAction(courier.tenantId);
      if (!r.ok) {
        setError(r.mensaje);
        setCambiandoA(null);
        return;
      }
      toast.success(`Ahora estás operando con ${courier.nombreCourier}.`);
      router.refresh();
      router.push("/portal");
    });
  }

  return (
    <div className="space-y-3">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        {couriers.map((c) => {
          const bloqueado = c.estado === "bloqueada";
          const activo = c.esActual;
          const cargandoEste = pendiente && cambiandoA === c.tenantId;
          return (
            <li key={c.tenantId}>
              <button
                type="button"
                disabled={activo || bloqueado || pendiente}
                onClick={() => elegir(c)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors enabled:hover:bg-muted disabled:cursor-not-allowed"
              >
                <span className="min-w-0 space-y-1">
                  <span className="block truncate font-medium text-foreground">{c.nombreCourier}</span>
                  {bloqueado ? (
                    <span className="flex items-center gap-1.5 text-xs text-destructive">
                      <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
                      Este courier bloqueó tu acceso
                    </span>
                  ) : null}
                </span>
                {activo ? (
                  <DistintivoEstado tono="balanced" etiqueta="Operando ahora" />
                ) : cargandoEste ? (
                  <span className="text-xs text-muted-foreground">Cambiando…</span>
                ) : !bloqueado ? (
                  <span className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground">
                    <Check className="size-3.5" aria-hidden="true" />
                    Elegir
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
