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
    /**
     * RÉGIMEN operativo y clave de tarifa — no la procedencia. Un pedido Shopify
     * viaja con `tipoPedido: 'same_day'` y `fuente: 'shopify'`.
     * `geocodificar-pedido.ts` lo usa tal cual para buscar `tarifas.tipo_entrega`,
     * y por eso NO puede convertirse en el eje de procedencia.
     */
    tipoPedido: 'flex' | 'same_day';
    /**
     * DE DÓNDE VIENE el pedido (`operacion.pedidos.fuente`, migración
     * 20260816000003/4). Se agrega con la entrada de Shopify: desde que hay tres
     * fuentes, `tipoPedido` dejó de responder "¿de dónde salió esto?" — Shopify y
     * el alta manual comparten régimen `same_day` y no comparten procedencia.
     *
     * Espejo del enum SQL `operacion.fuente_pedido`. Se escribe inline y no se
     * importa `FuentePedido` a propósito: `lib/inngest/eventos.ts` es el contrato
     * entre módulos y no depende de ninguno (misma regla que el resto del archivo).
     * Si el enum crece, esta unión crece con él.
     *
     * Hoy ningún consumidor ramifica por este campo — viaja para que el
     * consumidor pueda hacerlo sin re-leer la fila, y para que el log del evento
     * diga la verdad sobre el origen.
     */
    fuente: 'ml_flex' | 'rutax_manual' | 'shopify';
  };
}

/**
 * Mercado Libre canceló un envío que nosotros ya teníamos como pedido vivo.
 *
 * Publicado por `integraciones/ml` desde los DOS caminos que pueden descubrirlo
 * (el webhook, vía `jobs/procesar-shipment.ts`, y el barrido de estados del cron
 * `jobs/ingesta-pedidos-ml.ts`), a través del único detector compartido en
 * `integraciones/ml/cancelacion-ml.ts`.
 *
 * ⚠️ **`integraciones` detecta y avisa; NO aplica las consecuencias.** Quien
 * consuma este evento es el dueño de moverlo a `cancelado`, abrir la incidencia
 * si corresponde y cerrar el cabo de dinero. El adaptador no toca el estado del
 * pedido ni las líneas de cobro/liquidación: si lo hiciera, la misma decisión
 * viviría en dos módulos.
 *
 * Por qué hace falta un evento y no basta el webhook: `GET /orders/search?seller=`
 * **no devuelve órdenes canceladas** (verificado contra la doc oficial de ML) —
 * desaparecen del resultado en vez de aparecer marcadas. La cancelación solo se
 * ve preguntando por el ENVÍO, y las notificaciones de ML se pierden (8 reintentos
 * en 1 h y baja del topic en silencio). De ahí que el detector viva en dos sitios
 * y publique un solo contrato.
 *
 * Idempotencia: `id` determinístico `pedido-cancelado-ml-${pedidoId}` — un pedido
 * se cancela una vez, por mucho que webhook y cron lo descubran a la vez.
 *
 * NO viaja quién canceló ni el motivo (decisión del usuario, 2026-08-13): solo el
 * estado. `substatusMl` es el `substatus` crudo del envío, útil para diagnóstico;
 * no es un dato personal.
 */
export interface EventoPedidoCanceladoEnMl {
  name: 'operacion/pedido.cancelado-en-ml';
  data: {
    pedidoId: string;
    tenantId: string;
    sellerId: string;
    /** `ml_shipment_id` del pedido — no es dato personal (la Torre ya lo muestra). */
    mlShipmentId: string;
    /** Estado interno que tenía el pedido al detectarse la cancelación. */
    estadoAnterior: string;
    /** `substatus` que reportó ML, o `null` si no vino. */
    substatusMl: string | null;
  };
}

