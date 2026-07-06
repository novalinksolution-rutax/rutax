/**
 * Helper de semáforo SLA — fuente ÚNICA de color/etiqueta para el % de cumplimiento.
 *
 * Se usa en:
 *   - Dashboard del courier (widget SLA por seller — Tarea 3).
 *   - Portal del seller (semáforo del seller — Tarea 5).
 *
 * Reglas de color (F7, ítem 1.2):
 *   - verde   : pct >= objetivo
 *   - amarillo: objetivo-5 <= pct < objetivo
 *   - rojo    : pct < objetivo-5
 *
 * El color NUNCA es el único portador de significado: `etiqueta` siempre acompaña
 * al indicador visual (accesibilidad — criterio AA del sistema de diseño).
 */

import type { BadgeVariante } from "./traduccion-estados";

export type ColorSemaforo = "verde" | "amarillo" | "rojo";

export interface ResultadoSemaforo {
  color: ColorSemaforo;
  /** Texto corto legible por humanos: "Cumplido", "En riesgo" o "Incumplido". */
  etiqueta: string;
  /** Variante del componente <Badge> de shadcn/ui. */
  variant: BadgeVariante;
  /** Clases Tailwind para el indicador de color (punto / borde / fondo). */
  clasesColor: string;
}

/**
 * Calcula el semáforo de SLA dado el porcentaje actual y el objetivo pactado.
 *
 * @param pct      Porcentaje actual (0–100). Puede ser null si no hay datos evaluados.
 * @param objetivo Porcentaje objetivo configurado (0–100, default 97).
 */
export function semaforoSla(
  pct: number | null,
  objetivo: number,
): ResultadoSemaforo {
  if (pct === null) {
    return {
      color: "amarillo",
      etiqueta: "Sin datos",
      variant: "neutral",
      clasesColor: "bg-muted",
    };
  }

  if (pct >= objetivo) {
    return {
      color: "verde",
      etiqueta: "Cumplido",
      variant: "success",
      clasesColor: "bg-success",
    };
  }

  if (pct >= objetivo - 5) {
    return {
      color: "amarillo",
      etiqueta: "En riesgo",
      variant: "warning",
      clasesColor: "bg-warning",
    };
  }

  return {
    color: "rojo",
    etiqueta: "Incumplido",
    variant: "error",
    clasesColor: "bg-destructive",
  };
}
