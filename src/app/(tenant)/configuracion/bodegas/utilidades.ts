/**
 * Helpers puros para la pantalla de Bodegas.
 *
 * Viven en un archivo aparte (no en `actions.ts`) porque un archivo con
 * `"use server"` solo puede exportar funciones async — estas son síncronas
 * a propósito, se calculan del lado del cliente sobre la lista ya cargada.
 */

import type { BodegaFila } from "./actions";

/**
 * La bodega principal DISTINTA de `excluirId` — lo que necesitan el botón
 * "Marcar como principal" de una tarjeta y el diálogo de edición para avisar
 * "esto reemplazará a X". Nunca devuelve la propia bodega: si `excluirId` YA
 * es la principal, no hay "otra" de la que advertir.
 */
export function principalDistintaDe(
  bodegas: BodegaFila[],
  excluirId?: string,
): { id: string; nombre: string } | null {
  const principal = bodegas.find((b) => b.esPrincipal);
  if (!principal || principal.id === excluirId) return null;
  return { id: principal.id, nombre: principal.nombre };
}

/** Otras bodegas ACTIVAS (excluyendo `excluirId`) — opciones de reemplazo al desactivar una principal. */
export function alternativasActivas(
  bodegas: BodegaFila[],
  excluirId: string,
): { id: string; nombre: string }[] {
  return bodegas
    .filter((b) => b.activa && b.id !== excluirId)
    .map((b) => ({ id: b.id, nombre: b.nombre }));
}
