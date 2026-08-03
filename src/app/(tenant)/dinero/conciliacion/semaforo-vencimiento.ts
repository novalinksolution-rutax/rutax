/**
 * Semáforo de vencimiento (SLA) de una excepción de conciliación — columna
 * "Vence" de la bandeja (§1.1 P1). Función PURA, sin I/O: única fuente de
 * verdad reusada por el conteo de chips, el filtro "Vencidas", el orden de
 * la tabla y la celda "Vence" — evita 4 copias de la misma regla.
 *
 * Reglas (fijas por diseño de `ux-ui`):
 *   - Estado terminal → "Cerrada" (neutro, ya no aplica SLA).
 *   - `esperando_info` → "SLA en pausa" (neutro): el reloj se detiene mientras
 *     se espera info de un tercero, no es justo contarlo como atraso propio.
 *   - Sin `fechaLimite` → "Sin fecha límite" (neutro).
 *   - > 2 días para vencer → verde. ≤ 2 días → ámbar. Ya vencida → rojo.
 */

import { esEstadoTerminal } from "@/modules/dinero/conciliacion-clasificacion";
import type { EstadoEventoConciliacion } from "@/modules/dinero/tipos";
import type { BadgeVariante } from "@/lib/ui/traduccion-estados";

import { diferenciaEnDiasCalendario, hoyEnSantiago } from "@/lib/fecha-santiago";

export interface SemaforoVencimiento {
  variant: BadgeVariante;
  etiqueta: string;
}

/** Calcula el semáforo de vencimiento de una excepción dado su `fechaLimite` y `estado` actuales. */
export function semaforoVencimiento(
  fechaLimite: string | null,
  estado: EstadoEventoConciliacion,
): SemaforoVencimiento {
  if (esEstadoTerminal(estado)) return { variant: "neutral", etiqueta: "Cerrada" };
  if (estado === "esperando_info") return { variant: "neutral", etiqueta: "SLA en pausa" };
  if (!fechaLimite) return { variant: "neutral", etiqueta: "Sin fecha límite" };

  // Ojo con el orden: `diferenciaEnDiasCalendario(desde, hasta)` es `hasta − desde`,
  // y aquí queremos positivo cuando la fecha límite aún está en el futuro.
  const dias = diferenciaEnDiasCalendario(hoyEnSantiago(), fechaLimite);
  if (dias < 0) return { variant: "error", etiqueta: "Vencida" };
  if (dias <= 2) return { variant: "warning", etiqueta: dias === 0 ? "Vence hoy" : "Vence pronto" };
  return { variant: "success", etiqueta: "En plazo" };
}

/** Verdadero solo si la excepción está realmente vencida (con SLA activo y fecha límite ya pasada). */
export function esEventoVencido(fechaLimite: string | null, estado: EstadoEventoConciliacion): boolean {
  return semaforoVencimiento(fechaLimite, estado).variant === "error";
}
