/**
 * Cálculo del monto líquido de un payout a conductor — función PURA.
 * =============================================================================
 *
 * Extraída del step `calcular-monto-liquido` de `jobs/ejecutarPayout` (F19)
 * para que el preflight (P0 de la auditoría, `dinero/preflight.ts`) use
 * EXACTAMENTE la misma fórmula al previsualizar el pago. Compartir esta
 * función — en vez de duplicar la aritmética en dos archivos — es lo que
 * garantiza que el preflight y el job NUNCA diverjan: si mañana cambia la
 * regla de retención, se cambia en un solo lugar y ambos quedan sincronizados.
 *
 * Regla de negocio (sin cambios respecto al job original):
 * - Base de pago = monto_total_clp + bono_clp − penalizacion_clp (F16).
 * - Retención solo aplica a conductores `independiente` (boleta de terceros);
 *   `dependiente` se paga íntegro aquí (su descuento es por nómina, fuera del
 *   motor entrega→dinero).
 * - Todos los montos son enteros CLP — `Math.round` en el resultado final.
 */

export type TipoRelacionConductor = 'dependiente' | 'independiente';

export interface EntradaCalculoPayout {
  /** Suma de líneas de liquidación (monto_total_clp de la liquidación). */
  montoTotalClp: number;
  /** F16: bono manual — CLP entero ≥ 0. */
  bonoClp: number;
  /** F16: penalización manual — CLP entero ≥ 0. */
  penalizacionClp: number;
  tipoRelacion: TipoRelacionConductor;
  /** % de retención configurado por el courier (0-100). Solo aplica si `tipoRelacion === 'independiente'`. */
  porcentajeRetencion: number;
}

export interface ResultadoCalculoPayout {
  /** Bruto = monto_total_clp + bono − penalización (antes de retención). */
  montoBrutoClp: number;
  /** Retención aplicada (0 si el conductor es `dependiente`). */
  montoRetencionClp: number;
  /** Líquido a transferir = bruto − retención. */
  montoLiquidoClp: number;
}

/**
 * Calcula el monto bruto/retención/líquido de un payout — misma fórmula que
 * consume `jobEjecutarPayout` (Step 3) y `preflightEmitirPago`. NO valida
 * mínimos ni positividad: esa decisión (bloquear vs. advertir) es distinta
 * en el job (lanza `NonRetriableError`) y en el preflight (agrega un
 * `ItemPreflight` de categoría `bloquea`) — cada llamador decide qué hacer
 * con el resultado.
 */
export function calcularMontoPayout(entrada: EntradaCalculoPayout): ResultadoCalculoPayout {
  const montoBrutoClp =
    Math.round(entrada.montoTotalClp) + Math.round(entrada.bonoClp) - Math.round(entrada.penalizacionClp);

  const porcentajeEfectivo = entrada.tipoRelacion === 'independiente' ? entrada.porcentajeRetencion : 0;
  const montoLiquidoClp = Math.round(montoBrutoClp * (1 - porcentajeEfectivo / 100));
  const montoRetencionClp = montoBrutoClp - montoLiquidoClp;

  return { montoBrutoClp, montoRetencionClp, montoLiquidoClp };
}
