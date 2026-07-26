"use client";

/**
 * Dialog de confirmación para marcar una liquidación como pagada (D-3).
 *
 * Criterio C-1: usa formatearCLPOGuion para el monto.
 */

import { useState, useTransition } from "react";
import { formatearCLPOGuion } from "@/lib/ui/formato-moneda";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { accionMarcarLiquidacionPagada } from "./actions";

interface Props {
  liquidacionId: string;
  conductorNombre: string;
  fechaInicio: string;
  fechaFin: string;
  montoTotalClp: number | null;
}

function formatearFechaCorta(fechaIso: string): string {
  if (!fechaIso || fechaIso.length < 10) return fechaIso;
  const [anio, mes, dia] = fechaIso.slice(0, 10).split("-");
  return `${dia}/${mes}/${anio}`;
}

export function DialogMarcarPagada({
  liquidacionId,
  conductorNombre,
  fechaInicio,
  fechaFin,
  montoTotalClp,
}: Props) {
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleConfirmar() {
    setError(null);
    startTransition(async () => {
      const resultado = await accionMarcarLiquidacionPagada(liquidacionId);
      if (resultado.ok) {
        setAbierto(false);
        window.location.reload();
      } else {
        setError(resultado.mensaje);
      }
    });
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(o) => {
        if (isPending) return;
        setAbierto(o);
        if (!o) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className="rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Marcar como pagada
        </button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Confirmar pago de liquidación</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Conductor:{" "}
            <span className="font-medium text-foreground">{conductorNombre}</span>
          </p>
          <p className="text-sm text-muted-foreground">
            Período:{" "}
            <span className="font-medium tabular-nums text-foreground">
              {formatearFechaCorta(fechaInicio)} – {formatearFechaCorta(fechaFin)}
            </span>
          </p>
          <p className="text-sm text-muted-foreground">
            Monto:{" "}
            <span className="text-2xl font-semibold tabular-nums text-foreground">
              {formatearCLPOGuion(montoTotalClp)}
            </span>
          </p>

          <p className="text-sm text-muted-foreground">
            Confirma que realizaste el pago de{" "}
            <strong>{formatearCLPOGuion(montoTotalClp)}</strong> a{" "}
            <strong>{conductorNombre}</strong>. Este cambio queda registrado en la
            bitácora.
          </p>

          {error && (
            <p
              role="alert"
              className="rounded-lg bg-destructive-subtle px-3 py-2 text-sm text-destructive-subtle-foreground"
            >
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setAbierto(false)}
            disabled={isPending}
          >
            Cancelar
          </Button>
          <Button type="button" onClick={handleConfirmar} disabled={isPending}>
            {isPending && (
              <span
                className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent"
                aria-hidden="true"
              />
            )}
            {isPending ? "Procesando..." : "Confirmar pago"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
