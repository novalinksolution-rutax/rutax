"use client";

/**
 * Botón de descarga del PDF de factura para el seller (S-2).
 *
 * Criterio C-3: nunca expone pdfRef al cliente. Llama al Server Action.
 */

import { useState, useTransition } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
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
      <Button type="button" onClick={handleClick} loading={isPending}>
        {!isPending && <Download className="size-4" aria-hidden="true" />}
        {isPending ? "Generando enlace..." : etiqueta}
      </Button>
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
