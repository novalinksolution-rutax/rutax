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
import type { TonoEstado } from "./tonos-estado";

export type ColorSemaforo = "verde" | "amarillo" | "rojo";

export interface ResultadoSemaforo {
  color: ColorSemaforo;
  /**
   * El tono del sistema, que es lo que consume `SemaforoCumplimiento`.
   *
   * ⚠️ **No siempre coincide con `color`.** «Sin datos» era `amarillo` y ahora
   * es `neutral`: no tener medición no es una advertencia — es el estado normal
   * de un seller que empezó ayer, y pintarlo de ámbar hace que la pantalla se
   * vea como un problema el primer día. Es el mismo criterio que
   * `CORRECCIONES_TONO` aplica en el resto del producto: lo normal no se alarma.
   *
   * `color` se conserva porque cuatro pantallas ya lo consumen y el semáforo de
   * tres luces sigue siendo el lenguaje del SLA; lo que cambia es cómo se pinta.
   */
  tono: TonoEstado;
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
      tono: "neutral",
      etiqueta: "Sin datos",
      variant: "neutral",
      clasesColor: "bg-muted",
    };
  }

  if (pct >= objetivo) {
    return {
      color: "verde",
      tono: "balanced",
      etiqueta: "Cumplido",
      variant: "success",
      clasesColor: "bg-success",
    };
  }

  if (pct >= objetivo - 5) {
    return {
      color: "amarillo",
      tono: "attention",
      etiqueta: "En riesgo",
      variant: "warning",
      clasesColor: "bg-warning",
    };
  }

  return {
    color: "rojo",
    tono: "fault",
    etiqueta: "Incumplido",
    variant: "error",
    clasesColor: "bg-destructive",
  };
}
