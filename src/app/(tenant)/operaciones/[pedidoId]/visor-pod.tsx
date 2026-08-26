"use client";

/**
 * VisorPod — Muestra la foto del POD (Prueba de Entrega) al coordinador/dueño.
 *
 * Obtiene una URL firmada de 15 minutos al cargar. Muestra:
 * - La foto del POD.
 * - Badge de resultado de geocerca: "Ubicación verificada" / "Fuera del destino".
 * - Hora de captura.
 *
 * El coordinador puede ver PODs de cualquier pedido del tenant.
 * El acceso real lo controla obtenerUrlFirmadaPod (RBAC + tenant).
 *
 * PRIVACIDAD: la URL firmada tiene una vida útil de 15 min (no pública).
 * Las coordenadas del conductor NO se muestran aquí.
 */

import { useState, useEffect } from "react";
import { CheckCircle2, AlertTriangle, Clock, Loader2, ImageOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { actionObtenerUrlPodCoordinador } from "./actions-pod";
import type { PruebaEntrega } from "@/modules/operacion/pruebas-entrega";

// =============================================================================
// Props
// =============================================================================

interface Props {
  pod: PruebaEntrega;
}

// =============================================================================
// Componente
// =============================================================================

export function VisorPod({ pod }: Props) {
  const [urlFoto, setUrlFoto] = useState<string | null>(null);
  // Inicia en `true` si hay foto que cargar — evita setState síncrono en el effect.
  const [cargando, setCargando] = useState(pod.tieneFoto);
  const [error, setError] = useState<string | null>(null);

  // Cargar URL firmada al montar
  useEffect(() => {
    if (!pod.tieneFoto) return;

    let cancelado = false;
    actionObtenerUrlPodCoordinador(pod.id)
      .then((resultado) => {
        if (cancelado) return;
        if (resultado.url) setUrlFoto(resultado.url);
        else setError(resultado.error ?? "No se pudo cargar la foto.");
      })
      .catch(() => {
        if (!cancelado) setError("Error al obtener la foto.");
      })
      .finally(() => {
        if (!cancelado) setCargando(false);
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

  return (
    <div className="rounded-lg border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Prueba de entrega (POD)</h3>
        <BadgeResultadoPod tipoResultado={pod.tipoResultado} esValido={pod.esValido} />
      </div>

      {/* Hora de captura */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Clock className="size-3.5" aria-hidden="true" />
        <span>Capturado el {horaCaptura}</span>
      </div>

      {/* Foto */}
      {pod.tieneFoto ? (
        <div className="rounded-lg overflow-hidden bg-muted">
          {cargando && (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
            </div>
          )}
          {error && !cargando && (
            <div className="flex h-48 flex-col items-center justify-center gap-2 text-muted-foreground">
              <ImageOff className="size-6" aria-hidden="true" />
              <p className="text-xs">{error}</p>
            </div>
          )}
          {urlFoto && !cargando && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={urlFoto}
              alt={`Foto del POD — ${pod.tipoResultado === "entregado" ? "entrega confirmada" : "intento fallido"}`}
              className="w-full max-h-80 object-contain"
            />
          )}
        </div>
      ) : (
        <div className="flex h-24 items-center justify-center gap-2 rounded-lg bg-muted/40 text-sm text-muted-foreground">
          <ImageOff className="size-4" aria-hidden="true" />
          Sin foto adjunta
        </div>
      )}

      {/* Resultado de geocerca */}
      <SeccionGeocerca
        geocercaResultado={pod.geocercaResultado}
        distanciaM={pod.distanciaDestinoM}
      />

      {/* Tipo de incidencia (para fallidos) */}
      {pod.tipoResultado === "fallido" && pod.tipoIncidencia && (
        <div className="rounded-lg bg-destructive-subtle/40 px-3 py-2 text-xs text-destructive-subtle-foreground">
          Motivo: <span className="font-medium">{pod.tipoIncidencia}</span>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Badge según resultado del POD
// =============================================================================

// `esValido` ya incorpora el resultado de la geocerca, así que el badge no
// necesita mirarla: recibirla aparte era un resto que invitaba a decidir dos
// veces lo mismo con criterios que podían separarse. La geocerca en detalle la
// muestra `SeccionGeocerca`, más abajo.
function BadgeResultadoPod({
  tipoResultado,
  esValido,
}: {
  tipoResultado: PruebaEntrega["tipoResultado"];
  esValido: boolean;
}) {
  if (tipoResultado === "fallido") {
    return <Badge variant="error">No entregado</Badge>;
  }

  if (esValido) {
    return <Badge variant="success">Entregado verificado</Badge>;
  }

  // Entregado pero inválido (geocerca fuera)
  return (
    <Badge variant="warning">
      Entregado — revisar
    </Badge>
  );
}

// =============================================================================
// Sección de geocerca
// =============================================================================

function SeccionGeocerca({
  geocercaResultado,
  distanciaM,
}: {
  geocercaResultado: PruebaEntrega["geocercaResultado"];
  distanciaM: number | null;
}) {
  if (geocercaResultado === "sin_referencia") {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <AlertTriangle className="size-3.5" aria-hidden="true" />
        <span>Sin referencia de ubicación del destino para verificar geocerca.</span>
      </div>
    );
  }

  if (geocercaResultado === "dentro") {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-success-subtle px-3 py-2 text-xs text-success-subtle-foreground">
        <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" />
        <span>
          Ubicación verificada
          {distanciaM !== null ? ` — a ${Math.round(distanciaM)} m del destino` : ""}
        </span>
      </div>
    );
  }

  // fuera
  return (
    <div className="flex items-center gap-2 rounded-lg bg-warning-subtle px-3 py-2 text-xs text-warning-subtle-foreground">
      <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
      <span>
        Fuera del destino — requiere revisión
        {distanciaM !== null ? ` (${Math.round(distanciaM)} m del punto)` : ""}
      </span>
    </div>
  );
}
