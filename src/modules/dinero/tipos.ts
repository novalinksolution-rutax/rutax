/**
 * Tipos del módulo `dinero` — interfaces TypeScript espejo de las tablas
 * del schema `dinero` (migración 0006_dinero_base.sql).
 *
 * Reglas:
 * - Solo tipos y enums: cero imports de lógica de negocio, cero side effects.
 * - Los montos son `number` (representan NUMERIC(12,0) — enteros CLP sin decimales).
 *   El código que produce estos montos debe usar Math.round() y nunca parseFloat.
 * - Las fechas son strings ISO (timestamptz) o date ISO ('YYYY-MM-DD').
 * - Se importan tipos puros de `operacion/tipos.ts` donde hace falta; nunca
 *   funciones ni lógica del módulo `operacion`.
 */

// =============================================================================
// Enums — espejo de los check constraints y valores de texto de la migración
// =============================================================================

/** Estado de un período de cobro. */
export type EstadoPeriodo = 'abierto' | 'cerrado' | 'facturado' | 'anulado';

/** Tipo de período de facturación (configuración por tenant/seller). */
export type TipoPeriodoFacturacion = 'semanal' | 'quincenal' | 'mensual';

/** Estado del DTE en el SII (o en el proveedor). */
export type EstadoSii =
  | 'pendiente'
  | 'aceptado'
  | 'rechazado'
  | 'aceptado_con_discrepancias';

/** Estado de una liquidación de conductor. */
export type EstadoLiquidacion = 'borrador' | 'emitida' | 'pagada';

/** Origen de generación de una línea (cobro o liquidación). */
export type OrigenGeneracion = 'motor_automatico' | 'ajuste_manual';

/** Tipos de diferencia en la conciliación. */
export type TipoDiferenciaConciliacion =
  // Tipos originales (C6 — 6 detectores de 2 fuentes)
  | 'pedido_entregado_sin_linea_cobro'
  | 'pedido_entregado_sin_linea_liquidacion'
  | 'linea_cobro_sin_pedido_entregado'
  | 'folio_consumido_sin_dte_persistido'
  | 'periodo_cerrado_con_lineas_sueltas'
  | 'monto_dte_difiere_de_lineas'
  // Tipos nuevos (C7 / F17 — 6 detectores de 3 fuentes, Bloque 3)
  | 'pagado_conductor_sin_cobro_seller'
  | 'cobrado_seller_no_pagado_conductor'
  | 'reprogramacion_no_cobrada'
  | 'minimo_omitido'
  | 'pago_seller_faltante'
  | 'pago_conductor_faltante'
  // Webhook de payout saliente (migración 20260708000002): un payout que ya
  // se había confirmado y el proveedor revirtió — reversión financiera
  // GENUINA (liquidación vuelve a 'emitida') — ver `jobs/transicion-payout.ts`.
  | 'payout_revertido_post_confirmacion'
  // Webhook/polling de payout (migración 20260709000001): estado_externo de
  // Fintoc NO reconocido (status raro/nuevo, ej. `reject_failed`). CERO
  // mutación financiera — NO es un pago pendiente, requiere revisión humana
  // del estado externo. Separado de `payout_revertido_post_confirmacion` por
  // recomendación de QA (categorías/acciones semánticamente distintas).
  | 'payout_estado_no_reconocido'
  // Integridad estructural (migración 20260805000001): línea de cobro ACTIVA sin
  // `periodo_cobro_id`. Ocurre cuando el paso `asignar-periodo-cobro` de C1 falla
  // —típicamente porque el período destino ya estaba cerrado/facturado— después de
  // que el paso anterior ya insertó la línea; Inngest memoiza los pasos
  // completados, así que la línea queda colgando. Es ingreso que no entra en
  // ninguna factura, de ahí `fuga_ingreso` y no `integridad_datos`.
  | 'linea_cobro_sin_periodo';

/**
 * Estado de un evento de conciliación (bandeja de excepciones — §1.1 P1).
 * No-terminales: `pendiente` (default) · `en_analisis` · `esperando_info` ·
 * `requiere_ajuste`. Terminales: `resuelta_auto` · `resuelta_manual` ·
 * `aceptada_justificada` · `ignorada`. Ver `TRANSICIONES_VALIDAS` en
 * `./conciliacion-clasificacion.ts` para la máquina de estados completa.
 */
