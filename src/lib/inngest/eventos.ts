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
 *
 * NOTA BLOQUE 3 (motor entrega→dinero same-day):
 * Al implementar el Bloque 3, agregar el campo `podValido: boolean | null` al
 * `data` de este evento. El job C1 (generar-lineas) debe retener la liquidación
 * del conductor para entregas same-day sin POD válido (`podValido=false`):
 * la línea de cobro al seller SÍ se genera (el seller paga igual), pero la
 * línea de liquidación al conductor queda en estado 'retenida' hasta que el
 * supervisor valide o rechace la entrega. No agregar este campo hasta que el
 * job C1 esté listo para consumirlo, para no romper la deduplicación de Inngest
 * con IDs existentes.
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
 * Pedido recién ingestado — gatillo de la geocodificación (F4, ítem 1.1).
 *
 * Publicado por `operacion` (lo cableará `backend`) cada vez que se crea un
 * pedido (ingesta Flex o same-day ad-hoc), DESPUÉS de persistirlo con
 * `geo_estado = 'pendiente'`. Consumido por el job
 * `integraciones/geocoding/jobs/geocodificar-pedido.ts` (idempotente).
 *
 * MINIMIZACIÓN DE DATOS PERSONALES: el payload SOLO lleva datos de dirección.
 * NUNCA incluye nombre ni teléfono del destinatario — el geocoding no los
 * necesita y no deben viajar a un proveedor externo ni quedar en el log de
 * eventos de Inngest. El job lee lo que falte directo de la fila vía
 * service_role.
 */
export interface EventoPedidoIngestado {
  name: 'operacion/pedido.ingestado';
  data: {
    pedidoId: string;
    tenantId: string;
    sellerId: string;
    /** Dirección de calle del destinatario (sin normalizar). */
    direccion: string;
    /** Comuna declarada del destinatario. */
    comuna: string;
    tipoPedido: 'flex' | 'same_day';
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

/**
 * Compuerta de pago a conductor (F19, Bloque 3).
 *
 * Publicado EXCLUSIVAMENTE por la acción humana `emitirPagoLiquidacion`
 * (gate `puedeGestionarLiquidacionesConductores`, bitácora ANTES del evento).
 * Consumido por el job `jobEjecutarPayout` (`dinero/jobs/ejecutar-payout.ts`).
 *
 * Al igual que `dinero/periodo.emision-solicitada` para DTE, este evento es la
 * compuerta de aprobación humana del dinero SALIENTE: ningún proceso automático
 * (cron) emite un payout; solo esta acción, disparada por una persona con
 * permiso de gestión de liquidaciones, publica el evento que activa el job.
 *
 * `montoTotalClp` es el monto BRUTO devengado. El job calcula el monto líquido
 * restando la retención configurada en `courier_config_payout.porcentaje_retencion`.
 * El puerto `PuertoPayout` recibe el neto — nunca el bruto.
 */
export interface EventoLiquidacionPagoSolicitado {
  name: 'dinero/liquidacion.pago-solicitado';
  data: {
    liquidacionId: string;
    tenantId: string;
    driverId: string;
    /** Monto BRUTO en CLP. El job calcula el neto tras retención. */
    montoTotalClp: number;
    solicitadoPorUsuarioId: string;
  };
}

/**
 * Confirmación instantánea de payout saliente (F19/Fase 3 — webhook Fintoc
 * `transfer.outbound.*`).
 *
 * Publicado EXCLUSIVAMENTE por `api/webhooks/fintoc-payout/route.ts`, DESPUÉS
 * de: (1) validar la firma `Fintoc-Signature` con el secreto de ORGANIZACIÓN
 * (`FINTOC_PAYOUT_WEBHOOK_SECRET` — a diferencia de `dinero/pago.recibido`,
 * que es por-tenant), (2) resolver el payout/tenant/liquidación por
 * `transferExternoId`, (3) insertar en `dinero.eventos_payout_externos`
 * (barrera de idempotencia dura por `evento_externo_id`), y (4) registrar en
 * `bitacora_auditoria`. Consumido por `jobAplicarActualizacionPayout`
 * (`dinero/jobs/transicion-payout.ts`), que aplica la MISMA tabla de
 * transición que usa el polling (`jobConsultarEstadoPayout`) — una sola
 * fuente de verdad para webhook y polling.
 *
 * El `id` del evento Inngest (`payout-webhook-${eventoExternoId}`) es
 * idempotencia ADICIONAL sobre la barrera dura de BD: un reintento de Inngest
 * no re-ejecuta el job dos veces para el mismo evento externo.
 */
export interface EventoActualizacionExternaPayout {
  name: 'dinero/payout.actualizacion-externa';
  data: {
    tenantId: string;
    payoutId: string;
    liquidacionId: string;
    /** Id del transfer en Fintoc (`tr_...`) — correlaciona con `payouts_conductor.payout_externo_id`. */
    transferExternoId: string;
    /** Id del evento en Fintoc (`evt_...`) — la barrera de idempotencia dura. */
    eventoExternoId: string;
    estadoExterno: 'confirmado' | 'pendiente' | 'fallido' | 'rechazado' | 'desconocido';
    /** Motivo de rechazo/reversión saneado (Fintoc `return_reason`), o `null`. */
    motivo: string | null;
    /** Referencia al comprobante (Fintoc `receipt_url`), o `null`. */
    comprobanteRef: string | null;
  };
}

/**
 * Un payout a conductor quedó `confirmado` (dinero efectivamente movido).
 *
 * Publicado por `jobAplicarActualizacionPayout` cuando `aplicarTransicionPayout`
 * resuelve el evento como `confirmado` (webhook) — y también podría publicarse
 * desde el polling en el futuro si se decide dar el mismo tratamiento; hoy el
 * polling (`jobConsultarEstadoPayout`) NO lo emite (motor de re-chequeo, no
 * gatillo de conciliación inmediata). Consumido por
 * `jobConciliarPayoutConfirmado`, que corre una conciliación ACOTADA a esa
 * liquidación (detector D1 restringido, ver `conciliacion-insercion.ts`) sin
 * esperar el cron diario C7.
 *
 * El `id` determinístico (`payout-confirmado-${payoutId}`) evita que una
 * re-confirmación (replay del webhook ya deduplicado en la barrera de BD, o
 * un reintento del job) dispare la conciliación inmediata dos veces.
 */
export interface EventoPayoutConfirmado {
  name: 'dinero/payout.confirmado';
  data: {
    tenantId: string;
    payoutId: string;
    liquidacionId: string;
    driverId: string;
  };
}
