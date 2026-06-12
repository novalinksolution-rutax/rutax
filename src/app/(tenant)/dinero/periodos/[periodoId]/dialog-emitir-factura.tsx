"use client";

/**
 * Dialog de confirmación para EMITIR la factura (DTE) de un período cerrado.
 *
 * Es la compuerta de aprobación humana del motor entrega→dinero (B1-1): el
 * cierre del período NO factura; emitir el DTE es una acción deliberada,
 * porque un DTE es irreversible ante el SII sin nota de crédito.
 *
 * Al confirmar: llama a accionEmitirFactura (gate `emitir_facturas`).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText } from "lucide-react";
import { formatearCLPOGuion } from "@/lib/ui/formato-moneda";
import { accionEmitirFactura } from "./actions";

interface Props {
  periodoId: string;
  sellerNombre: string;
  totalLineas: number;
  montoTotalClp: number | null;
}

export function DialogEmitirFactura({
  periodoId,
  sellerNombre,
  totalLineas,
  montoTotalClp,
}: Props) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleConfirmar() {
    setError(null);
    startTransition(async () => {
      const resultado = await accionEmitirFactura(periodoId);
      if (resultado.ok) {
        setAbierto(false);
        toast.success("Factura emitida", {
          description: "El DTE se generó en modo sandbox (no se envió al SII real).",
        });
        // Refresco suave: el período pasa a "facturado" sin perder el toast.
        router.refresh();
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
        className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <FileText className="size-4" aria-hidden="true" />
        Emitir factura
      </button>

      {abierto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="dialog-emitir-titulo"
          className="fixed inset-0 z-50 flex items-center justify-center"
        >
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => !isPending && setAbierto(false)}
            aria-hidden="true"
          />

          <div className="relative z-10 w-full max-w-md rounded-xl border bg-card p-6 shadow-xl">
            <h2 id="dialog-emitir-titulo" className="text-lg font-semibold text-foreground">
              Emitir factura de {sellerNombre}
            </h2>

            <div className="mt-4 space-y-3">
              <p className="text-sm text-muted-foreground">
                Líneas a facturar:{" "}
                <span className="font-medium text-foreground">{totalLineas}</span>
              </p>
              <p className="text-sm text-muted-foreground">
                Monto total:{" "}
                <span className="text-2xl font-bold text-foreground">
                  {formatearCLPOGuion(montoTotalClp)}
                </span>
              </p>
            </div>

            <p className="mt-4 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
              Se emitirá un DTE (factura electrónica) bajo el RUT de tu courier. Un
              documento emitido al SII <strong>no se puede anular</strong>: corregirlo
              exige una nota de crédito. Revisa el monto y las líneas antes de confirmar.
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
                className="rounded-md border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmar}
                disabled={isPending}
                className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {isPending && (
                  <span
                    className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent"
                    aria-hidden="true"
                  />
                )}
                {isPending ? "Emitiendo…" : "Confirmar emisión"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
