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
  | 'pedido_entregado_sin_linea_cobro'
  | 'pedido_entregado_sin_linea_liquidacion'
  | 'linea_cobro_sin_pedido_entregado'
  | 'folio_consumido_sin_dte_persistido'
  | 'periodo_cerrado_con_lineas_sueltas'
  | 'monto_dte_difiere_de_lineas';

/** Estado de un evento de conciliación. */
export type EstadoEventoConciliacion =
  | 'pendiente'
  | 'revisado'
  | 'resuelto'
  | 'ignorado';

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
 * Una fila de `dinero.eventos_conciliacion`.
 * Log append-only de diferencias detectadas. No es una tabla de estado mutable.
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
  resueltoPorUsuarioId: string | null;
  resueltaEn: string | null;
  /** ID del run de Inngest para trazabilidad. */
  jobRunId: string | null;
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
