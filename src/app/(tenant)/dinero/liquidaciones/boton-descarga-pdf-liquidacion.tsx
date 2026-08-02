"use client";

/**
 * Botón de descarga del PDF de liquidación (backoffice D-3).
 *
 * Criterio C-3: nunca expone pdfRef al cliente. Llama al Server Action.
 */

import { useState, useTransition } from "react";
import { Download } from "lucide-react";
import { accionDescargarPdfLiquidacion } from "./actions";

export function BotonDescargaPdfLiquidacion({ pdfRef }: { pdfRef: string }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      try {
        await accionDescargarPdfLiquidacion(pdfRef);
      } catch (err) {
        const mensaje =
          err instanceof Error ? err.message : "No se pudo generar el enlace de descarga.";
        setError(mensaje);
      }
    });
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50"
        title="Descargar PDF de liquidación"
      >
        {isPending ? (
          <span
            className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden="true"
          />
        ) : (
          <Download className="size-3.5" aria-hidden="true" />
        )}
        {isPending ? "..." : "Descargar"}
      </button>
      {error && (
        <p className="text-xs text-destructive" role="alert">
          Error
        </p>
      )}
    </div>
  );
}
