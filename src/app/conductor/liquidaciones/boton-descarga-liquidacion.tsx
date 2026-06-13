"use client";

/**
 * Botón de descarga del PDF de liquidación para el conductor (C-1).
 *
 * Criterio C-3: nunca expone pdfRef al cliente. Llama al Server Action.
 * Mobile-first: ancho completo, altura mínima 48px.
 */

import { useState, useTransition } from "react";
import { Download } from "lucide-react";
import { accionDescargarPdfLiquidacionConductor } from "./actions";

export function BotonDescargaLiquidacion({ pdfRef }: { pdfRef: string }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      try {
        await accionDescargarPdfLiquidacionConductor(pdfRef);
      } catch (err) {
        const mensaje =
          err instanceof Error ? err.message : "No se pudo generar el enlace de descarga.";
        setError(mensaje);
      }
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="flex w-full min-h-[48px] items-center justify-center gap-2 rounded-lg border bg-card px-4 py-3 text-sm font-semibold text-foreground hover:bg-muted transition-colors disabled:opacity-50 active:scale-[0.98]"
      >
        {isPending ? (
          <span
            className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden="true"
          />
        ) : (
          <Download className="size-4" aria-hidden="true" />
        )}
        {isPending ? "Generando enlace..." : "Descargar liquidación"}
      </button>
      {error && (
        <p className="text-center text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
