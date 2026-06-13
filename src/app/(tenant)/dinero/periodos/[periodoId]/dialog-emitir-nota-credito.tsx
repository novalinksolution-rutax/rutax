"use client";

/**
 * Dialog de confirmación para EMITIR una NOTA DE CRÉDITO (DTE 61) que anula
 * TOTALMENTE la factura de un período facturado (RF-038, decisión B7).
 *
 * Compuerta humana espejo de la de emisión: la NC es un documento tributario
 * irreversible, así que exige un motivo obligatorio (queda en la auditoría y
 * en la propia NC) y advierte los efectos antes de confirmar.
 *
 * Al confirmar: llama a accionEmitirNotaCredito (gate `emitir_facturas`).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileX2 } from "lucide-react";
import { formatearCLP, formatearCLPOGuion } from "@/lib/ui/formato-moneda";
import { accionEmitirNotaCredito } from "./actions";

interface Props {
  periodoId: string;
  sellerNombre: string;
  /** Folio de la factura (DTE 33) que se va a anular. */
  folioFactura: number;
  /** Monto total de la factura a anular (el de la NC es el mismo, copiado). */
  montoTotalClp: number | null;
  /** Pagos ya imputados al período — si > 0 se advierte la desimputación. */
  montoPagadoClp: number;
}

export function DialogEmitirNotaCredito({
  periodoId,
  sellerNombre,
  folioFactura,
  montoTotalClp,
  montoPagadoClp,
}: Props) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const motivoValido = motivo.trim().length > 0;

  function handleConfirmar() {
    setError(null);
    if (!motivoValido) {
      setError("Escribe el motivo de la anulación: es obligatorio y queda en la auditoría.");
      return;
    }
    startTransition(async () => {
      const resultado = await accionEmitirNotaCredito(periodoId, motivo.trim());
      if (resultado.ok) {
        setAbierto(false);
        setMotivo("");
        toast.success("Nota de crédito solicitada", {
          description: "El período quedará anulado en unos segundos.",
        });
        // Refresco suave: el período pasa a "anulado" sin perder el toast.
        router.refresh();
      } else {
        setError(resultado.mensaje);
      }
    });
  }

  function cerrar() {
    if (isPending) return;
    setAbierto(false);
    setError(null);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="inline-flex items-center gap-2 rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50"
      >
        <FileX2 className="size-4" aria-hidden="true" />
        Emitir nota de crédito
      </button>

      {abierto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="dialog-nc-titulo"
          className="fixed inset-0 z-50 flex items-center justify-center"
        >
          <div
            className="absolute inset-0 bg-black/40"
            onClick={cerrar}
            aria-hidden="true"
          />

          <div className="relative z-10 w-full max-w-md rounded-xl border bg-card p-6 shadow-xl">
            <h2 id="dialog-nc-titulo" className="text-lg font-semibold text-foreground">
              Anular factura de {sellerNombre}
            </h2>

            <div className="mt-4 space-y-3">
              <p className="text-sm text-muted-foreground">
                Factura a anular:{" "}
                <span className="font-medium text-foreground tabular-nums">
                  Folio {folioFactura}
                </span>
              </p>
              <p className="text-sm text-muted-foreground">
                Monto total:{" "}
                <span className="text-2xl font-bold text-foreground tabular-nums">
                  {formatearCLPOGuion(montoTotalClp)}
                </span>
              </p>
            </div>

            <div className="mt-4 space-y-1">
              <label
                htmlFor="nc-motivo"
                className="text-sm font-medium text-foreground"
              >
                Motivo de la anulación{" "}
                <span className="text-red-600" aria-hidden="true">*</span>
              </label>
              <textarea
                id="nc-motivo"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                disabled={isPending}
                required
                rows={3}
                placeholder="Ej.: monto incorrecto, entregas mal imputadas, factura emitida por error…"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              />
              <p className="text-xs text-muted-foreground">
                Queda registrado en la auditoría y en la nota de crédito.
              </p>
            </div>

            <div className="mt-4 space-y-2">
              <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                La nota de crédito es un documento tributario{" "}
                <strong>irreversible</strong>: anula la factura completa y el
                período quedará anulado. Las entregas del período volverán al
                período de facturación en curso.
              </p>
              {montoPagadoClp > 0 && (
                <p className="rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
                  Hay <strong className="tabular-nums">{formatearCLP(montoPagadoClp)}</strong>{" "}
                  ya pagados imputados a este período: volverán a la bandeja de
                  revisión de pagos para reimputarse.
                </p>
              )}
            </div>

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
                onClick={cerrar}
                disabled={isPending}
                className="rounded-md border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmar}
                disabled={isPending || !motivoValido}
                className="flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                {isPending && (
                  <span
                    className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
                    aria-hidden="true"
                  />
                )}
                {isPending ? "Emitiendo…" : "Anular factura"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
