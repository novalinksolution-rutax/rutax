/**
 * Tipos de eventos cross-módulo de Inngest.
 *
 * Estos tipos son los contratos entre módulos del sistema:
 * - `EventoPedidoEstadoFinanciero`: publicado por `operacion/pedidos.ts`,
 *   consumido por `dinero/jobs/generar-lineas.ts` (job C1).
 * - `EventoPeriodoCerrado`: publicado por `dinero/jobs/cerrar-periodo.ts` (C2)
 *   y por la acción `cerrarPeriodoManualmente`, consumido por C3 y C6 en paralelo.
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
 * Consumido en paralelo por C3 (emitirDtePeriodo) y C6 (conciliarPeriodo).
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
