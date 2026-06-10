/**
 * Tipos de eventos cross-módulo de Inngest.
 *
 * Estos tipos son los contratos entre módulos del sistema:
 * - `EventoPedidoEstadoFinanciero`: publicado por `operacion/pedidos.ts`,
 *   consumido por `dinero/jobs/generar-lineas.ts` (job C1).
 * - `EventoPeriodoCerrado`: publicado por `dinero/jobs/cerrar-periodo.ts` (C2)
 *   y por la acción `cerrarPeriodoManualmente`, consumido SOLO por C6
 *   (conciliación). El cierre NO emite el DTE — eso exige una acción humana.
 * - `EventoEmisionSolicitada`: publicado SOLO por la acción humana
 *   `emitirFacturaPeriodo` (gate `puedeEmitirFacturas`), consumido por C3
 *   (emitirDtePeriodo). Es la compuerta de aprobación de facturación: ningún
 *   proceso automático (cron) puede emitir un DTE sin que una persona lo
 *   solicite explícitamente.
 *
 * Regla de importación: solo tipos — ningún lado importa lógica del otro.
 * El publisher solo necesita el `name` + `data`; el consumer idem.
 */

/**
 * Publicado por `operacion/pedidos.ts` (actualizarEstadoPedido) post-commit.
 * Consumido por `dinero/jobs/generar-lineas.ts` (job C1).
 *
 * Se publica SOLO para estados financieramente relevantes:
 * 'entregado' | 'entregado_manual' | 'fallido' | 'fallido_manual' | 'devuelto' | 'cancelado'
 */
export interface EventoPedidoEstadoFinanciero {
  name: 'dinero/pedido.estado_financiero_relevante';
  data: {
    pedidoId: string;
    tenantId: string;
    sellerId: string;
    driverIdAsignado: string | null;
    estadoNuevo: 'entregado' | 'entregado_manual' | 'fallido' | 'fallido_manual' | 'devuelto' | 'cancelado';
    estadoAnterior: string;
    /** ISO timestamptz zona America/Santiago */
    fechaTransicion: string;
    tipoPedido: 'flex' | 'same_day';
    tarifaAplicableId: string | null;
  };
}

/**
 * Publicado por `dinero/jobs/cerrar-periodo.ts` (job C2) y por
 * `dinero/acciones.ts` (cerrarPeriodoManualmente).
 * Consumido SOLO por C6 (conciliarPeriodo) — un chequeo detective, de solo
 * lectura, que es seguro correr automáticamente al cerrar. La emisión del DTE
 * (C3) NO cuelga de este evento: requiere `dinero/periodo.emision-solicitada`.
 */
export interface EventoPeriodoCerrado {
  name: 'dinero/periodo.cerrado';
  data: {
    periodoCobroidId: string;
    tenantId: string;
    sellerId: string;
    fechaInicio: string;
    fechaFin: string;
    montoTotalClp: number;
  };
}

/**
 * Compuerta de aprobación de facturación (B1-1).
 *
 * Publicado EXCLUSIVAMENTE por la acción humana `emitirFacturaPeriodo`
 * (`dinero/acciones.ts`), gateada por la capacidad `puedeEmitirFacturas`.
 * Consumido por C3 (emitirDtePeriodo).
 *
 * Razón de ser: un DTE es un documento tributario irreversible ante el SII
 * (revertirlo exige nota de crédito, RF-038, fuera del MVP). Por eso la
 * emisión nunca la dispara el cron de cierre — solo una persona con permiso
 * de facturación, tras revisar el período `cerrado`.
 */
export interface EventoEmisionSolicitada {
  name: 'dinero/periodo.emision-solicitada';
  data: {
    periodoCobroidId: string;
    tenantId: string;
    sellerId: string;
    fechaInicio: string;
    fechaFin: string;
    montoTotalClp: number;
    /** UUID de auth del usuario que solicitó la emisión (trazabilidad). */
    solicitadoPorUsuarioId: string;
    /** 'sandbox' (stub, sin SII real) | 'real' (emisión real al SII). */
    modo: 'sandbox' | 'real';
  };
}
