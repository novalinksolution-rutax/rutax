"use client";

/**
 * Botón "Descargar etiqueta" (C-04, RF-021).
 *
 * Llama a GET /api/operaciones/[pedidoId]/etiqueta:
 * - 200 (application/pdf): abre el PDF en una nueva pestaña (no fuerza descarga).
 * - Otro código: muestra el mensaje de error devuelto por el backend.
 */

import { useState } from "react";
import { FileText } from "lucide-react";

interface Props {
  pedidoId: string;
}

export function BotonDescargarEtiqueta({ pedidoId }: Props) {
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setCargando(true);
    setError(null);

    try {
      const respuesta = await fetch(`/api/operaciones/${pedidoId}/etiqueta`);

      if (respuesta.ok) {
        const blob = await respuesta.blob();
        window.open(URL.createObjectURL(blob), "_blank");
      } else {
        const datos = await respuesta.json().catch(() => null);
        setError(datos?.error ?? "No se pudo obtener la etiqueta.");
      }
    } catch {
      setError("No se pudo obtener la etiqueta.");
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={cargando}
        className="inline-flex items-center gap-2 rounded-lg border bg-card px-4 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:cursor-not-allowed disabled:opacity-60"
      >
        <FileText className="size-4" aria-hidden="true" />
        {cargando ? "Obteniendo etiqueta..." : "Descargar etiqueta"}
      </button>

      {error && (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
