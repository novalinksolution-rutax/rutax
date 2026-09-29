/**
 * Proveedores DTE que llevan los folios por su cuenta: con ellos no hay CAF que
 * subir. Vivía en el estado del asistente de puesta en marcha (retirado).
 */
const PROVEEDORES_QUE_GESTIONAN_FOLIOS = new Set(["simplefactura"]);

export function proveedorGestionaFolios(proveedorDte: string | null): boolean {
  if (!proveedorDte) return false;
  return PROVEEDORES_QUE_GESTIONAN_FOLIOS.has(proveedorDte);
}
