/**
 * Decisión pura de re-atribución de una línea de liquidación al conductor
 * correcto — job C1 (`jobs/generar-lineas.ts`, paso `generar-linea-liquidacion`).
 *
 * Contexto (bug real, 2026-08-12 — "Pedro entrega, Juan cobra"):
 * Cuando el INSERT de una línea de liquidación choca con el UNIQUE(pedido_id)
 * —porque ya existe una línea generada por una transición ANTERIOR del mismo
 * pedido (típicamente: fallido con incidencia que afecta_liquidacion, a nombre
 * del conductor que hizo el intento)— el job debe decidir si esa línea
 * existente sigue siendo correcta para el conductor del evento actual.
 *
 * Si el pedido se reasignó entretanto (fallido → asignado a otro conductor →
 * entregado), la línea existente sigue atribuida al conductor ANTERIOR aunque
 * quien entregó fue OTRO. Esta función decide qué puede hacer el job:
 *
 * - `sin_cambio`  : el conductor no cambió — no hay nada que re-atribuir.
 * - `reatribuir`  : el conductor cambió Y la liquidación de origen de la línea
 *                   sigue en `borrador` (o la línea aún no tiene liquidación
 *                   asignada) — mutable, se puede corregir `driver_id`.
 * - `excepcion`   : el conductor cambió PERO la liquidación de origen ya está
 *                   `emitida`/`pagada` — inmutable. La compuerta humana manda:
 *                   NO se muta nada: la línea queda excepción para resolución
 *                   manual (bono/penalización vía `ajustarLiquidacion`, F16).
 *
 * Misma doctrina que la anulación pre-cierre del propio job (`fallido →
 * devuelto`): solo se muta lo que sigue en estado mutable (`abierto` para
 * períodos de cobro, `borrador` para liquidaciones).
 *
 * Función PURA: sin I/O, sin cliente Supabase — el job (`generar-lineas.ts`)
 * hace las lecturas de BD y llama a esta función con los datos ya resueltos.
 */

export type EstadoLiquidacionConductor = 'borrador' | 'emitida' | 'pagada';

export interface EntradaDecisionReatribucion {
  /** `driver_id` de la línea de liquidación YA existente (conflicto de INSERT). */
  driverIdLineaExistente: string;
  /** `driverIdAsignado` del evento actual (quien realmente completó esta transición). */
  driverIdEvento: string;
  /** `liquidacion_id` de la línea existente — null si aún no se asignó a ninguna. */
  liquidacionIdExistente: string | null;
  /**
   * Estado de la liquidación referenciada por `liquidacionIdExistente`.
   * Debe ser `null` cuando `liquidacionIdExistente` es `null` (no aplica).
   */
  estadoLiquidacionExistente: EstadoLiquidacionConductor | null;
}

export type DecisionReatribucionLiquidacion = 'sin_cambio' | 'reatribuir' | 'excepcion';

/**
 * Decide qué hacer con una línea de liquidación existente cuyo `driver_id`
 * puede no coincidir con el conductor del evento actual. Ver doc del módulo.
 */
export function decidirReatribucionLiquidacion(
  entrada: EntradaDecisionReatribucion,
): DecisionReatribucionLiquidacion {
  const {
    driverIdLineaExistente,
    driverIdEvento,
    liquidacionIdExistente,
    estadoLiquidacionExistente,
  } = entrada;

  if (driverIdLineaExistente === driverIdEvento) {
    return 'sin_cambio';
  }

  // Sin liquidación asignada aún → tan mutable como un borrador.
  const puedeReatribuir = !liquidacionIdExistente || estadoLiquidacionExistente === 'borrador';
  return puedeReatribuir ? 'reatribuir' : 'excepcion';
}
