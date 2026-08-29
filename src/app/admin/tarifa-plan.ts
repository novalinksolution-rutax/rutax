/**
 * Cómo se lee una tarifa de plan en el backstage.
 * =============================================================================
 *
 * Desde el 2026-08-28 Rutax cobra una **comisión por pedido efectivo** con un
 * piso mensual, y no una cuota plana. La cifra que describe a un plan dejó de
 * ser un número y pasó a ser dos («$40 por pedido · mínimo $20.000»), así que
 * escribirla a mano en cada pantalla garantizaba que Planes y Suscripciones
 * terminaran diciendo cosas distintas del mismo plan.
 *
 * ⚠️ Los planes de cuota plana NO se borraron, se desactivaron: las boletas ya
 * cobradas con ellos apuntan a esas filas y una suscripción histórica sigue
 * refiriéndolos. Por eso acá hay una rama para `precioPorPedidoClp === null`
 * que dice «cuota $49.000» en vez de un guion: un guion diría que ese plan no
 * cobraba nada, que es lo único que seguro no pasó.
 */

import { formatearCLP } from '@/lib/ui/formato-moneda';
import type { Plan } from '@/modules/plataforma/tipos';

/** Lo que cobra el plan, en una línea. Para la ficha del teléfono. */
export function textoTarifaPlan(plan: Plan): string {
  if (plan.precioPorPedidoClp === null) {
    return `cuota ${formatearCLP(plan.precioMensualClp)}`;
  }
  const porPedido = `${formatearCLP(plan.precioPorPedidoClp)} por pedido`;
  return plan.minimoMensualClp === null || plan.minimoMensualClp === 0
    ? `${porPedido} · sin mínimo`
    : `${porPedido} · mínimo ${formatearCLP(plan.minimoMensualClp)}`;
}
