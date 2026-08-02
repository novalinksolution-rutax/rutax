/**
 * Tipos de presentación (solo UI) de la bandeja de excepciones de
 * conciliación — sin lógica, para que Server y Client Components de esta
 * pantalla compartan la misma forma sin duplicarla.
 */

import type { EventoConciliacion } from "@/modules/dinero/tipos";

/** `EventoConciliacion` con el nombre del seller ya resuelto (evita un join en cada fila). */
export interface EventoConciliacionUI extends EventoConciliacion {
  sellerNombre: string | null;
}
