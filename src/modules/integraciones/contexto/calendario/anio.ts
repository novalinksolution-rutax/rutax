/**
 * Año en curso según el calendario de SANTIAGO.
 * =====================================================================
 *
 * Existe como archivo propio porque es exactamente el punto donde el bug de
 * zona horaria del proyecto mordería aquí: el 31 de diciembre a las 21:00 de
 * Santiago ya es 1 de enero en UTC, así que `new Date().getUTCFullYear()`
 * pediría el calendario de feriados del año siguiente y el courier se quedaría
 * sin los feriados de la semana en curso. Una línea, pero la línea correcta.
 */

import { ahoraEnSantiago } from '@/lib/fecha-santiago';

/** Año calendario vigente en Santiago (no en UTC). */
export function anioActualEnSantiago(): number {
  return Number(ahoraEnSantiago().fecha.slice(0, 4));
}
