"use client";

/**
 * BloqueEtiqueta — bloque reutilizable para imprimir/descargar la etiqueta
 * imprimible con QR (Rutax) de un pedido same-day.
 *
 * Reutilizado en:
 * - Confirmación inline tras crear un pedido (modo ráfaga).
 * - Detalle del pedido del seller (`/portal/pedidos/[pedidoId]`).
 * - Reimpresión rápida en la lista de "Mis pedidos".
 *
 * Por defecto apunta al endpoint del seller
 * (`/api/portal/pedidos/[pedidoId]/etiqueta`), gateado por
 * `puedeDescargarEtiquetaSameDay`. El detalle interno del courier
 * (`(tenant)/operaciones`) pasa `baseUrl="/api/operaciones"` para reutilizar
 * este mismo componente sobre su propio endpoint.
 *
 * Nunca descarga a ciegas: siempre abre el PDF en una pestaña nueva (el
 * usuario decide si imprime o guarda desde el visor del navegador). Si la
 * obtención falla, muestra el error con botón "Reintentar".
 */

import { useState } from "react";
import { Printer, Download, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type FormatoEtiqueta = "termica" | "carta";

interface Props {
  pedidoId: string;
  /** Base del endpoint de etiqueta. Default: portal del seller. */
  baseUrl?: string;
  /** Variante compacta — solo íconos, para filas de tabla. */
  compacto?: boolean;
  /**
   * Variante de la confirmación de «pedido creado»: la etiqueta es el paso que
   * sigue, así que el botón es el principal de la pantalla. Descarga el PDF en
   * térmica y deja «Imprimir» al lado; el formato se cambia en un enlace, no en
   * un selector que hay que abrir antes de poder hacer nada.
   */
  principal?: boolean;
  /** Código visible del pedido (RX-…): nombra el archivo descargado. */
  codigo?: string | null;
  className?: string;
}

async function obtenerEtiquetaPdf(
  url: string,
): Promise<{ ok: true; blob: Blob } | { ok: false; mensaje: string }> {
  try {
    const respuesta = await fetch(url);
    if (!respuesta.ok) {
      const datos = await respuesta.json().catch(() => null);
      return { ok: false, mensaje: datos?.error ?? "No se pudo obtener la etiqueta." };
    }
    const blob = await respuesta.blob();
    return { ok: true, blob };
  } catch {
    return { ok: false, mensaje: "No se pudo obtener la etiqueta. Revisa tu conexión." };
  }
}

export function BloqueEtiqueta({
  pedidoId,
  baseUrl = "/api/portal/pedidos",
  compacto = false,
  principal = false,
  codigo = null,
  className,
}: Props) {
  const [formato, setFormato] = useState<FormatoEtiqueta>("termica");
  const [cargando, setCargando] = useState<"ver" | "descargar" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const url = `${baseUrl}/${pedidoId}/etiqueta?formato=${formato}`;

  async function verEtiqueta() {
    setCargando("ver");
    setError(null);
    const resultado = await obtenerEtiquetaPdf(url);
    if (resultado.ok) {
      window.open(URL.createObjectURL(resultado.blob), "_blank");
    } else {
      setError(resultado.mensaje);
    }
    setCargando(null);
  }

  async function descargarEtiqueta() {
    setCargando("descargar");
    setError(null);
    const resultado = await obtenerEtiquetaPdf(url);
    if (resultado.ok) {
      const objectUrl = URL.createObjectURL(resultado.blob);
      const enlace = document.createElement("a");
      enlace.href = objectUrl;
      enlace.download = `etiqueta-${codigo ?? pedidoId}.pdf`;
      document.body.appendChild(enlace);
      enlace.click();
      enlace.remove();
      URL.revokeObjectURL(objectUrl);
    } else {
      setError(resultado.mensaje);
    }
    setCargando(null);
  }

  if (principal) {
    return (
      <div className={["space-y-2", className].filter(Boolean).join(" ")}>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            onClick={descargarEtiqueta}
            loading={cargando === "descargar"}
            className="w-full sm:w-auto"
          >
            {cargando !== "descargar" && <Download className="size-4" aria-hidden="true" />}
            Descargar etiqueta
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={verEtiqueta}
            loading={cargando === "ver"}
            className="w-full sm:w-auto"
          >
            {cargando !== "ver" && <Printer className="size-4" aria-hidden="true" />}
            Imprimir
          </Button>
        </div>
        <p className="text-xs text-fg-muted">
          {formato === "termica" ? "Térmica 10x15" : "Carta / A4"} ·{" "}
          <button
            type="button"
            onClick={() => setFormato(formato === "termica" ? "carta" : "termica")}
            className="font-medium underline underline-offset-2"
          >
            {formato === "termica" ? "Usar carta / A4" : "Usar térmica 10x15"}
          </button>
        </p>
        {error && (
          <p role="alert" className="flex items-center gap-1.5 text-xs text-destructive">
            {error}
            <button
              type="button"
              onClick={descargarEtiqueta}
              className="inline-flex items-center gap-1 font-medium underline underline-offset-2"
            >
              <RotateCw className="size-3" aria-hidden="true" />
              Intentar de nuevo
            </button>
          </p>
        )}
      </div>
    );
  }

  if (compacto) {
    return (
      <div className={className}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={verEtiqueta}
          loading={cargando === "ver"}
          title="Imprimir etiqueta"
          aria-label="Imprimir etiqueta"
        >
          {cargando !== "ver" && <Printer className="size-4" aria-hidden="true" />}
        </Button>
        {error && (
          <p role="alert" className="mt-1 text-xs text-destructive">
            {error}{" "}
            <button type="button" onClick={verEtiqueta} className="underline">
              Intentar de nuevo
            </button>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={["space-y-2", className].filter(Boolean).join(" ")}>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={formato} onValueChange={(v) => setFormato(v as FormatoEtiqueta)}>
          <SelectTrigger size="sm" className="h-8 w-40" aria-label="Formato de etiqueta">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="termica">Térmica 10x15</SelectItem>
            <SelectItem value="carta">Carta / A4</SelectItem>
          </SelectContent>
        </Select>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={verEtiqueta}
          loading={cargando === "ver"}
        >
          {cargando !== "ver" && <Printer className="size-4" aria-hidden="true" />}
          Ver etiqueta
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={descargarEtiqueta}
          loading={cargando === "descargar"}
        >
          {cargando !== "descargar" && <Download className="size-4" aria-hidden="true" />}
          Guardar PDF
        </Button>
      </div>

      {error && (
        <p role="alert" className="flex items-center gap-1.5 text-xs text-destructive">
          {error}
          <button
            type="button"
            onClick={verEtiqueta}
            className="inline-flex items-center gap-1 font-medium underline underline-offset-2"
          >
            <RotateCw className="size-3" aria-hidden="true" />
            Intentar de nuevo
          </button>
        </p>
      )}
    </div>
  );
}
