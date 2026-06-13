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
 * - `EventoPagoRecibido`: publicado por el endpoint de webhook de Fintoc
 *   (`api/webhooks/fintoc`) tras validar la firma y registrar en bitácora,
 *   consumido por el job de matching (`dinero/jobs/conciliar-pago.ts`). La capa
 *   "pagado" del motor entrega→dinero (cobranza courier→seller).
 * - `EventoPagoConciliado`: publicado por el job de matching al imputar un pago
 *   contra un período `facturado`, consumido por la proyección de `estado_cobro`
 *   (en el MVP, la escribe el mismo job de matching antes de emitir el evento;
 *   el evento queda como punto de extensión para notificaciones al seller).
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

/**
 * Capa "pagado" del motor entrega→dinero — cobranza courier→seller (Fintoc).
 *
 * Publicado por el endpoint de webhook `api/webhooks/fintoc/route.ts` DESPUÉS de:
 *   1. validar la firma `Fintoc-Signature` (obligatoria — Fintoc SÍ firma), y
 *   2. registrar la recepción del pago en `bitacora_auditoria` (bitácora ANTES
 *      del efecto, patrón del proyecto).
 * Consumido por el job de matching `dinero/jobs/conciliar-pago.ts` (idempotente).
 *
 * El payload NO incluye secretos: ni el `link_token` ni el secreto de webhook
 * viajan aquí. `linkTokenRef` es la referencia OPACA (uuid) al secreto cifrado
 * en `identidad.secretos_cifrados` — nunca el valor — para trazar de qué cuenta
 * conectada vino el movimiento al persistirlo en `pagos_recibidos.link_token_ref`.
 */
export interface EventoPagoRecibido {
  name: 'dinero/pago.recibido';
  data: {
    tenantId: string;
    /** `Movement.id` de Fintoc — llave de idempotencia de ingesta por tenant. */
    movimientoExternoId: string;
    /** Monto en CLP entero (positivo = entra dinero a la cuenta del courier). */
    montoClp: number;
    /** Fecha del movimiento en ISO date (`YYYY-MM-DD`). */
    fechaMovimiento: string;
    /**
     * RUT de la contraparte ya normalizado (solo dígitos + DV), o `null` si
     * Fintoc no expuso `sender_account`. `null` = no atribuible por RUT.
     */
    contraparteRutNormalizado: string | null;
    contraparteNombre: string | null;
    /** Referencia OPACA (uuid) al secreto del link en secretos_cifrados. NUNCA el token. */
    linkTokenRef: string;
  };
}

/**
 * Resultado de una conciliación de pago contra un período `facturado`.
 *
 * Publicado por el job de matching (`dinero/jobs/conciliar-pago.ts`) cuando
 * imputa un pago a un período. Consumido por la proyección de `estado_cobro`
 * (en el MVP el propio job ya proyecta a `periodos_cobro` antes de emitirlo; el
 * evento es el punto de extensión para notificar al seller "tu cobro fue pagado").
 *
 * - `pagado_total`: el pago salda el saldo del período → `estado_cobro = 'pagado'`.
 * - `pagado_parcial`: el pago abona parte del saldo → `estado_cobro = 'parcial'`.
 */
export interface EventoPagoConciliado {
  name: 'dinero/pago.conciliado';
  data: {
    tenantId: string;
    /** UUID de la fila `dinero.pagos_recibidos` conciliada. */
    pagoRecibidoId: string;
    sellerId: string;
    periodoCobroId: string;
    /** Monto imputado en este pago (CLP entero). */
    montoClp: number;
    resultado: 'pagado_total' | 'pagado_parcial';
  };
}

/**
 * Nota de crédito (RF-038) — anulación TOTAL de la factura de un período.
 *
 * Publicado EXCLUSIVAMENTE por la acción humana `emitirNotaCreditoPeriodo`
 * (`dinero/acciones.ts`, gate `puedeEmitirFacturas`, motivo obligatorio,
 * bitácora ANTES del evento). Consumido por el job C-NC
 * (`dinero/jobs/emitir-nota-credito.ts`).
 *
 * Misma compuerta humana que la emisión de facturas: una NC es un documento
 * tributario irreversible — nada la emite automáticamente.
 *
 * Los montos viajan COPIADOS de la fila del 33 en `documentos_dte` (no se
 * recalculan desde las líneas, que pueden haber sido editadas después).
 */
export interface EventoNcEmisionSolicitada {
  name: 'dinero/nc.emision-solicitada';
  data: {
    periodoCobroidId: string;
    tenantId: string;
    sellerId: string;
    /** UUID del documento 33 (en `documentos_dte`) que la NC anula. */
    documentoDteId: string;
    /** Folio del 33 original — va en la Referencia del 61 (FolioRef). */
    folioReferencia: number;
    tipoDocumentoReferencia: 33;
    montoNetoClp: number;
    montoIvaClp: number;
    montoTotalClp: number;
    /** Motivo de la anulación (obligatorio; el adaptador trunca a 90 chars). */
    motivo: string;
    /** UUID de auth del usuario que solicitó la NC (trazabilidad RNF-04). */
    solicitadoPorUsuarioId: string;
    /** 'sandbox' (stub, sin SII real) | 'real' (exige opt-in del courier). */
    modo: 'sandbox' | 'real';
  };
}
