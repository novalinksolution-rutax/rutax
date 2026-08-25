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


/**
 * Tope de excepciones por llamada en lote. Una selección mayor se manda en
 * tandas desde el cliente.
 *
 * ⚠️ Vive acá y NO en `actions.ts` porque ese archivo es `"use server"`, donde
 * **solo se pueden exportar funciones async**. Un `export const` ahí compila
 * en el typecheck y revienta al abrir la pantalla: es una regla de Next, no de
 * TypeScript.
 */
export const TOPE_LOTE = 200;
