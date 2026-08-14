/**
 * Superficie pública del motor de ruteo (etapa 7 de "retiro en bodega + ruteo").
 * =====================================================================
 * `calcularRuta` es el único punto de entrada que debe usar un llamador
 * (una futura Server Action de Preparación/asignación). Los pasos internos
 * del solver (`vecino-cercano.ts`, `dos-opt.ts`, `or-opt.ts`, `costo.ts`) son
 * detalle de implementación: se importan directo desde sus archivos SOLO en
 * pruebas, nunca desde fuera de este módulo.
 */

export { calcularRuta, TOPE_RONDAS } from './motor';
export type { ParadaARutear, EntradaRuteo, ParadaSinUbicar, RutaCalculada } from './tipos';
