"use client";

/**
 * Botón de descarga del PDF de factura para el seller (S-2).
 *
 * Criterio C-3: nunca expone pdfRef al cliente. Llama al Server Action.
 */

import { useState, useTransition } from "react";
import { Download } from "lucide-react";
import { accionDescargarFacturaPdf } from "../actions";

export function BotonDescargaFacturaPdf({
  pdfRef,
  etiqueta = "Descargar factura (PDF)",
}: {
  pdfRef: string;
  /** Texto del botón (p. ej. "Descargar nota de crédito (PDF)"). */
  etiqueta?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      try {
        await accionDescargarFacturaPdf(pdfRef);
      } catch (err) {
        const mensaje =
          err instanceof Error ? err.message : "No se pudo generar el enlace de descarga.";
        setError(mensaje);
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
      >
        {isPending ? (
          <span
            className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
            aria-hidden="true"
          />
        ) : (
          <Download className="size-4" aria-hidden="true" />
        )}
        {isPending ? "Generando enlace..." : etiqueta}
      </button>
      {error && (
        <p className="text-xs text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
