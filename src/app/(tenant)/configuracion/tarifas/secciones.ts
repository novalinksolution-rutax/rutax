/**
 * Las tres secciones del módulo de tarifas — la parte PURA.
 * =============================================================================
 *
 * ⚠️ **Este archivo NO lleva `"use client"`, y esa es toda su razón de ser.**
 *
 * El catálogo y el saneador vivían dentro de `barra-secciones.tsx`, que sí es de
 * cliente. `page.tsx` es un Server Component y llamaba `sanearSeccionTarifas()`
 * desde ahí: **500 en las cinco rutas del módulo**, con
 * «Attempted to call sanearSeccionTarifas() from the server but
 * sanearSeccionTarifas is on the client».
 *
 * Lo que hace peligroso el error es que **`npm run typecheck` y `npm run lint`
 * lo aprueban los dos**: la frontera servidor/cliente no está en el sistema de
 * tipos. Solo aparece al abrir la pantalla — es el mismo hueco por el que se
 * cuela pasar un componente como prop desde un layout de servidor.
 *
 * La regla, escrita: **un módulo de cliente exporta componentes; lo que también
 * se llama desde el servidor va en un archivo sin directiva.**
 */

export const SECCIONES_TARIFAS = [
  { clave: "tarifas", etiqueta: "Tarifas" },
  { clave: "zonas", etiqueta: "Zonas" },
  { clave: "retiro", etiqueta: "Retiro" },
] as const;

export type SeccionTarifas = (typeof SECCIONES_TARIFAS)[number]["clave"];

/** Sanea `?seccion=`: cualquier cosa que no sea una de las tres cae en tarifas. */
export function sanearSeccionTarifas(valor: string | undefined | null): SeccionTarifas {
  return SECCIONES_TARIFAS.some((s) => s.clave === valor) ? (valor as SeccionTarifas) : "tarifas";
}