/**
 * Una FUENTE externa distinta de Mercado Libre canceló un pedido que Rutax
 * tenía vivo. Hoy lo publica solo `integraciones/shopify` (repaso del cron, al
 * ver `cancelledAt` en la orden).
 *
 * ⚠️ **SIN CONSUMIDOR, A PROPÓSITO.** `integraciones` DETECTA y AVISA; aplicar
 * el estado, abrir la incidencia si el bulto ya iba en la van y cerrar el cabo
 * de dinero es trabajo de `operacion` — exactamente el mismo reparto que rige
 * para `operacion/pedido.cancelado-en-ml`. Mientras nadie lo consuma, una
 * cancelación en Shopify queda registrada en el log del job y en el resumen de
 * `infra.ejecuciones_job`, y el pedido sigue vivo en Rutax. Eso es deuda
 * conocida, no un descuido: el consumidor es una entrega de `operacion`.
 *
 * ⚠️ **POR QUÉ NO SE REUTILIZÓ `operacion/pedido.cancelado-en-ml`.** Ese evento
 * es de ML hasta en la forma: `mlShipmentId` es obligatorio, `substatusMl`
 * también, y su consumidor (`operacion/jobs/procesar-cancelacion-ml.ts`) escribe
 * `accion: 'pedido.cancelado_por_ml'` y `ml_shipment_id` en la bitácora. Un
 * pedido Shopify no tiene shipment de ML: pasar por ahí obligaría a inventar un
 * valor de relleno y dejaría en la auditoría financiera la frase «lo canceló
 * Mercado Libre» sobre un pedido que Mercado Libre nunca vio. La auditoría es
 * justamente lo que no se puede ensuciar.
 *
 * Es SOURCE-NEUTRAL a propósito (`fuente` + `idExterno`, no un campo por
 * proveedor): la siguiente fuente con escritura de vuelta —WooCommerce,
 * Falabella— publica este mismo contrato sin tocar nada. Migrar ML a él es una
 * decisión aparte y no urgente: su camino ya está construido y probado.
 *
 * Idempotencia sugerida al publicar: `id` determinístico
 * `pedido-cancelado-fuente-${pedidoId}` — un pedido se cancela una vez, por
 * mucho que dos barridos lo descubran.
 *
 * NO viaja quién canceló ni el motivo: solo el hecho. Tampoco datos del
 * destinatario.
 */
export interface EventoPedidoCanceladoEnFuente {
  name: 'operacion/pedido.cancelado-en-fuente';
  data: {
    pedidoId: string;
    tenantId: string;
    sellerId: string;
    /** Espejo de `operacion.pedidos.fuente`. Hoy siempre 'shopify'. */
    fuente: 'shopify';
    /** `operacion.pedidos.id_externo` — el id del pedido EN la fuente. No es dato personal. */
    idExterno: string;
    /** El número visible del pedido en la tienda (`#1001`), para el mensaje al humano. */
    referenciaExterna: string | null;
    /** Estado interno que tenía el pedido al detectarse la cancelación. */
    estadoAnterior: string;
    /** Instante ISO en que la fuente dice que se canceló, si lo informa. */
    canceladoEnFuenteEn: string | null;
  };
}

/**
 * Un humano pidió sincronizar AHORA una conexión de Shopify (botón
 * «Sincronizar ahora» del portal del seller / panel del courier).
 *
 * Consumido por `jobSincronizarConexionShopify`
 * (`integraciones/shopify/jobs/ingesta-pedidos-shopify.ts`), que corre EXACTAMENTE
 * la misma rutina por-conexión que el cron. No hay un camino manual que pueda
 * divergir del automático — misma regla que en ML.
 *
 * `actorUsuarioId` es el UUID de auth de quien apretó el botón; viaja para
 * trazabilidad (RNF-04) y la acción que publica el evento es la responsable de
 * dejar la bitácora ANTES de publicarlo.
 *
 * NO lleva tokens ni referencias a secretos: el job resuelve la conexión por su
 * `conexionId` y descifra el Admin API token dentro del paso.
 */
export interface EventoSincronizacionShopifySolicitada {
  name: 'shopify/sincronizacion.solicitada';
  data: {
    conexionId: string;
    sellerId: string;
    tenantId: string;
    /** UUID de auth de quien la solicitó, o `null` si la disparó el sistema. */
    actorUsuarioId: string | null;
  };
}

