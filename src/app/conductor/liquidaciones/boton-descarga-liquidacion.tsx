"use client";

/**
 * Botón de descarga del PDF de liquidación para el conductor (C-1).
 *
 * Criterio C-3: nunca expone pdfRef al cliente. Llama al Server Action.
 * Mobile-first: ancho completo, altura mínima 48px.
 */

import { useState, useTransition } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
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
      <Button
        type="button"
        variant="outline"
        onClick={handleClick}
        loading={isPending}
        className="min-h-11 w-full"
      >
        {!isPending && <Download className="size-4" aria-hidden="true" />}
        {isPending ? "Generando enlace..." : "Descargar liquidación"}
      </Button>
      {error && (
        <p className="text-center text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
