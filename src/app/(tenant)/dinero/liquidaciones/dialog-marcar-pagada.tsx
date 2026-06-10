"use client";

/**
 * Dialog de confirmación para marcar una liquidación como pagada (D-3).
 *
 * Criterio C-1: usa formatearCLPOGuion para el monto.
 */

import { useState, useTransition } from "react";
import { formatearCLPOGuion } from "@/lib/ui/formato-moneda";
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
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        Marcar como pagada
      </button>

      {abierto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="dialog-pagada-titulo"
          className="fixed inset-0 z-50 flex items-center justify-center"
        >
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => !isPending && setAbierto(false)}
            aria-hidden="true"
          />

          <div className="relative z-10 w-full max-w-md rounded-xl border bg-card p-6 shadow-xl">
            <h2
              id="dialog-pagada-titulo"
              className="text-lg font-semibold text-foreground"
            >
              Confirmar pago de liquidación
            </h2>

            <div className="mt-4 space-y-3">
              <p className="text-sm text-muted-foreground">
                Conductor:{" "}
                <span className="font-medium text-foreground">{conductorNombre}</span>
              </p>
              <p className="text-sm text-muted-foreground">
                Período:{" "}
                <span className="font-medium text-foreground">
                  {formatearFechaCorta(fechaInicio)} – {formatearFechaCorta(fechaFin)}
                </span>
              </p>
              <p className="text-sm text-muted-foreground">
                Monto:{" "}
                <span className="text-2xl font-bold text-foreground">
                  {formatearCLPOGuion(montoTotalClp)}
                </span>
              </p>
            </div>

            <p className="mt-4 text-sm text-muted-foreground">
              Confirma que realizaste el pago de{" "}
              <strong>{formatearCLPOGuion(montoTotalClp)}</strong> a{" "}
              <strong>{conductorNombre}</strong>. Este cambio queda registrado en la
              bitácora.
            </p>

            {error && (
              <p
                role="alert"
                className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
              >
                {error}
              </p>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setAbierto(false)}
                disabled={isPending}
                className="rounded-md border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmar}
                disabled={isPending}
                className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {isPending && (
                  <span
                    className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
                    aria-hidden="true"
                  />
                )}
                {isPending ? "Procesando..." : "Confirmar pago"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