export type EstadoEventoConciliacion =
  | 'pendiente'
  | 'en_analisis'
  | 'esperando_info'
  | 'requiere_ajuste'
  | 'resuelta_auto'
  | 'resuelta_manual'
  | 'aceptada_justificada'
  | 'ignorada';

/**
 * Categoría de negocio de una excepción de conciliación — deriva de
 * `tipoDiferencia` vía `categoriaNegocioPorTipo` (`./conciliacion-clasificacion.ts`).
 */
export type CategoriaNegocioConciliacion =
  | 'cumplimiento_dte'
  | 'fuga_ingreso'
  | 'pagos_pendientes'
  | 'integridad_datos';

/**
 * Acción recomendada al operador para resolver una excepción de conciliación.
 * La resolución sigue siendo humana (nunca automática) — esto es solo una
 * sugerencia. Deriva de `tipoDiferencia` vía `accionSugeridaPorTipo`.
 */
export type AccionSugeridaConciliacion =
  | 'revisar_tarifa_aplicada'
  | 'confirmar_con_seller'
  | 'confirmar_con_conductor'
  | 'generar_cobro_manual'
  | 'generar_ajuste_liquidacion'
  | 'reasignar_lineas_a_periodo'
  | 'reenviar_o_verificar_dte'
  | 'gestionar_cobranza_seller'
  | 'gestionar_pago_conductor'
  | 'marcar_error_del_motor'
  | 'sin_accion_requerida'
  // Estado externo de payout no reconocido (migración 20260709000001): pide
  // revisar el status externo inesperado — NO le dice al dueño "gestiona el
  // pago al conductor" (sería engañoso, no es un pago pendiente).
  | 'revisar_estado_externo';

/** Tipo de cambio registrado en `dinero.eventos_conciliacion_historial`. */
export type TipoCambioConciliacion =
  | 'deteccion'
  | 'cambio_estado'
  | 'asignacion'
  | 'fecha_limite'
  | 'bloqueo'
  | 'accion_sugerida'
  | 'comentario';

/** Quién generó una entrada de historial — un usuario humano o el sistema (job). */
export type ActorTipoHistorial = 'usuario' | 'sistema';

/**
 * Estado de atribución/conciliación de un pago recibido (capa "pagado" — Fintoc).
 * Espejo del enum SQL `dinero.estado_match_pago` (migración 0008).
 */
export type EstadoMatchPago =
  | 'sin_atribuir'   // ingerido, aún sin seller asignado
  | 'atribuido'      // asociado a un seller, falta conciliar contra período
  | 'conciliado'     // cuadra con un periodo_cobro (pago completo)
  | 'parcial'        // abona parcialmente un período (falta saldo)
  | 'sobrante'       // monto excede lo adeudado / no calza con ningún saldo
  | 'descartado';    // no corresponde a cobranza (devolución, error, etc.)

/**
 * Estado de cobro de un período (proyección derivada que escribe el job de
 * matching). Espejo del CHECK SQL `periodos_cobro.estado_cobro` (migración 0008).
 */
export type EstadoCobroPeriodo = 'no_aplica' | 'pendiente' | 'parcial' | 'pagado';

// =============================================================================
// Entidades — espejo de las tablas del schema `dinero`
// =============================================================================

/**
 * Una fila de `dinero.lineas_cobro`.
 * Representa el monto que el courier cobra al seller por un pedido elegible.
 */
export interface LineaCobro {
  id: string;
  tenantId: string;
  sellerId: string;
  pedidoId: string;
  /** Asignado al generar la línea (puede ser null si aún no se asignó al período). */
  periodoCobroidId: string | null;
  tarifaId: string;
  /** Monto base en CLP — entero, nunca float. */
  montoBaseClp: number;
  /** Ajuste por incidencia — puede ser negativo. */
  ajusteIncidenciaClp: number;
  /** Columna generada: monto_base_clp + ajuste_incidencia_clp. */
  montoFinalClp: number;
  concepto: string;
  tipoPedido: 'flex' | 'same_day';
  /** Fecha de entrega en zona America/Santiago — formato 'YYYY-MM-DD'. */
  fechaEntrega: string;
  incidenciaId: string | null;
  origenGeneracion: OrigenGeneracion;
  generadoPorUsuarioId: string | null;
  notas: string | null;
  /**
   * Copia congelada (jsonb) de la tarifa/regla de incidencia vigente en el
   * momento en que se generó la línea — trazabilidad del "por qué" del monto,
   * aunque la tarifa cambie después. Forma libre (depende del motor); solo
   * lectura para trazabilidad, nunca se recalcula desde aquí.
   */
  snapshotRegla: unknown;
  /** Soft-anulación: true si la línea fue anulada (pedido fallido → devuelto). */
  anulada: boolean;
  anuladaEn: string | null;
  motivoAnulacion: string | null;
  creadoEn: string;
  actualizadoEn: string;
}

