"use client";

/**
 * Dialog de confirmación para emitir un pago electrónico a un conductor (F19).
 *
 * Invoca accionEmitirPagoLiquidacion → emitirPagoLiquidacion → job Inngest.
 * El pago es asíncrono: la acción no espera confirmación del banco.
 * Tras confirmar, recarga la página después de 2 s para reflejar estado 'pendiente'.
 */

import { useState, useTransition } from "react";
import { formatearCLPOGuion } from "@/lib/ui/formato-moneda";
import { accionEmitirPagoLiquidacion } from "./actions";

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

export function DialogEmitirPago({
  liquidacionId,
  conductorNombre,
  fechaInicio,
  fechaFin,
  montoTotalClp,
}: Props) {
  const [abierto, setAbierto] = useState(false);
  const [exito, setExito] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleConfirmar() {
    setError(null);
    startTransition(async () => {
      const resultado = await accionEmitirPagoLiquidacion(liquidacionId);
      if (resultado.ok) {
        setExito(true);
        // Recargar después de 2 s para mostrar estado 'pendiente' en la tabla
        setTimeout(() => {
          window.location.reload();
        }, 2000);
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
        Emitir pago
      </button>

      {abierto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="dialog-emitir-pago-titulo"
          className="fixed inset-0 z-50 flex items-center justify-center"
        >
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => !isPending && !exito && setAbierto(false)}
            aria-hidden="true"
          />

          <div className="relative z-10 w-full max-w-md rounded-xl border bg-card p-6 shadow-xl">
            <h2
              id="dialog-emitir-pago-titulo"
              className="text-lg font-semibold text-foreground"
            >
              Confirmar pago a conductor
            </h2>

            {exito ? (
              <div className="mt-4">
                <p
                  role="status"
                  className="rounded-lg bg-success-subtle px-4 py-3 text-sm font-medium text-success-subtle-foreground"
                >
                  Pago iniciado — se procesará en los próximos minutos.
                </p>
                <p className="mt-3 text-xs text-muted-foreground">
                  Recargando la página…
                </p>
              </div>
            ) : (
              <>
                <div className="mt-4 space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Conductor:{" "}
                    <span className="font-medium text-foreground">
                      {conductorNombre}
                    </span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Período:{" "}
                    <span className="font-medium text-foreground">
                      {formatearFechaCorta(fechaInicio)} –{" "}
                      {formatearFechaCorta(fechaFin)}
                    </span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Monto total:{" "}
                    <span className="text-2xl font-bold text-foreground">
                      {formatearCLPOGuion(montoTotalClp)}
                    </span>
                  </p>
                </div>

                <p className="mt-4 text-sm text-muted-foreground">
                  Esto iniciará una transferencia electrónica. El pago se
                  procesará en los próximos minutos.
                </p>

                {error && (
                  <p
                    role="alert"
                    className="mt-3 rounded-lg bg-destructive-subtle px-3 py-2 text-sm text-destructive-subtle-foreground"
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
                    {isPending ? "Iniciando…" : "Confirmar pago"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
