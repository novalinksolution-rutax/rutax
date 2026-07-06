"use client";

/**
 * Widget semáforo SLA por seller (F7, ítem 1.2 — Tarea 3).
 *
 * Client Component: recibe los datos del server component y refresca el
 * countdown en vivo cada 60 segundos recalculando desde `horaCorte` en cliente
 * (no llama de nuevo al servidor — los minutos restantes se recalculan en local).
 *
 * El % de SLA viene de `obtenerSlaPorSeller` (ventana 'semana' por defecto);
 * el countdown viene de `obtenerResumenCortePorSeller`.
 */

import { useEffect, useState } from "react";
import { Clock, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { semaforoSla } from "@/lib/ui/semaforo-sla";
import type { SlaPorSeller, ResumenCorteSeller } from "@/modules/operacion/metricas";

// =============================================================================
// Helpers locales
// =============================================================================

/** Convierte 'HH:MM' a minutos desde medianoche. */
function horaAMinutos(hora: string): number {
  const [hh, mm] = hora.split(":").map(Number);
  return hh * 60 + (mm ?? 0);
}

/** Minutos restantes hasta `horaCorte` ('HH:MM') desde ahora, en TZ local del browser. */
function minutosRestantesDesdeHoraCorte(horaCorte: string): number {
  const ahora = new Date();
  const minutosAhora = ahora.getHours() * 60 + ahora.getMinutes();
  return horaAMinutos(horaCorte) - minutosAhora;
}

function formatearCountdown(minutos: number): string {
  if (minutos <= 0) return "Corte pasado";
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (h > 0) return `${h}h ${m}min`;
  return `${m} min`;
}

// =============================================================================
// Widget SLA por seller
// =============================================================================

export function WidgetSlaPorSeller({ datos }: { datos: SlaPorSeller[] }) {
  if (datos.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No hay pedidos evaluados esta semana para calcular el SLA.
      </p>
    );
  }

  return (
    <ul className="space-y-3" aria-label="SLA por seller esta semana">
      {datos.map((seller) => {
        const semaforo = semaforoSla(seller.slaPct, seller.objetivoPct);
        const pctMostrado =
          seller.slaPct !== null ? `${Math.round(seller.slaPct)}%` : "—";

        return (
          <li
            key={seller.sellerId}
            className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card px-4 py-3 shadow-xs"
          >
            <div className="flex items-center gap-3 min-w-0">
              {/* Indicador de color semáforo (no es el único portador de significado) */}
              <span
                className={`size-3 shrink-0 rounded-full ${semaforo.clasesColor}`}
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {seller.sellerNombre}
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {seller.aTiempo} de {seller.totalTerminales} a tiempo
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <span className="text-lg font-bold tabular-nums text-foreground">
                {pctMostrado}
              </span>
              <Badge variant={semaforo.variant}>{semaforo.etiqueta}</Badge>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// =============================================================================
// Tira de cortes próximos (con countdown en vivo)
// =============================================================================

interface ItemCorte extends ResumenCorteSeller {
  /** horaCorte puede ser null si el seller no tiene ventana. */
  horaCorte: string | null;
}

export function TiraCortesSeller({ datos }: { datos: ItemCorte[] }) {
  // minutosRestantes recalculado en cliente cada 60s desde horaCorte.
  const [ahora, setAhora] = useState(() => new Date());

  useEffect(() => {
    const intervalo = setInterval(() => setAhora(new Date()), 60_000);
    return () => clearInterval(intervalo);
  }, []);

  const conCorte = datos.filter(
    (d) => d.horaCorte !== null && d.pedidosPendientesHoy > 0,
  );

  if (conCorte.length === 0) return null;

  return (
    <ul className="space-y-2" aria-label="Cortes próximos por seller">
      {conCorte.map((seller) => {
        const minutosLocal =
          seller.horaCorte !== null
            ? minutosRestantesDesdeHoraCorte(seller.horaCorte)
            : null;

        // Usar ahora solo para forzar re-render; el cálculo depende de horaCorte.
        void ahora;

        const urgente = minutosLocal !== null && minutosLocal <= 30 && minutosLocal > 0;
        const pasado = minutosLocal !== null && minutosLocal <= 0;

        return (
          <li
            key={seller.sellerId}
            className={`flex items-center justify-between gap-4 rounded-lg border px-4 py-3 text-sm ${
              pasado
                ? "border-muted bg-muted/40 text-muted-foreground"
                : urgente
                  ? "border-warning-subtle bg-warning-subtle text-warning-subtle-foreground"
                  : "border-border bg-card"
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Clock
                className={`size-4 shrink-0 ${
                  pasado
                    ? "text-muted-foreground"
                    : urgente
                      ? "text-warning"
                      : "text-muted-foreground"
                }`}
                aria-hidden="true"
              />
              <span className="truncate font-medium">{seller.sellerNombre}</span>
              {seller.pedidosPendientesHoy > 0 && (
                <Badge variant="neutral" className="tabular-nums">
                  {seller.pedidosPendientesHoy} pendiente
                  {seller.pedidosPendientesHoy !== 1 ? "s" : ""}
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0 tabular-nums">
              <TrendingUp className="size-3.5 text-muted-foreground" aria-hidden="true" />
              <span className={urgente ? "font-bold text-warning" : ""}>
                {seller.horaCorte} ·{" "}
                {minutosLocal !== null
                  ? formatearCountdown(minutosLocal)
                  : "—"}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