/**
 * Una fila de `dinero.lineas_liquidacion`.
 * Representa el monto que el courier paga al conductor por un pedido elegible.
 */
export interface LineaLiquidacion {
  id: string;
  tenantId: string;
  driverId: string;
  pedidoId: string;
  /** Asignado al agrupar líneas en una liquidación. */
  liquidacionId: string | null;
  montoBaseClp: number;
  ajusteIncidenciaClp: number;
  montoFinalClp: number;
  concepto: string;
  fechaEntrega: string;
  incidenciaId: string | null;
  origenGeneracion: OrigenGeneracion;
  generadoPorUsuarioId: string | null;
  notas: string | null;
  /**
   * Copia congelada (jsonb) de la tarifa/regla de incidencia vigente en el
   * momento en que se generó la línea — trazabilidad del "por qué" del monto.
   * Ver `LineaCobro.snapshotRegla`.
   */
  snapshotRegla: unknown;
  creadoEn: string;
  actualizadoEn: string;
}

/**
 * Una fila de `dinero.periodos_cobro`.
 * Agrupa líneas de cobro de un seller para un período. El cierre genera el DTE.
 */
export interface PeriodoCobro {
  id: string;
  tenantId: string;
  sellerId: string;
  fechaInicio: string;
  fechaFin: string;
  tipoPeriodo: TipoPeriodoFacturacion;
  estado: EstadoPeriodo;
  totalLineas: number;
  /** Calculado al cerrar — null mientras está abierto. */
  montoTotalClp: number | null;
  documentoDteId: string | null;
  cerradoEn: string | null;
  cerradoPorUsuarioId: string | null;
  /**
   * Estado de cobro del período (proyección derivada de los pagos conciliados).
   * Lo escribe SOLO el job de matching (service_role); la fuente de verdad son
   * las filas de `pagos_recibidos`. `no_aplica` mientras no hay cobranza.
   */
  estadoCobro: EstadoCobroPeriodo;
  /** Suma de pagos imputados al período (CLP entero). 0 si no hay pagos. */
  montoPagadoClp: number;
  /** Marca de tiempo del cierre del cobro (cuando pasa a `pagado`), o null. */
  pagadoEn: string | null;
  /** Motivo de la anulación por nota de crédito (RF-038) — null si no fue anulado. */
  motivoAnulacion: string | null;
  /** Marca de tiempo de la anulación (período → `anulado`), o null. */
  anuladoEn: string | null;
  creadoEn: string;
  actualizadoEn: string;
}

/**
 * Una fila de `dinero.pagos_recibidos`.
 * Movimiento bancario (Fintoc) recibido del seller hacia la cuenta del courier.
 * `sellerId`/`periodoCobroId` son null hasta que el matching (o una persona) los
 * resuelve. El secreto `link_token` NUNCA viaja aquí — solo la referencia opaca.
 */
export interface PagoRecibido {
  id: string;
  tenantId: string;
  sellerId: string | null;
  periodoCobroId: string | null;
  /** `Movement.id` de Fintoc — llave de idempotencia de ingesta. */
  movimientoExternoId: string;
  /** Monto en CLP entero. Siempre positivo (un pago entrante). */
  montoClp: number;
  /** Fecha del movimiento — formato 'YYYY-MM-DD'. */
  fechaMovimiento: string;
  /** RUT de la contraparte normalizado (sin puntos ni guion), o null. */
  contraparteRutNormalizado: string | null;
  contraparteNombre: string | null;
  estadoMatch: EstadoMatchPago;
  atribuidoPorUsuarioId: string | null;
  atribuidoEn: string | null;
  creadoEn: string;
  actualizadoEn: string;
}

