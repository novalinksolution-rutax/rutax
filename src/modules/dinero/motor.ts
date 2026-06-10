/**
 * Motor entrega→dinero — función pura de elegibilidad.
 *
 * Implementa la tabla §4.3 del documento de arquitectura (fase-c-dinero.md).
 * Esta función NO hace llamadas a BD, NO tiene side effects, y NO importa
 * ningún cliente de Supabase ni Inngest.
 *
 * Es una función pura: dado el mismo input, siempre devuelve el mismo output.
 * Eso permite testearla exhaustivamente sin mocks ni infraestructura.
 *
 * Los 8 casos de la tabla §4.3 son exactamente los casos de prueba obligatorios
 * en `motor.test.ts`.
 */

import type { EstadoPedido } from '@/modules/operacion/tipos';

// =============================================================================
// Interfaces de entrada y salida
// =============================================================================

export interface EntradaMotor {
  /** Estado del pedido tras la transición (un estado financieramente relevante). */
  estadoPedido: EstadoPedido;
  /**
   * Resultado de la incidencia: ¿afecta el cobro al seller?
   * - null: no hay incidencia (aplica a estados entregado/devuelto/cancelado).
   * - true/false: valor de `incidencias.afecta_cobro`.
   */
  afectaCobro: boolean | null;
  /**
   * Resultado de la incidencia: ¿afecta la liquidación al conductor?
   * - null: no hay incidencia.
   * - true/false: valor de `incidencias.afecta_liquidacion`.
   */
  afectaLiquidacion: boolean | null;
  /**
   * true si el pedido es same_day Y el seller_id del pedido coincide con
   * el `seller_id_gasto_propio` del tenant.
   * En ese caso el courier absobe el costo: no se genera cobro al seller.
   */
  esGastoPropio: boolean;
  /**
   * true si el pedido tiene un conductor asignado (driver_id_asignado != null).
   * La liquidación al conductor solo se genera si hay conductor asignado.
   */
  tieneDriverAsignado: boolean;
}

export interface ResultadoMotor {
  /** true si se debe generar una línea de cobro al seller. */
  generaCobro: boolean;
  /**
   * Ajuste al monto de cobro en CLP.
   * 0 en el MVP (los ajustes manuales son Fase C.2).
   * Siempre entero — usar Math.round() antes de asignar.
   */
  ajusteCobroCLP: number;
  /** true si se debe generar una línea de liquidación al conductor. */
  generaLiquidacion: boolean;
  /**
   * Ajuste al monto de liquidación en CLP.
   * 0 en el MVP.
   */
  ajusteLiquidacionCLP: number;
}

// =============================================================================
// Función pura de elegibilidad
// =============================================================================

/**
 * Evalúa si un pedido en estado financieramente relevante debe generar
 * línea de cobro al seller y/o línea de liquidación al conductor.
 *
 * Tabla §4.3:
 * | Estado pedido              | afecta_cobro | afecta_liq | Genera cobro | Genera liquidación |
 * |---------------------------|--------------|------------|--------------|-------------------|
 * | entregado / entregado_manual | n/a        | n/a        | Sí           | Sí (si hay driver) |
 * | fallido / fallido_manual   | true         | true       | Sí           | Sí                |
 * | fallido / fallido_manual   | true         | false      | Sí           | No                |
 * | fallido / fallido_manual   | false        | true       | No           | Sí                |
 * | fallido / fallido_manual   | false        | false      | No           | No                |
 * | devuelto                   | n/a          | n/a        | No           | No                |
 * | cancelado                  | n/a          | n/a        | No           | No                |
 * | same_day gasto propio      | n/a          | n/a        | No           | Sí (si hay driver) |
 *
 * Para same_day gasto propio: el courier absorbe el costo (no cobra al seller)
 * pero sí liquida al conductor si hay uno asignado.
 */
export function evaluarElegibilidad(entrada: EntradaMotor): ResultadoMotor {
  const { estadoPedido, afectaCobro, afectaLiquidacion, esGastoPropio, tieneDriverAsignado } = entrada;

  // Caso: devuelto o cancelado — nunca genera cobro ni liquidación.
  if (estadoPedido === 'devuelto' || estadoPedido === 'cancelado') {
    return {
      generaCobro: false,
      ajusteCobroCLP: 0,
      generaLiquidacion: false,
      ajusteLiquidacionCLP: 0,
    };
  }

  // Caso: entregado o entregado_manual
  if (estadoPedido === 'entregado' || estadoPedido === 'entregado_manual') {
    // same_day gasto propio: el courier absorbe el costo, pero sí liquida al conductor.
    if (esGastoPropio) {
      return {
        generaCobro: false,
        ajusteCobroCLP: 0,
        generaLiquidacion: tieneDriverAsignado,
        ajusteLiquidacionCLP: 0,
      };
    }
    // Entrega normal: siempre cobra al seller; liquida al conductor si hay uno.
    return {
      generaCobro: true,
      ajusteCobroCLP: 0,
      generaLiquidacion: tieneDriverAsignado,
      ajusteLiquidacionCLP: 0,
    };
  }

  // Caso: fallido o fallido_manual — la incidencia decide.
  if (estadoPedido === 'fallido' || estadoPedido === 'fallido_manual') {
    // same_day gasto propio también puede fallar — no cobra al seller.
    const cobro = esGastoPropio ? false : (afectaCobro === true);
    const liquidacion = afectaLiquidacion === true && tieneDriverAsignado;
    return {
      generaCobro: cobro,
      ajusteCobroCLP: 0,
      generaLiquidacion: liquidacion,
      ajusteLiquidacionCLP: 0,
    };
  }

  // Estado financiero no reconocido — defensivo: no generar nada.
  return {
    generaCobro: false,
    ajusteCobroCLP: 0,
    generaLiquidacion: false,
    ajusteLiquidacionCLP: 0,
  };
}
