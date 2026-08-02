"use client";

/**
 * Botón "Descargar etiqueta" (C-04, RF-021).
 *
 * Llama a GET /api/operaciones/[pedidoId]/etiqueta:
 * - 200 (application/pdf): abre el PDF en una nueva pestaña (no fuerza descarga).
 * - Otro código: muestra el mensaje de error devuelto por el backend.
 *
 * Para pedidos same-day muestra además un selector de formato (térmica/carta) —
 * el endpoint interno soporta `?formato=` para esta rama; en Flex el formato
 * no aplica (la etiqueta la genera Mercado Libre) y el selector se oculta.
 */

import { useState } from "react";
import { FileText } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Props {
  pedidoId: string;
  esSameDay?: boolean;
}

type FormatoEtiqueta = "termica" | "carta";

export function BotonDescargarEtiqueta({ pedidoId, esSameDay = false }: Props) {
  const [formato, setFormato] = useState<FormatoEtiqueta>("termica");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setCargando(true);
    setError(null);

    try {
      const query = esSameDay ? `?formato=${formato}` : "";
      const respuesta = await fetch(`/api/operaciones/${pedidoId}/etiqueta${query}`);

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
      <div className="flex items-center gap-2">
        {esSameDay && (
          <Select value={formato} onValueChange={(v) => setFormato(v as FormatoEtiqueta)}>
            <SelectTrigger size="sm" className="h-9 w-36" aria-label="Formato de etiqueta">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="termica">Térmica 10x15</SelectItem>
              <SelectItem value="carta">Carta / A4</SelectItem>
            </SelectContent>
          </Select>
        )}

        <button
          type="button"
          onClick={handleClick}
          disabled={cargando}
          className="inline-flex items-center gap-2 rounded-lg border bg-card px-4 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:cursor-not-allowed disabled:opacity-60"
        >
          <FileText className="size-4" aria-hidden="true" />
          {cargando ? "Obteniendo etiqueta..." : "Descargar etiqueta"}
        </button>
      </div>

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
