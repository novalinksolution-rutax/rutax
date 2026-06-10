"use client";

/**
 * Dialog de confirmación para cerrar un período de cobro (flujo D-1 y D-2).
 *
 * Criterio C-1: usa formatearCLP para el monto.
 * Al confirmar: llama a accionCerrarPeriodo. Muestra spinner y toast.
 */

import { useState, useTransition } from "react";
import { formatearCLPOGuion } from "@/lib/ui/formato-moneda";
import { accionCerrarPeriodo } from "./actions";

interface Props {
  periodoId: string;
  sellerNombre: string;
  fechaInicio: string;
  fechaFin: string;
  totalLineas: number;
  montoTotalClp: number | null;
}

function formatearFechaCorta(fechaIso: string): string {
  if (!fechaIso || fechaIso.length < 10) return fechaIso;
  const [anio, mes, dia] = fechaIso.slice(0, 10).split("-");
  return `${dia}/${mes}/${anio}`;
}

export function DialogCerrarPeriodo({
  periodoId,
  sellerNombre,
  fechaInicio,
  fechaFin,
  totalLineas,
  montoTotalClp,
}: Props) {
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleConfirmar() {
    setError(null);
    startTransition(async () => {
      const resultado = await accionCerrarPeriodo(periodoId);
      if (resultado.ok) {
        setExito(true);
        setAbierto(false);
        // Recargar para reflejar el nuevo estado en la tabla
        window.location.reload();
      } else {
        setError(resultado.mensaje);
      }
    });
  }

  if (exito) {
    return (
      <span className="text-xs text-green-700 font-medium">Cerrando...</span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        Cerrar período
      </button>

      {abierto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="dialog-cerrar-titulo"
          className="fixed inset-0 z-50 flex items-center justify-center"
        >
          {/* Overlay */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => !isPending && setAbierto(false)}
            aria-hidden="true"
          />

          {/* Panel */}
          <div className="relative z-10 w-full max-w-md rounded-xl border bg-card p-6 shadow-xl">
            <h2
              id="dialog-cerrar-titulo"
              className="text-lg font-semibold text-foreground"
            >
              Cerrar período de {sellerNombre}
            </h2>

            <div className="mt-4 space-y-3">
              <p className="text-sm text-muted-foreground">
                Período:{" "}
                <span className="font-medium text-foreground">
                  {formatearFechaCorta(fechaInicio)} – {formatearFechaCorta(fechaFin)}
                </span>
              </p>
              <p className="text-sm text-muted-foreground">
                Total de líneas:{" "}
                <span className="font-medium text-foreground">{totalLineas}</span>
              </p>
              <p className="text-sm text-muted-foreground">
                Monto total:{" "}
                <span className="text-2xl font-bold text-foreground">
                  {formatearCLPOGuion(montoTotalClp)}
                </span>
              </p>
            </div>

            <p className="mt-4 rounded-lg bg-yellow-50 border border-yellow-200 px-4 py-3 text-sm text-yellow-800">
              Una vez cerrado, este período se facturará automáticamente. Esta acción no se
              puede deshacer.
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
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {isPending && (
                  <span
                    className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
                    aria-hidden="true"
                  />
                )}
                {isPending ? "Cerrando..." : "Confirmar cierre"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
