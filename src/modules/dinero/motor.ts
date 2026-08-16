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
// Motivo de elegibilidad — explica el "por qué" de cada decisión (hallazgo P0
// de auditoría externa: versionar y congelar las reglas económicas). Función
// hermana de `evaluarElegibilidad`, también pura: NO se le agregan campos a
// `ResultadoMotor` para no romper el contrato mínimo que ya consume el job y
// que un test de `motor.test.ts` fija deliberadamente a 4 campos.
// =============================================================================

/**
 * Catálogo ESTABLE de códigos de motivo. Referenciado como `snapshot_regla.
 * regla.regla_id` en `dinero.lineas_cobro` / `dinero.lineas_liquidacion`
 * (migración 20260707000001). No renombrar códigos existentes: son parte del
 * contrato de snapshots ya escritos (inmutables).
 */
export type MotivoElegibilidadCodigo =
  | 'ENTREGADO_GENERA_COBRO'
  | 'ENTREGADO_GENERA_LIQUIDACION'
  | 'ENTREGADO_SIN_DRIVER_NO_LIQUIDA'
  | 'SAME_DAY_GASTO_PROPIO_SIN_COBRO'
  | 'SAME_DAY_GASTO_PROPIO_GENERA_LIQUIDACION'
  | 'FALLIDO_INCIDENCIA_AFECTA_COBRO'
  | 'FALLIDO_INCIDENCIA_NO_AFECTA_COBRO'
  | 'FALLIDO_INCIDENCIA_AFECTA_LIQUIDACION'
  | 'FALLIDO_INCIDENCIA_AFECTA_LIQUIDACION_SIN_DRIVER'
  | 'FALLIDO_INCIDENCIA_NO_AFECTA_LIQUIDACION'
  | 'FALLIDO_GASTO_PROPIO_SIN_COBRO'
  | 'DEVUELTO_NO_GENERA'
  | 'CANCELADO_NO_GENERA'
  | 'ESTADO_NO_RECONOCIDO_NO_GENERA';

export interface MotivoElegibilidad {
  codigo: MotivoElegibilidadCodigo;
  texto: string;
}

export interface MotivosElegibilidad {
  cobro: MotivoElegibilidad;
  liquidacion: MotivoElegibilidad;
}

/**
 * Explica, con un código enum estable + texto legible, POR QUÉ
 * `evaluarElegibilidad` decidió generar (o no) cobro/liquidación para las
 * mismas 8 ramas de la tabla §4.3 (más las ramas defensivas). Misma entrada
 * (`EntradaMotor`), misma pureza: sin BD, sin side effects.
 *
 * El backend usa el resultado para llenar `snapshot_regla.elegibilidad.
 * motivo_codigo` / `motivo_texto` en el mismo INSERT/UPDATE que genera la
 * línea — así el "por qué" queda congelado junto con el monto.
 */
