/**
 * Catálogo de tipos de documento DTE (Pantalla F, §1.2) — datos y helpers
 * estáticos, sin acceso a datos ni efectos.
 *
 * Vive en un módulo aparte de `actions.ts` por la misma razón que
 * `onboarding/dte/catalogo.ts`: un módulo `"use server"` solo puede exportar
 * Server Actions async — Next.js rechaza constantes/funciones síncronas
 * exportadas junto a ellas ("Server Actions must be async functions").
 * Compartido entre el servidor (`actions.ts`) y el cliente (`panel-folios-caf.tsx`).
 *
 * Lista corta y cerrada para el MVP (§1.2: "tipo de documento (33 = factura,
 * 61 = nota de crédito...)").
 */

export const TIPOS_DOCUMENTO_DTE: Array<{ codigo: number; etiqueta: string }> = [
  { codigo: 33, etiqueta: "33 — Factura electrónica" },
  { codigo: 34, etiqueta: "34 — Factura no afecta o exenta electrónica" },
  { codigo: 56, etiqueta: "56 — Nota de débito electrónica" },
  { codigo: 61, etiqueta: "61 — Nota de crédito electrónica" },
];

export function etiquetaTipoDocumento(codigo: number): string {
  return TIPOS_DOCUMENTO_DTE.find((t) => t.codigo === codigo)?.etiqueta ?? `Tipo ${codigo}`;
}
