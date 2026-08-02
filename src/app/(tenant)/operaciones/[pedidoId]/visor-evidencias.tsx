"use client";

/**
 * VisorEvidencias — Muestra las evidencias INFORMATIVAS de entrega al coordinador.
 *
 * A diferencia de VisorPod (POD autoritativo same-day), estas evidencias NO definen
 * el estado del pedido: son el archivo de evidencia paralelo del courier (aplica a
 * Flex y same-day). Cada foto carga su URL firmada (15 min) al entrar en viewport.
 *
 * El acceso real lo controla obtenerUrlFirmadaEvidencia (RBAC + tenant). Las
 * coordenadas crudas del conductor NO se muestran — solo el resultado de geocerca.
 */

import { useState, useEffect } from "react";
import { CheckCircle2, AlertTriangle, Clock, Loader2, ImageOff } from "lucide-react";
import { actionObtenerUrlEvidenciaCoordinador } from "./actions-evidencias";
import type { EvidenciaEntrega } from "@/modules/operacion/evidencias-entrega";

interface Props {
  evidencias: EvidenciaEntrega[];
}

export function VisorEvidencias({ evidencias }: Props) {
  if (evidencias.length === 0) return null;

  return (
    <section aria-labelledby="evidencias-titulo">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="evidencias-titulo" className="text-base font-semibold">
          Evidencias de entrega
        </h2>
        <span className="text-xs text-muted-foreground">
          {evidencias.length} foto{evidencias.length !== 1 ? "s" : ""}
        </span>
      </div>

      <p className="mb-3 text-xs text-muted-foreground">
        Registro propio del courier. No reemplaza el estado de Mercado Libre Flex.
      </p>

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {evidencias.map((ev) => (
          <li key={ev.id}>
            <TarjetaEvidencia evidencia={ev} />
          </li>
        ))}
      </ul>
    </section>
  );
}

// =============================================================================
// Tarjeta de una evidencia
// =============================================================================

function TarjetaEvidencia({ evidencia }: { evidencia: EvidenciaEntrega }) {
  const [url, setUrl] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    actionObtenerUrlEvidenciaCoordinador(evidencia.id)
      .then((resultado) => {
        if (cancelado) return;
        if (resultado.url) setUrl(resultado.url);
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
  }, [evidencia.id]);

  const horaCaptura = new Date(evidencia.capturadoEn).toLocaleString("es-CL", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Santiago",
  });

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      {/* Foto */}
      <div className="overflow-hidden rounded-lg bg-muted">
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
        {url && !cargando && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt="Evidencia de entrega"
            className="max-h-80 w-full object-contain"
          />
        )}
      </div>

      {/* Hora de captura */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Clock className="size-3.5" aria-hidden="true" />
        <span>Capturada el {horaCaptura}</span>
      </div>

      {/* Resultado de geocerca */}
      <SeccionGeocerca
        geocercaResultado={evidencia.geocercaResultado}
        distanciaM={evidencia.distanciaDestinoM}
      />

      {/* Nota del conductor (si existe) */}
      {evidencia.nota && (
        <p className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {evidencia.nota}
        </p>
      )}
    </div>
  );
}

// =============================================================================
// Sección de geocerca (idéntica en criterio a VisorPod)
// =============================================================================

function SeccionGeocerca({
  geocercaResultado,
  distanciaM,
}: {
  geocercaResultado: EvidenciaEntrega["geocercaResultado"];
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
        Fuera del destino — revisar
        {distanciaM !== null ? ` (${Math.round(distanciaM)} m del punto)` : ""}
      </span>
    </div>
  );
}
