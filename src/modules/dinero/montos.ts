/**
 * Cálculo de montos con IVA para el lado COBRO (factura al seller).
 * =============================================================================
 *
 * Convención del proyecto (decisión A2): las tarifas se ingresan en montos
 * NETOS (sin IVA), como es habitual cotizar en Chile. El neto es la fuente de
 * verdad: la línea de cobro guarda el neto y el IVA se calcula UNA sola vez
 * sobre la suma de netos del período, no por línea.
 *
 * El IVA general en Chile es 19% (Ley 825 — reconfirmar antes de producción).
 *
 * Esta función es PURA y la comparten:
 *  - el cierre del período (C2 / cerrarPeriodoManualmente), que persiste el
 *    BRUTO en `periodos_cobro.monto_total_clp` (lo que el seller paga y contra
 *    lo que concilia la cobranza), y
 *  - la emisión del DTE (C3), que factura neto + IVA + total.
 * Usar la MISMA función en ambos lados garantiza que el total del período y el
 * total del DTE coincidan exactamente, sin deriva de redondeo de ±1 CLP.
 */

/** Tasa general de IVA en Chile (19%). */
export const TASA_IVA = 0.19;

export interface MontosConIva {
  /** Neto (entero CLP). */
  netoClp: number;
  /** IVA = round(neto × 0,19), entero CLP. */
  ivaClp: number;
  /** Total bruto = neto + IVA, entero CLP. */
  totalClp: number;
}

/**
 * A partir de un monto NETO (entero CLP), calcula IVA (redondeado a entero) y
 * el total bruto. El neto se redondea por robustez ante entradas no enteras.
 */
export function montosDesdeNeto(netoClp: number): MontosConIva {
  const neto = Math.round(netoClp);
  const iva = Math.round(neto * TASA_IVA);
  return { netoClp: neto, ivaClp: iva, totalClp: neto + iva };
}
