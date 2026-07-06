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
 * - `EventoConciliacionTresFuentes`: cron diario a las 02:30, consumido por C7
 *   (`dinero/jobs/conciliar-tres-fuentes.ts`). Detective puro, solo lectura.
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
 * Punto de extensión para notificaciones de corte próximo (F7, ítem 1.2).
 *
 * NO se publica en F7: el dashboard hace el cómputo en vivo
 * (`obtenerResumenCortePorSeller` en metricas.ts). Este evento queda declarado
 * para cuando se implemente una notificación push/email a coordinadores cuando
 * el corte está próximo (p. ej. 30 minutos antes).
 *
 * Para emitirlo en el futuro: crear un cron que corra cada N minutos y evalúe
 * las ventanas activas del día, usando la utilidad de Santiago para TZ.
 * NUNCA emitirlo en el request del usuario.
 */
export interface EventoCorteProximo {
  name: 'operacion/corte.proximo';
  data: {
    tenantId: string;
    sellerId: string;
    /** UUID de la zona aplicable. null = ventana por defecto del seller. */
    zonaId: string | null;
    /** Hora de corte 'HH:MM' local Santiago. */
    horaCorte: string;
    /** Minutos restantes hasta el corte en el momento de emisión. */
    minutosRestantes: number;
    /** Pedidos same-day no terminales del día en el momento de emisión. */
    pedidosPendientes: number;
    /** Fecha del día de operación 'YYYY-MM-DD' local Santiago. */
    fecha: string;
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
 * Trigger interno del job C7 — conciliación de 3 fuentes (F17, Bloque 3).
 *
 * El cron `30 2 * * *` (02:30 Santiago, diario) emite este evento por cada
 * tenant activo. El job C7 lo consume y ejecuta los 6 detectores de fugas
 * cruzando: (1) líneas de cobro al seller, (2) líneas de liquidación al
 * conductor, y (3) rate card (mínimos y recargos).
 *
 * Detective puro, solo lectura. Nunca muta líneas ni emite documentos.
 * El campo `fecha` permite idempotencia: eventId = `conciliar-3f-${tenantId}-${fecha}`.
 */
export interface EventoConciliacionTresFuentes {
  name: 'dinero/conciliacion.tres_fuentes';
  data: {
    tenantId: string;
    /** Fecha de ejecución 'YYYY-MM-DD' en zona Santiago — llave de idempotencia. */
    fecha: string;
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
