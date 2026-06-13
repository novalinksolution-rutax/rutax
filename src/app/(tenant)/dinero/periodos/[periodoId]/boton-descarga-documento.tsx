"use client";

/**
 * Botón de descarga de documento (PDF DTE / XML DTE / PDF liquidación).
 *
 * Criterio C-3: el botón NUNCA expone la referencia de Storage al cliente.
 * Llama al Server Action correspondiente que genera la signed URL y redirige.
 * Muestra spinner mientras espera. Si falla: mensaje de error inline.
 */

import { useState, useTransition } from "react";
import { Download } from "lucide-react";
import { accionDescargarPdfDte, accionDescargarXmlDte } from "./actions";

type TipoDocumento = "pdf-dte" | "xml-dte";

interface Props {
  tipo: TipoDocumento;
  referencia: string;
  etiqueta?: string;
}

export function BotonDescargaDocumento({ tipo, referencia, etiqueta }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      try {
        if (tipo === "pdf-dte") {
          await accionDescargarPdfDte(referencia);
        } else {
          await accionDescargarXmlDte(referencia);
        }
      } catch (err) {
        const mensaje =
          err instanceof Error ? err.message : "No se pudo generar el enlace de descarga.";
        setError(mensaje);
      }
    });
  }

  const textoDefault = tipo === "pdf-dte" ? "Ver PDF" : "Ver XML";

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50"
      >
        {isPending ? (
          <span
            className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden="true"
          />
        ) : (
          <Download className="size-4" aria-hidden="true" />
        )}
        {isPending ? "Generando enlace..." : (etiqueta ?? textoDefault)}
      </button>
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