export function evaluarMotivoElegibilidad(entrada: EntradaMotor): MotivosElegibilidad {
  const { estadoPedido, afectaCobro, afectaLiquidacion, esGastoPropio, tieneDriverAsignado } = entrada;

  // Caso: devuelto — nunca genera cobro ni liquidación.
  if (estadoPedido === 'devuelto') {
    const motivo: MotivoElegibilidad = {
      codigo: 'DEVUELTO_NO_GENERA',
      texto: 'Pedido devuelto: no genera cobro al seller ni liquidación al conductor.',
    };
    return { cobro: motivo, liquidacion: motivo };
  }

  // Caso: cancelado — nunca genera cobro ni liquidación.
  if (estadoPedido === 'cancelado') {
    const motivo: MotivoElegibilidad = {
      codigo: 'CANCELADO_NO_GENERA',
      texto: 'Pedido cancelado: no genera cobro al seller ni liquidación al conductor.',
    };
    return { cobro: motivo, liquidacion: motivo };
  }

  // Caso: entregado o entregado_manual.
  if (estadoPedido === 'entregado' || estadoPedido === 'entregado_manual') {
    const cobro: MotivoElegibilidad = esGastoPropio
      ? {
          codigo: 'SAME_DAY_GASTO_PROPIO_SIN_COBRO',
          texto: 'Entrega same-day marcada como gasto propio del courier: no se cobra al seller.',
        }
      : {
          codigo: 'ENTREGADO_GENERA_COBRO',
          texto: 'Pedido entregado: genera cobro al seller según la tarifa vigente.',
        };

    let liquidacion: MotivoElegibilidad;
    if (!tieneDriverAsignado) {
      liquidacion = {
        codigo: 'ENTREGADO_SIN_DRIVER_NO_LIQUIDA',
        texto: 'Pedido entregado sin conductor asignado: no se genera liquidación.',
      };
    } else if (esGastoPropio) {
      liquidacion = {
        codigo: 'SAME_DAY_GASTO_PROPIO_GENERA_LIQUIDACION',
        texto:
          'Entrega same-day de gasto propio con conductor asignado: se liquida al conductor ' +
          'aunque no se cobre al seller.',
      };
    } else {
      liquidacion = {
        codigo: 'ENTREGADO_GENERA_LIQUIDACION',
        texto: 'Pedido entregado con conductor asignado: genera liquidación al conductor.',
      };
    }

    return { cobro, liquidacion };
  }

  // Caso: fallido o fallido_manual — la incidencia decide (salvo gasto propio).
  if (estadoPedido === 'fallido' || estadoPedido === 'fallido_manual') {
    let cobro: MotivoElegibilidad;
    if (esGastoPropio) {
      cobro = {
        codigo: 'FALLIDO_GASTO_PROPIO_SIN_COBRO',
        texto: 'Entrega fallida de gasto propio: no se cobra al seller aunque la incidencia afecte el cobro.',
      };
    } else if (afectaCobro === true) {
      cobro = {
        codigo: 'FALLIDO_INCIDENCIA_AFECTA_COBRO',
        texto: 'Entrega fallida: la incidencia registrada afecta el cobro al seller.',
      };
    } else {
      cobro = {
        codigo: 'FALLIDO_INCIDENCIA_NO_AFECTA_COBRO',
        texto: 'Entrega fallida: la incidencia registrada no afecta el cobro al seller (o no hay incidencia).',
      };
    }

    let liquidacion: MotivoElegibilidad;
    if (afectaLiquidacion === true && tieneDriverAsignado) {
      liquidacion = {
        codigo: 'FALLIDO_INCIDENCIA_AFECTA_LIQUIDACION',
        texto: 'Entrega fallida: la incidencia registrada afecta la liquidación al conductor.',
      };
    } else if (afectaLiquidacion === true && !tieneDriverAsignado) {
      liquidacion = {
        codigo: 'FALLIDO_INCIDENCIA_AFECTA_LIQUIDACION_SIN_DRIVER',
        texto: 'Entrega fallida sin conductor asignado: no se genera liquidación aunque la incidencia la afecte.',
      };
    } else {
      liquidacion = {
        codigo: 'FALLIDO_INCIDENCIA_NO_AFECTA_LIQUIDACION',
        texto:
          'Entrega fallida: la incidencia registrada no afecta la liquidación al conductor ' +
          '(o no hay incidencia).',
      };
    }

    return { cobro, liquidacion };
  }

  // Estado financiero no reconocido — rama defensiva, análoga a evaluarElegibilidad.
  const motivo: MotivoElegibilidad = {
    codigo: 'ESTADO_NO_RECONOCIDO_NO_GENERA',
    texto: `Estado de pedido no reconocido por el motor financiero ('${estadoPedido}'): rama defensiva, no genera cobro ni liquidación.`,
  };
  return { cobro: motivo, liquidacion: motivo };
}

// =============================================================================
// Snapshot inmutable de la regla económica (hallazgo P0 de auditoría) — función
// pura auxiliar que arma el envelope JSON que se persiste, atómico con el
// INSERT/UPDATE, en `dinero.lineas_cobro.snapshot_regla` /
// `dinero.lineas_liquidacion.snapshot_regla` (migración 20260707000001).
// Sin BD, sin side effects: toda la información llega por parámetro — el
// llamador (job C1) es quien hace las consultas y decide job_run_id/timestamp.
// =============================================================================

/** Datos de la tarifa aplicada, tal como se leyeron de `identidad.tarifas`. */
export interface TarifaSnapshotInput {
  tarifaId: string;
  tipoEntrega: string | null;
  modoCalculo: string | null;
  zona: string | null;
  zonaId: string | null;
  vigenteDesde: string | null;
  vigenteHasta: string | null;
  estado: string | null;
  minimoRetiroClp: number | null;
  minimoFacturacionClp: number | null;
  recargoReprogramacionClp: number | null;
}

/** Datos de la incidencia asociada (si la hay), tal como se leyó de `operacion.incidencias`. */
export interface IncidenciaSnapshotInput {
  id: string;
  tipo: string | null;
  afectaCobro: boolean | null;
  afectaLiquidacion: boolean | null;
}