/**
 * Un humano pidió sincronizar AHORA una conexión de Mercado Libre.
 *
 * Publicado por la acción de servidor detrás del botón «Sincronizar» del panel
 * de conexiones; consumido por `jobSincronizarConexionMl`
 * (`integraciones/ml/jobs/ingesta-pedidos-ml.ts`), que corre exactamente la
 * misma rutina por-conexión que el cron de respaldo — misma ingesta de órdenes
 * nuevas y mismo barrido de estados. No hay un segundo camino "manual" que
 * pueda divergir del automático.
 *
 * `actorUsuarioId` es el UUID de auth de quien apretó el botón. Viaja para
 * trazabilidad (RNF-04): la acción que publica el evento es la responsable de
 * dejar la bitácora ANTES de publicarlo, según el patrón del proyecto.
 *
 * NO lleva tokens ni referencias a secretos: el job resuelve la conexión por su
 * `conexionId` y descifra el token dentro del paso, nunca en el payload.
 */
export interface EventoSincronizacionMlSolicitada {
  name: 'ml/sincronizacion.solicitada';
  data: {
    conexionId: string;
    sellerId: string;
    tenantId: string;
    /** UUID de auth de quien la solicitó, o `null` si la disparó el sistema. */
    actorUsuarioId: string | null;
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

// =============================================================================
// `plataforma` — backstage financiero de Rutax (Rutax cobra al courier).
// DISTINTO del motor entrega→dinero de arriba (courier cobra al seller). Fase 1
// de "completar suscripciones": superficie self-serve del courier
// (`src/modules/plataforma/superficie-courier.ts`) + ciclo de cobro automático.
// =============================================================================

/**
 * Alta de una suscripción — self-serve (courier) o asignada por super-admin.
 *
 * Publicado por `crearSuscripcionInicial` (`plataforma/superficie-courier.ts`,
 * origen `self_serve`) DESPUÉS del INSERT, con la bitácora ya registrada ANTES
 * (RNF-04). El alta super-admin (`asignarPlan`, `plataforma/acciones.ts`) hoy
 * NO publica este evento (fuera de alcance de esta fase); el campo `origen` ya
 * distingue el caso para cuando se conecte.
 *
 * Sin consumidor todavía — punto de extensión (p. ej. notificación de
 * bienvenida, analítica de activación).
 */
export interface EventoSuscripcionCreada {
  name: 'plataforma/suscripcion.creada';
  data: {
    tenantId: string;
    suscripcionId: string;
    planId: string;
    estado: 'trial' | 'activa';
    trialHasta: string | null;
    origen: 'self_serve' | 'super_admin';
  };
}

/**
 * Se generó un período de suscripción COBRABLE (`monto_clp > 0`) para una
 * suscripción `activa`. Publicado por el cron `plataforma/generarPeriodos`
 * (`jobs/generar-periodos.ts`) tras insertar el período — NO se publica para
 * trials (`monto_clp = 0`): no hay nada que cobrar.
 *
 * Consumido por el futuro job de auto-cobro recurrente (mandato Fintoc,
 * `integraciones`, encadenado a continuación de esta fase) — hoy sin
 * consumidor registrado en el repo. El cron NUNCA cobra directamente (mismo
 * principio que `dinero/periodo.cerrado`: generar ≠ cobrar); el `id` de evento
 * es determinístico por `periodoId` para que un reintento del cron no dispare
 * un segundo intento de cobro.
 */
export interface EventoSuscripcionPeriodoGenerado {
  name: 'plataforma/suscripcion.periodo-generado';
  data: {
    tenantId: string;
    suscripcionId: string;
    periodoId: string;
    montoClp: number;
    periodoInicio: string;
    periodoFin: string;
    periodicidad: 'mensual' | 'anual';
  };
}

/**
 * Un pago de suscripción quedó confirmado (período `pagado`).
 *
 * Publicado por `confirmarPagoSuscripcion` (`plataforma/cobro.ts`) tras marcar
 * el período pagado — bitácora (actor `sistema`, el webhook) ya registrada
 * ANTES de este evento. `metodo` incluye `fintoc_recurrente` para cuando el
 * auto-cobro por mandato quede activo (hoy solo se produce `fintoc_link` y
 * `transferencia_manual`/`cortesia` vía las acciones de super-admin).
 *
 * Sin consumidor todavía — punto de extensión (p. ej. recibo por correo al
 * courier, analítica de cobranza).
 */
export interface EventoPagoSuscripcionConfirmado {
  name: 'plataforma/pago.confirmado';
  data: {
    tenantId: string;
    suscripcionId: string;
    periodoId: string;
    montoClp: number;
    metodo: 'fintoc_link' | 'fintoc_recurrente' | 'transferencia_manual' | 'cortesia';
    confirmadoEn: string;
  };
}

/**
 * Un intento de cobro de suscripción falló (link expirado/rechazado, o —
 * cuando exista— un cargo de mandato recurrente rechazado).
 *
 * Contrato tipado para el futuro job de auto-cobro recurrente (`integraciones`,
 * continuación de esta fase): ese job es el PRODUCTOR real. Se define aquí
 * ahora (regla del proyecto: "todo evento nuevo se define en `eventos.ts` antes
 * de emitirse o consumirse") para que el siguiente agente implemente contra un
 * contrato ya acordado, sin re-negociar la forma del payload. `motivoSaneado`
 * es el motivo de rechazo YA saneado por el llamador — nunca el payload crudo
 * del proveedor (puede traer datos sensibles del medio de pago).
 */
export interface EventoCobroSuscripcionFallido {
  name: 'plataforma/cobro.fallido';
  data: {
    tenantId: string;
    suscripcionId: string;
    periodoId: string;
    montoClp: number;
    motivoSaneado: string | null;
    reintentable: boolean;
  };
}

/**
 * Un trial está por vencer.
 *
 * Contrato tipado para el futuro monitor de trials (cron, continuación de esta
 * fase) — mismo razonamiento que `plataforma/cobro.fallido`: se define el
 * contrato ahora, el productor llega con ese job.
 */
export interface EventoTrialPorVencer {
  name: 'plataforma/trial.por-vencer';
  data: {
    tenantId: string;
    suscripcionId: string;
    trialHasta: string;
    diasRestantes: number;
  };
}

/**
 * El plan (o la periodicidad) de la suscripción de un courier CAMBIÓ de forma
 * EFECTIVA (F2 "Ola 3", ítem M — ciclo de vida y comunicaciones).
 *
 * Publicado en el momento en que el cambio realmente toma efecto — no en el
 * momento en que se SOLICITA un cambio diferido (ver el modelo de downgrade
 * diferido documentado en `plataforma/superficie-courier.ts`, sobre
 * `cambiarPlanCourier`):
 *  - `upgrade` (efecto inmediato): lo publica `cambiarPlanCourier`
 *    (`plataforma/superficie-courier.ts`) justo después de aplicar el swap de
 *    `plan_id`, con o sin cargo de proración.
 *  - `downgrade` / `periodicidad` (efecto diferido al próximo ciclo): NO se
 *    publica al solicitarlo (nada cambió todavía) — lo publica
 *    `plataforma/aplicarCambiosPlan` (`jobs/aplicar-cambios-plan.ts`) el día
 *    en que el cron efectivamente aplica el swap.
 * Un solo evento por cambio real evita duplicar el correo de confirmación.
 *
 * Consumido por `jobs/notificar-plan-cambiado.ts` (correo de confirmación al
 * courier, vía el puerto de email).
 */
export interface EventoPlanCambiado {
  name: 'plataforma/plan.cambiado';
  data: {
    tenantId: string;
    suscripcionId: string;
    planDesdeId: string;
    planHaciaId: string;
    tipo: 'upgrade' | 'downgrade' | 'periodicidad';
    periodicidadDesde: 'mensual' | 'anual';
    periodicidadHacia: 'mensual' | 'anual';
    /** Cargo de proración inmediato (CLP), o `null` si no aplicó ninguno. */
    montoAjusteClp: number | null;
    /** Fecha ('YYYY-MM-DD', Santiago) en que el cambio es efectivo (hoy, siempre). */
    efectivoDesde: string;
    /** UUID de auth de quien solicitó el cambio, o `null` si lo aplicó el cron (cambio diferido). */
    actorUsuarioId: string | null;
  };
}

/**
 * Comunicación de Rutax a los couriers publicada CON envío de email (F3 · Gap
 * 7 — `plataforma.comunicaciones`, migración 20260713000001).
 *
 * Publicado EXCLUSIVAMENTE por `crearComunicacion` (`plataforma/comunicaciones.ts`)
 * cuando `enviarEmail=true`, DESPUÉS del INSERT (bitácora ya registrada ANTES
 * del INSERT — RNF-04). El banner in-app NO depende de este evento (lo resuelve
 * `obtenerComunicacionesActivasParaCourier`, leído directo por el agregador de
 * avisos en cada render) — este evento es SOLO el disparador del broadcast por
 * correo a los couriers, consumido por `jobs/notificar-comunicacion.ts`.
 *
 * `id` de evento determinístico (`comunicacion-publicada-${comunicacionId}`):
 * una comunicación se publica una sola vez, nunca se re-emite al desactivarla/
 * reactivarla.
 */
export interface EventoComunicacionPublicada {
  name: 'plataforma/comunicacion.publicada';
  data: {
    comunicacionId: string;
    titulo: string;
    cuerpo: string;
    tipo: 'info' | 'mantencion' | 'novedad' | 'alerta';
    nivel: 'informativo' | 'importante' | 'urgente';
  };
}

/**
 * Retiro en bodega (etapa 8) — una visita a bodega se CERRÓ y hay que pagarla.
 *
 * Publicado por `operacion/retiro/sesiones.ts` (`cerrarSesionRetiro`) DESPUÉS
 * de que el RPC de cierre confirma, y NUNCA para una visita descartada por
 * llegar a cero bultos: esa se borra, no ocurrió como hecho económico.
 * Consumido por `dinero/jobs/generar-linea-retiro.ts`.
 *
 * POR QUÉ ES UN EVENTO Y NO UNA ESCRITURA EN LÍNEA. El conductor cierra la
 * visita de pie en la bodega, con el jefe de bodega esperando; hacerlo aguardar
 * a que se resuelva un monto, se lea una configuración y se escriba una línea
 * de dinero es meter la trastienda financiera dentro de su gesto operativo.
 * Además CLAUDE.md lo pide explícitamente: los procesos de dinero corren como
 * jobs idempotentes con reintentos, no en el request del usuario.
 *
 * El `id` determinístico (`linea-retiro-${sesionRetiroId}`) es la PRIMERA de
 * las dos capas de idempotencia. La segunda es el índice
 * `lineas_liq_sesion_retiro_uk` en la base: una visita, una línea, pase lo que
 * pase con los reintentos.
 *
 * ⚠️ El evento NO lleva el monto. A propósito: si viajara en el payload, un
 * reintento de Inngest horas más tarde podría escribir un monto que ya cambió,
 * y peor, el monto quedaría registrado en la cola de eventos — que no es el
 * lugar donde se audita la plata. El job lo resuelve al momento de generar.
 */
export interface EventoVisitaRetiroCerrada {
  name: 'dinero/retiro.visita-cerrada';
  data: {
    sesionRetiroId: string;
    tenantId: string;
    /** El conductor que HIZO la visita — es a quien se le paga, y la FK compuesta de la línea lo impone en la base. */
    conductorId: string;
    /** Bodega visitada: de ella sale el override de monto, si lo tiene. */
    bodegaId: string;
    sellerId: string;
    /** Fecha de operación de la visita — es la `fecha_hecho` de la línea (nombre heredado, ver el tipo LineaLiquidacion). */
    fechaOperacion: string;
    /** Bultos efectivamente cargados. NO determina el monto (se paga por visita); va al concepto y a la trazabilidad. */
    bultosTotal: number;
  };
}

/**
 * Retiro en bodega (etapa 3) — un bulto se escaneó pero Rutax no pudo
 * casarlo con ningún pedido ya ingestado: candidato ajeno (otro courier) o
 * todavía no ingestado (docs/arquitectura/retiro-y-ruteo.md §2.1).
 *
 * Publicado por `operacion/retiro/escaneos.ts` (`registrarLoteEscaneos`)
 * DESPUÉS de insertar el bulto como `no_procesado` (`pedido_id = null`) —
 * nunca antes: si el INSERT falla, no hay bulto del que avisar. Solo se
 * publica para `codigo_formato = 'flex_qr'`: es el único formato con un
 * identificador (`ml_shipment_id`) contra el que ML puede resolverse más
 * tarde. Un `desconocido` no trae shipment id — nada que re-consultar — y un
 * `rutax_interno` sin match es un problema de datos propios (same-day, sin
 * fuente externa que sincronizar), así que tampoco dispara este evento.
 *
 * ⚠️ El endpoint de escaneos NUNCA llama a ML directamente (CLAUDE.md: el
 * núcleo no llama APIs externas directo, y la latencia de un tercero no puede
 * meterse en el gesto que el conductor repite ~130 veces con el seller
 * apurándolo). Este evento es el enganche para que `integraciones` construya
 * el consumidor que reintenta la resolución — SIN CONSUMIDOR en esta entrega,
 * a propósito: es trabajo de integración con ML, fuera del alcance de esta
 * etapa (backend solo define y publica el contrato).
 *
 * `id` determinístico (`bulto-retiro-sin-pedido-${bultoId}`): un reintento
 * del mismo lote (mismo `escaneoId`, fusionado contra el mismo bulto ya
 * insertado) no debe disparar una segunda resolución diferida para el mismo
 * bulto — la deduplicación de Inngest por `id` la absorbe.
 */
export interface EventoBultoRetiroSinPedido {
  name: 'operacion/bulto-retiro.sin-pedido';
  data: {
    bultoId: string;
    tenantId: string;
    sesionRetiroId: string;
    /** `ml_shipment_id` a re-consultar contra ML. Siempre presente — única razón de ser del evento. */
    mlShipmentId: string;
    /** Momento del escaneo (dispositivo) — para que el consumidor sepa cuánto lleva sin resolver. */
    escaneadoEn: string;
  };
}

/**
 * Un pedido llegó a un estado TERMINAL — evento SOURCE-NEUTRAL para que
 * `integraciones` escriba de vuelta a la fuente que lo originó (Shopify hoy;
 * Falabella u otra fuente futura mañana, sin tocar `operacion/pedidos.ts`).
 *
 * Publicado por `actualizarEstadoPedido` (`operacion/pedidos.ts`), en el MISMO
 * punto post-commit donde ya se publica `dinero/pedido.estado_financiero_relevante`
 * y para el MISMO conjunto de estados ('entregado' | 'entregado_manual' |
 * 'fallido' | 'fallido_manual' | 'devuelto' | 'cancelado') — pero es un evento
 * DISTINTO e independiente, con su propio `try/catch` best-effort. Publicarlo
 * incondicionalmente (sin la excepción `sinAsignacionEnRutax` que sí aplica al
 * evento financiero) es deliberado: esa excepción existe para no FACTURAR una
 * entrega que Rutax no hizo, pero avisarle a la tienda que su pedido llegó a un
 * estado terminal es correcto sin importar quién lo entregó — el comprador
 * sigue esperando su notificación de envío.
 *
 * ⚠️ **NO ES `dinero/pedido.estado_financiero_relevante` REUSADO, A PROPÓSITO.**
 * Ese evento es un CONTRATO DEL MÓDULO `dinero` (lo consume C1, y su forma
 * cambia cuando cambian las reglas de facturación/liquidación). Colgar la
 * escritura hacia una tienda externa de un evento que le pertenece a `dinero`
 * ataría el adaptador de Shopify a cómo el motor de plata nombra sus cosas —
 * el día que `dinero` le agregue un campo (ver la nota de `podValido` más
 * arriba en este archivo), ese cambio no debería poder romper, ni siquiera
 * rozar, la notificación al comprador.
 *
 * Consumido hoy por `integraciones/shopify/jobs/marcar-cumplido-shopify.ts`,
 * que es no-op salvo `fuente === 'shopify'` y `estadoNuevo` de entrega
 * ('entregado' | 'entregado_manual'): 'fallido' | 'devuelto' | 'cancelado' NO
 * escriben nada en la tienda en la v1 (qué significan allá es una conversación
 * aparte). El evento se publica igual para esos estados — el filtro es del
 * consumidor, no del productor — para que un futuro consumidor (p. ej. un
 * webhook saliente propio, F23) no tenga que esperar un segundo evento.
 *
 * `idExterno` es `operacion.pedidos.id_externo` — `null` para `ml_flex` y
 * `rutax_manual` (ninguno de los dos lo puebla hoy). NO lleva datos personales
 * del destinatario.
 */
export interface EventoPedidoEstadoTerminal {
  name: 'operacion/pedido.estado-terminal';
  data: {
    pedidoId: string;
    tenantId: string;
    sellerId: string;
    /** Espejo de `operacion.pedidos.fuente`. */
    fuente: 'ml_flex' | 'rutax_manual' | 'shopify';
    /** `operacion.pedidos.id_externo` — `null` en fuentes que no lo pueblan. */
    idExterno: string | null;
    estadoNuevo: 'entregado' | 'entregado_manual' | 'fallido' | 'fallido_manual' | 'devuelto' | 'cancelado';
    /** ISO timestamptz zona America/Santiago. */
    fechaTransicion: string;
  };
}

// =============================================================================
// `contexto` — Torre de control (anticipación operativa).
//
// **CERO eventos, y es correcto.** El único job que le queda al módulo
// (`jobSincronizarCalendario`) es un cron puro sin payload, y en este repo un
// cron no necesita evento — ver `jobCerrarPeriodo`, que se dispara con
// `triggers: [{ cron }]` y cero eventos. Aquí solo entra lo que cruza un límite
// de verdad.
//
// Se retiró `contexto/riesgo.recalcular-tenant` (2026-08-03). Era el fan-out por
// tenant del motor de riesgo, que corría cada 15 minutos para precalcular un
// puntaje 0–100 por zona. El rediseño v2 de la Torre retiró ese puntaje entero:
// la pantalla lee la carga en vivo desde `operacion`, así que no queda nada que
// precalcular ni, por lo tanto, nada que despachar. Ver
// `docs/torre-de-control/alcance-v2.md` §5.2.
//
// Límite del módulo: `operacion` y `dinero` NO consumen eventos de `contexto`.
// La capa de anticipación depende del núcleo operativo, nunca al revés.
// =============================================================================

// =============================================================================
// `notificaciones` — avisos salientes por WhatsApp.
// =============================================================================

/**
 * Publicado por `POST /api/whatsapp/send` (y, más adelante, por los puntos de
 * la operación que quieran avisar: el cierre de una sesión de retiro, la
 * confirmación de un manifiesto). Consumido por
 * `integraciones/notificaciones/whatsapp/jobs/enviar-whatsapp.ts`.
 *
 * POR QUÉ HAY UN EVENTO Y NO UNA LLAMADA DIRECTA: mandar un WhatsApp implica
 * hablar con Meta, y eso ni puede correr dentro del request del usuario (la
 * regla del proyecto: los procesos pesados son jobs idempotentes con
 * reintentos) ni puede tumbar la operación que lo disparó — un retiro que ya se
 * cerró no se deshace porque la Cloud API esté caída. El evento es lo que
 * separa las dos cosas, y de paso trae el backoff de Inngest sin construirlo.
 *
 * EL EMISOR NO VIAJA EN EL EVENTO. El número es UNO solo, el de Rutax (1:N), y
 * lo resuelve `fabrica-whatsapp.ts` desde el entorno. `tenantId` dice a qué
 * courier pertenecen los DESTINATARIOS, no desde qué número se manda.
 */
export interface EventoWhatsAppSolicitado {
  name: 'notificaciones/whatsapp.solicitado';
  data: {
    /** El courier dueño de los contactos destinatarios. */
    tenantId: string;
    /** Clave del catálogo de plantillas (`catalogo-plantillas.ts`). */
    claveEvento: string;
    /**
     * El hecho concreto que originó el aviso (id de la sesión de retiro, del
     * manifiesto, del pedido). Es la mitad variable de la llave de
     * idempotencia: sin esto, dos retiros del mismo día se tomarían por el
     * mismo aviso y el segundo no saldría nunca.
     */
    referencia: string;
    /** A quién, cuando la plantilla va dirigida a un seller o a una bodega. */
    destino?: {
      sellerId?: string | null;
      bodegaId?: string | null;
    };
    /** Variables del cuerpo EN ORDEN. Debe calzar con el catálogo. */
    variables: string[];
  };
}