/**
 * Una fila de `dinero.documentos_dte`.
 * Registro permanente de cada DTE emitido por el courier al seller.
 *
 * Los campos `xml_dte_ref` y `pdf_ref` son referencias opacas a Storage —
 * nunca contienen la URL firmada directamente. El acceso se entrega via
 * signed URL (15 min) generada por Server Action.
 */
export interface DocumentoDte {
  id: string;
  tenantId: string;
  sellerId: string;
  periodoCobroidId: string;
  /** 33 = factura, 61 = nota de crédito. */
  tipoDocumento: 33 | 61;
  folio: number;
  fechaEmision: string;
  montoNetoclp: number;
  montoIvaClp: number;
  montoTotalClp: number;
  /** Referencia opaca al XML en Storage (firmado). */
  xmlDteRef: string | null;
  /** Referencia opaca al PDF en Storage. */
  pdfRef: string | null;
  /** ID del proveedor DTE externo (para polling). */
  proveedorDteIdExterno: string | null;
  estadoSii: EstadoSii;
  estadoProveedor: string;
  /** Descripción operativa del error — sin credenciales ni tokens. */
  errorDescripcion: string | null;
  /** Para notas de crédito: apunta al DTE original. */
  dteReferenciaId: string | null;
  emitidoEn: string;
  creadoEn: string;
  actualizadoEn: string;
}

/**
 * Una fila de `dinero.liquidaciones`.
 * Documento de liquidación del courier al conductor por un período.
 */
export interface Liquidacion {
  id: string;
  tenantId: string;
  driverId: string;
  fechaInicio: string;
  fechaFin: string;
  tipoPeriodo: TipoPeriodoFacturacion;
  estado: EstadoLiquidacion;
  totalEntregas: number;
  montoTotalClp: number | null;
  /** F16: bono manual por on-time u otro concepto positivo. CLP entero ≥ 0. */
  bonoClp: number;
  /** F16: penalización manual por fallo evitable u otro descuento. CLP entero ≥ 0. */
  penalizacionClp: number;
  /** F16: contexto del ajuste (por qué se aplicó bono o penalización). */
  notaAjuste: string | null;
  /** 'dependiente' | 'independiente' — copiado de conductores.tipo_relacion al generar. */
  tipoRelacionConductor: 'dependiente' | 'independiente';
  /** Referencia opaca al PDF en Storage. */
  pdfRef: string | null;
  notas: string | null;
  generadoEn: string | null;
  generadoPorUsuarioId: string | null;
  creadoEn: string;
  actualizadoEn: string;
}

/**
 * Estado de un payout (transferencia saliente) a un conductor.
 * Espejo del enum SQL `dinero.estado_payout` (migración 20260613000011).
 */
export type EstadoPayout = 'pendiente' | 'enviado' | 'confirmado' | 'rechazado' | 'fallido';

/** Método de pago saliente de un payout. */
export type MetodoPayout = 'fintoc' | 'manual' | 'nomina';

/**
 * Una fila de `dinero.payouts_conductor`.
 * Payout (transferencia saliente) del courier al conductor que salda una
 * liquidación. `UNIQUE (tenant_id, liquidacion_id)` en BD: a lo sumo un payout
 * por liquidación (barrera de doble-pago).
 */
export interface PayoutConductor {
  id: string;
  tenantId: string;
  driverId: string;
  liquidacionId: string;
  montoBrutoClp: number;
  montoRetencionClp: number;
  montoLiquidoClp: number;
  tipoRelacionConductor: 'dependiente' | 'independiente';
  metodo: MetodoPayout;
  estado: EstadoPayout;
  /** ID del payout en el proveedor saliente (Fintoc/banca). No es secreto. */
  payoutExternoId: string | null;
  /** Referencia opaca al comprobante en Storage — signed URL de vida corta en la app. */
  comprobanteRef: string | null;
  /** Descripción de error sin secretos (nunca API keys, tokens ni credenciales). */
  errorDescripcion: string | null;
  /** Actor humano que solicitó el payout (RNF-04). */
  solicitadoPorUsuarioId: string | null;
  solicitadoEn: string;
  confirmadoEn: string | null;
  creadoEn: string;
  actualizadoEn: string;
}