export interface ConstruirSnapshotReglaInput {
  /** Lado de la línea: determina si se incluyen mínimos/recargo de reprogramación. */
  lado: 'cobro' | 'liquidacion';
  /** `runId` del step de Inngest que generó la línea. */
  jobRunId: string;
  /** ISO timestamp de generación del snapshot (normalmente `new Date().toISOString()`). */
  generadoEn: string;
  /** Tarifa aplicada — `null` si el pedido no tenía `tarifaAplicableId`. */
  tarifa: TarifaSnapshotInput | null;
  /** Monto base del lado (monto_clp para cobro, monto_conductor_clp para liquidación). */
  valorBaseClp: number;
  /** Ajuste por incidencia del lado (ajusteCobroCLP / ajusteLiquidacionCLP). */
  ajusteIncidenciaClp: number;
  /** Comuna del destinatario del pedido — contexto geográfico, no determina el precio. */
  comunaDestinatario: string | null;
  fechaTransicion: string;
  fechaHechoLocal: string;
  estadoNuevo: string;
  estadoAnterior: string;
  tipoPedido: string;
  esGastoPropio: boolean;
  incidencia: IncidenciaSnapshotInput | null;
  motivo: MotivoElegibilidad;
  /** true en todos los casos actuales: solo se construye snapshot cuando SÍ se escribe la línea. */
  genera: boolean;
}

/**
 * Arma el envelope `snapshot_regla` (forma decidida por `arquitecto`, no
 * rediseñar). Debe escribirse en el MISMO INSERT/UPDATE que determina
 * `monto_base_clp` / `ajuste_incidencia_clp` — la atomicidad la garantiza el
 * llamador (job C1), no esta función.
 */
export function construirSnapshotRegla(input: ConstruirSnapshotReglaInput): Record<string, unknown> {
  const { lado, tarifa } = input;

  const recargosDescuentos =
    lado === 'cobro'
      ? {
          recargo_reprogramacion_pactado_clp: tarifa?.recargoReprogramacionClp ?? null,
          // motor.ts nunca aplica este recargo hoy — fiel al comportamiento real, no inventar.
          recargo_reprogramacion_aplicado_clp: 0,
          minimo_retiro_clp: tarifa?.minimoRetiroClp ?? null,
          minimo_facturacion_clp: tarifa?.minimoFacturacionClp ?? null,
          ajuste_incidencia_clp: input.ajusteIncidenciaClp,
        }
      : {
          ajuste_incidencia_clp: input.ajusteIncidenciaClp,
        };

  return {
    version: 1,
    origen_snapshot: 'generacion_original',
    generado_en: input.generadoEn,
    job_run_id: input.jobRunId,
    regla: {
      motor_version: 'motor-1',
      regla_id: input.motivo.codigo,
      referencia: 'fase-c-dinero.md §4.3',
    },
    tarifa: {
      tarifa_id: tarifa?.tarifaId ?? null,
      tipo_entrega: tarifa?.tipoEntrega ?? null,
      modo_calculo: tarifa?.modoCalculo ?? null,
      valor_base_clp: input.valorBaseClp,
      vigente_desde: tarifa?.vigenteDesde ?? null,
      vigente_hasta: tarifa?.vigenteHasta ?? null,
      estado: tarifa?.estado ?? null,
    },
    recargos_descuentos: recargosDescuentos,
    zona: {
      fuente: 'tarifa',
      zona_id: tarifa?.zonaId ?? null,
      zona_texto: tarifa?.zona ?? null,
      comuna_destinatario: input.comunaDestinatario,
    },
    fecha_efectiva: {
      fecha_transicion: input.fechaTransicion,
      fecha_hecho_local: input.fechaHechoLocal,
    },
    estado_pedido: {
      estado_nuevo: input.estadoNuevo,
      estado_anterior: input.estadoAnterior,
      tipo_pedido: input.tipoPedido,
      es_gasto_propio: input.esGastoPropio,
    },
    incidencia: {
      incidencia_id: input.incidencia?.id ?? null,
      tipo: input.incidencia?.tipo ?? null,
      afecta_cobro: input.incidencia?.afectaCobro ?? null,
      afecta_liquidacion: input.incidencia?.afectaLiquidacion ?? null,
    },
    elegibilidad: {
      genera: input.genera,
      ajuste_clp: input.ajusteIncidenciaClp,
      motivo_codigo: input.motivo.codigo,
      motivo_texto: input.motivo.texto,
    },
  };
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
