"use client";

/**
 * VisorPodSeller — Muestra la prueba de entrega (POD) en el portal del seller.
 *
 * Versión simplificada de VisorPod del coordinador:
 * - NO muestra coordenadas GPS (privacidad del conductor).
 * - NO muestra resultado de geocerca (dato interno del courier).
 * - Muestra: resultado (Entregado / No entregado), validez, hora de captura,
 *   motivo de incidencia si aplica, y foto (vía URL firmada de 15 min).
 *
 * La vista pruebas_entrega_seller garantiza que no se exponen foto_path,
 * lat, long ni precision_m al seller. La URL firmada se obtiene vía Server Action.
 */

import { useState, useEffect } from "react";
import { CheckCircle2, XCircle, Clock, Loader2, ImageOff, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { actionObtenerUrlPodSeller } from "./actions";

// =============================================================================
// Tipos (subconjunto de PruebaEntrega que expone la vista pruebas_entrega_seller)
// =============================================================================

export interface PodSeller {
  id: string;
  pedidoId: string;
  tenantId: string;
  tipoResultado: "entregado" | "fallido";
  esValido: boolean;
  capturadoEn: string;
  tipoIncidencia: string | null;
  tieneFoto: boolean;
}

// =============================================================================
// Componente principal
// =============================================================================

export function VisorPodSeller({ pod }: { pod: PodSeller }) {
  const [urlFoto, setUrlFoto] = useState<string | null>(null);
  // Iniciar en true si hay foto que cargar — evita setState síncrono dentro del effect.
  const [cargandoFoto, setCargandoFoto] = useState(pod.tieneFoto);
  const [errorFoto, setErrorFoto] = useState<string | null>(null);

  // Auto-cargar la URL firmada al montar solo si hay foto
  useEffect(() => {
    if (!pod.tieneFoto) return;

    let cancelado = false;

    actionObtenerUrlPodSeller(pod.id)
      .then((resultado) => {
        if (cancelado) return;
        if (resultado.url) setUrlFoto(resultado.url);
        else setErrorFoto(resultado.error ?? "No se pudo cargar la foto.");
      })
      .catch(() => {
        if (!cancelado) setErrorFoto("Error al obtener la foto.");
      })
      .finally(() => {
        if (!cancelado) setCargandoFoto(false);
      });

    return () => {
      cancelado = true;
    };
  }, [pod.id, pod.tieneFoto]);

  const horaCaptura = new Date(pod.capturadoEn).toLocaleString("es-CL", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Santiago",
  });

  const esEntregado = pod.tipoResultado === "entregado";

  return (
    <div className="rounded-lg border bg-card p-4 space-y-4">
      {/* Encabezado con resultado */}
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Prueba de entrega</h3>
        <BadgeResultadoPodSeller
          tipoResultado={pod.tipoResultado}
          esValido={pod.esValido}
        />
      </div>

      {/* Hora de captura */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Clock className="size-3.5" aria-hidden="true" />
        <span>Registrada el {horaCaptura}</span>
      </div>

      {/* Estado de validez */}
      {esEntregado && (
        <div
          className={[
            "flex items-center gap-2 rounded-lg px-3 py-2 text-xs",
            pod.esValido
              ? "bg-success-subtle text-success-subtle-foreground"
              : "bg-warning-subtle text-warning-subtle-foreground",
          ].join(" ")}
        >
          {pod.esValido ? (
            <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <XCircle className="size-3.5 shrink-0" aria-hidden="true" />
          )}
          <span>
            {pod.esValido
              ? "Entrega confirmada por el sistema"
              : "Entrega en revisión — tu empresa de despacho verificará el resultado"}
          </span>
        </div>
      )}

      {/* Motivo de incidencia (para fallidos) */}
      {!esEntregado && pod.tipoIncidencia && (
        <div className="rounded-lg bg-destructive-subtle/40 px-3 py-2 text-xs text-destructive-subtle-foreground">
          Motivo: <span className="font-medium">{pod.tipoIncidencia}</span>
        </div>
      )}

      {/* Foto */}
      {pod.tieneFoto ? (
        <div className="space-y-2">
          <div className="rounded-lg overflow-hidden bg-muted min-h-[120px] flex items-center justify-center">
            {cargandoFoto && (
              <div className="flex h-48 items-center justify-center">
                <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
              </div>
            )}
            {errorFoto && !cargandoFoto && (
              <div className="flex h-48 flex-col items-center justify-center gap-2 text-muted-foreground">
                <ImageOff className="size-6" aria-hidden="true" />
                <p className="text-xs text-center px-4">{errorFoto}</p>
              </div>
            )}
            {urlFoto && !cargandoFoto && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={urlFoto}
                alt={`Foto de la entrega — ${esEntregado ? "entregado" : "intento fallido"}`}
                className="w-full max-h-80 object-contain"
              />
            )}
          </div>

          {/* Botón para abrir en pestaña nueva (útil en móvil) */}
          {urlFoto && !cargandoFoto && (
            <Button
              variant="outline"
              size="sm"
              className="w-full sm:w-auto"
              onClick={() => window.open(urlFoto, "_blank", "noopener,noreferrer")}
            >
              <ExternalLink className="size-3.5 mr-1.5" aria-hidden="true" />
              Ver foto en pantalla completa
            </Button>
          )}
        </div>
      ) : (
        <div className="flex h-20 items-center justify-center gap-2 rounded-lg bg-muted/40 text-sm text-muted-foreground">
          <ImageOff className="size-4" aria-hidden="true" />
          No se capturó foto en esta entrega
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Badge de resultado
// =============================================================================

function BadgeResultadoPodSeller({
  tipoResultado,
  esValido,
}: {
  tipoResultado: PodSeller["tipoResultado"];
  esValido: boolean;
}) {
  if (tipoResultado === "fallido") {
    return <Badge variant="error">No entregado</Badge>;
  }
  if (esValido) {
    return <Badge variant="success">Entregado</Badge>;
  }
  return <Badge variant="warning">Entregado — en revisión</Badge>;
}