/**
 * Una fila de `dinero.eventos_conciliacion`.
 *
 * §1.1 P1 (jul 2026): dejó de ser un log append-only para ser una BANDEJA DE
 * EXCEPCIONES GESTIONABLE — estado mutable con categoría de negocio, acción
 * sugerida, asignación, SLA (`fechaLimite`) y bloqueo de acciones financieras.
 * Ver `conciliacion-clasificacion.ts` para la máquina de estados y los
 * mapeos de clasificación, y `acciones.ts` para las funciones de escritura
 * (`transicionarEventoConciliacion` y afines).
 *
 * F17 (Bloque 3): los detectores C7 añaden `driver_id` y `liquidacion_id`
 * para los eventos de tipo `pagado_conductor_sin_cobro_seller`,
 * `cobrado_seller_no_pagado_conductor` y `pago_conductor_faltante`, en los que
 * la discrepancia apunta a una liquidación o conductor específico.
 */
export interface EventoConciliacion {
  id: string;
  tenantId: string;
  sellerId: string | null;
  periodoCobroidId: string | null;
  tipoDiferencia: TipoDiferenciaConciliacion;
  pedidoId: string | null;
  descripcion: string;
  montoDiferenciaClp: number | null;
  estado: EstadoEventoConciliacion;
  /** "Cerrado en/por" — para CUALQUIERA de los 4 estados terminales (no solo el viejo `resuelto`). */
  resueltoPorUsuarioId: string | null;
  resueltaEn: string | null;
  /** ID del run de Inngest para trazabilidad. */
  jobRunId: string | null;
  /** F17: ID del conductor involucrado (solo eventos de pago a conductor). */
  driverId: string | null;
  /** F17: ID de la liquidación involucrada (solo eventos de pago a conductor). */
  liquidacionId: string | null;
  creadoEn: string;

  // ---------------------------------------------------------------------------
  // §1.1 P1 — bandeja de excepciones gestionable (migración 20260708000001).
  // ---------------------------------------------------------------------------
  categoriaNegocio: CategoriaNegocioConciliacion;
  accionSugerida: AccionSugeridaConciliacion;
  asignadoAUsuarioId: string | null;
  asignadoEn: string | null;
  asignadoPorUsuarioId: string | null;
  /** SLA — fecha límite de resolución ('YYYY-MM-DD', zona America/Santiago). Null en estados terminales. */
  fechaLimite: string | null;
  bloqueaFacturacion: boolean;
  bloqueaPago: boolean;
  /** Obligatorio (no vacío) cuando `bloqueaFacturacion` o `bloqueaPago` es true. */
  motivoBloqueo: string | null;
  /** jsonb con las fuentes/valores cruzados por el detector (trazabilidad) — forma libre. */
  fuentesComparadas: unknown;
  actualizadoEn: string;
}

/**
 * Una fila de `dinero.eventos_conciliacion_historial`.
 * Bitácora append-only de cambios de una excepción de conciliación: detección,
 * cambios de estado/asignación/SLA/bloqueo, acción sugerida y comentarios.
 */
export interface EventoConciliacionHistorial {
  id: string;
  tenantId: string;
  eventoId: string;
  tipoCambio: TipoCambioConciliacion;
  estadoAnterior: string | null;
  estadoNuevo: string | null;
  comentario: string | null;
  /** jsonb — forma libre según `tipoCambio` (p. ej. `{ asignado_a, asignado_a_anterior }`). */
  datos: unknown;
  actorUsuarioId: string | null;
  actorTipo: ActorTipoHistorial;
  creadoEn: string;
}

/**
 * Una fila de `dinero.config_periodos`.
 * Configuración del tipo de período de facturación por tenant o por seller.
 */
export interface ConfigPeriodo {
  id: string;
  tenantId: string;
  /** null = configuración por defecto del tenant (aplica a todos los sellers sin config propia). */
  sellerId: string | null;
  tipoPeriodo: TipoPeriodoFacturacion;
  /**
   * Para semanal: 1=lunes..7=domingo.
   * Para quincenal: 15.
   * Para mensual: null (último día del mes).
   */
  diaCierre: number | null;
  activa: boolean;
  creadoEn: string;
}
