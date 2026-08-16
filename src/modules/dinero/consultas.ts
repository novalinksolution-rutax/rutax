/**
 * Consultas de lectura del módulo `dinero`.
 *
 * Estas funciones son usadas por Server Components del frontend para mostrar
 * períodos, líneas, DTE y liquidaciones. Todas operan dentro del tenant del
 * usuario (aislamiento garantizado por RLS en BD + el filtro explícito tenant_id
 * en la query como defensa en profundidad).
 *
 * Ninguna función aquí escribe en BD ni tiene side effects.
 */

import { leerTodasLasFilas } from '@/lib/supabase/leer-paginado';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  PeriodoCobro,
  LineaCobro,
  LineaLiquidacion,
  DocumentoDte,
  Liquidacion,
  EventoConciliacion,
  EventoConciliacionHistorial,
  EstadoPeriodo,
  EstadoEventoConciliacion,
  CategoriaNegocioConciliacion,
  PagoRecibido,
  EstadoMatchPago,
  EstadoCobroPeriodo,
  EstadoSii,
  EstadoLiquidacion,
  PayoutConductor,
} from './tipos';

// =============================================================================
// Mappers de fila BD → interfaz
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function filaToPeriodoCobro(f: Record<string, any>): PeriodoCobro {
  return {
    id: f.id,
    tenantId: f.tenant_id,
    sellerId: f.seller_id,
    fechaInicio: f.fecha_inicio,
    fechaFin: f.fecha_fin,
    tipoPeriodo: f.tipo_periodo,
    estado: f.estado,
    totalLineas: f.total_lineas ?? 0,
    montoTotalClp: f.monto_total_clp !== null ? Number(f.monto_total_clp) : null,
    documentoDteId: f.documento_dte_id ?? null,
    cerradoEn: f.cerrado_en ?? null,
    cerradoPorUsuarioId: f.cerrado_por_usuario_id ?? null,
    estadoCobro: f.estado_cobro ?? 'no_aplica',
    montoPagadoClp: f.monto_pagado_clp !== null && f.monto_pagado_clp !== undefined ? Number(f.monto_pagado_clp) : 0,
    pagadoEn: f.pagado_en ?? null,
    motivoAnulacion: f.motivo_anulacion ?? null,
    anuladoEn: f.anulado_en ?? null,
    creadoEn: f.creado_en,
    actualizadoEn: f.actualizado_en,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function filaToLineaCobro(f: Record<string, any>): LineaCobro {
  return {
    id: f.id,
    tenantId: f.tenant_id,
    sellerId: f.seller_id,
    pedidoId: f.pedido_id,
    periodoCobroidId: f.periodo_cobro_id ?? null,
    tarifaId: f.tarifa_id,
    montoBaseClp: Number(f.monto_base_clp),
    ajusteIncidenciaClp: Number(f.ajuste_incidencia_clp ?? 0),
    montoFinalClp: Number(f.monto_final_clp),
    concepto: f.concepto,
    tipoPedido: f.tipo_pedido,
    fechaHecho: f.fecha_hecho,
    incidenciaId: f.incidencia_id ?? null,
    origenGeneracion: f.origen_generacion,
    generadoPorUsuarioId: f.generado_por_usuario_id ?? null,
    notas: f.notas ?? null,
    snapshotRegla: f.snapshot_regla ?? null,
    anulada: f.anulada ?? false,
    anuladaEn: f.anulada_en ?? null,
    motivoAnulacion: f.motivo_anulacion ?? null,
    creadoEn: f.creado_en,
    actualizadoEn: f.actualizado_en,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function filaToLineaLiquidacion(f: Record<string, any>): LineaLiquidacion {
  return {
    id: f.id,
    tenantId: f.tenant_id,
    driverId: f.driver_id,
    // `?? null` y no pass-through: PostgREST devuelve `null` pero un `undefined`
    // por una columna no seleccionada se propagaría como si fuera "sin pedido",
    // que ahora es un estado con significado propio.
    pedidoId: f.pedido_id ?? null,
    sesionRetiroId: f.sesion_retiro_id ?? null,
    // Sin default 'entrega': si la columna no viene, es que la consulta no la
    // pidió, y adivinar acá haría que una línea de retiro se contara como
    // entrega en silencio — justo el error que el discriminador viene a evitar.
    tipoHecho: f.tipo_hecho,
    liquidacionId: f.liquidacion_id ?? null,
    montoBaseClp: Number(f.monto_base_clp),
    ajusteIncidenciaClp: Number(f.ajuste_incidencia_clp ?? 0),
    montoFinalClp: Number(f.monto_final_clp),
    concepto: f.concepto,
    fechaHecho: f.fecha_hecho,
    incidenciaId: f.incidencia_id ?? null,
    origenGeneracion: f.origen_generacion,
    generadoPorUsuarioId: f.generado_por_usuario_id ?? null,
    notas: f.notas ?? null,
    snapshotRegla: f.snapshot_regla ?? null,
    creadoEn: f.creado_en,
    actualizadoEn: f.actualizado_en,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function filaToDocumentoDte(f: Record<string, any>): DocumentoDte {
  return {
    id: f.id,
    tenantId: f.tenant_id,
    sellerId: f.seller_id,
    periodoCobroidId: f.periodo_cobro_id,
    tipoDocumento: f.tipo_documento as 33 | 61,
    folio: f.folio,
    fechaEmision: f.fecha_emision,
    montoNetoclp: Number(f.monto_neto_clp),
    montoIvaClp: Number(f.monto_iva_clp),
    montoTotalClp: Number(f.monto_total_clp),
    xmlDteRef: f.xml_dte_ref ?? null,
    pdfRef: f.pdf_ref ?? null,
    proveedorDteIdExterno: f.proveedor_dte_id_externo ?? null,
    estadoSii: f.estado_sii,
    estadoProveedor: f.estado_proveedor,
    errorDescripcion: f.error_descripcion ?? null,
    dteReferenciaId: f.dte_referencia_id ?? null,
    emitidoEn: f.emitido_en,
    creadoEn: f.creado_en,
    actualizadoEn: f.actualizado_en,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function filaToLiquidacion(f: Record<string, any>): Liquidacion {
  return {
    id: f.id,
    tenantId: f.tenant_id,
    driverId: f.driver_id,
    fechaInicio: f.fecha_inicio,
    fechaFin: f.fecha_fin,
    tipoPeriodo: f.tipo_periodo,
    estado: f.estado,
    totalEntregas: f.total_entregas ?? 0,
    montoTotalClp: f.monto_total_clp !== null ? Number(f.monto_total_clp) : null,
    bonoClp: Number(f.bono_clp ?? 0),
    penalizacionClp: Number(f.penalizacion_clp ?? 0),
    notaAjuste: f.nota_ajuste ?? null,
    tipoRelacionConductor: f.tipo_relacion_conductor,
    pdfRef: f.pdf_ref ?? null,
    notas: f.notas ?? null,
    generadoEn: f.generado_en ?? null,
    generadoPorUsuarioId: f.generado_por_usuario_id ?? null,
    creadoEn: f.creado_en,
    actualizadoEn: f.actualizado_en,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function filaToPayoutConductor(f: Record<string, any>): PayoutConductor {
  return {
    id: f.id,
    tenantId: f.tenant_id,
    driverId: f.driver_id,
    liquidacionId: f.liquidacion_id,
    montoBrutoClp: Number(f.monto_bruto_clp),
    montoRetencionClp: Number(f.monto_retencion_clp ?? 0),
    montoLiquidoClp: Number(f.monto_liquido_clp),
    tipoRelacionConductor: f.tipo_relacion_conductor,
    metodo: f.metodo,
    estado: f.estado,
    payoutExternoId: f.payout_externo_id ?? null,
    comprobanteRef: f.comprobante_ref ?? null,
    errorDescripcion: f.error_descripcion ?? null,
    solicitadoPorUsuarioId: f.solicitado_por_usuario_id ?? null,
    solicitadoEn: f.solicitado_en,
    confirmadoEn: f.confirmado_en ?? null,
    creadoEn: f.creado_en,
    actualizadoEn: f.actualizado_en,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function filaToEventoConciliacion(f: Record<string, any>): EventoConciliacion {
  return {
    id: f.id,
    tenantId: f.tenant_id,
    sellerId: f.seller_id ?? null,
    periodoCobroidId: f.periodo_cobro_id ?? null,
    tipoDiferencia: f.tipo_diferencia,
    pedidoId: f.pedido_id ?? null,
    descripcion: f.descripcion,
    montoDiferenciaClp: f.monto_diferencia_clp !== null ? Number(f.monto_diferencia_clp) : null,
    estado: f.estado,
    resueltoPorUsuarioId: f.resuelto_por_usuario_id ?? null,
    resueltaEn: f.resuelto_en ?? null,
    jobRunId: f.job_run_id ?? null,
    // F17: campos del detector C7 para eventos de pago a conductor.
    driverId: f.driver_id ?? null,
    liquidacionId: f.liquidacion_id ?? null,
    creadoEn: f.creado_en,
    // §1.1 P1 — bandeja de excepciones gestionable.
    categoriaNegocio: f.categoria_negocio,
    accionSugerida: f.accion_sugerida,
    asignadoAUsuarioId: f.asignado_a_usuario_id ?? null,
    asignadoEn: f.asignado_en ?? null,
    asignadoPorUsuarioId: f.asignado_por_usuario_id ?? null,
    fechaLimite: f.fecha_limite ?? null,
    bloqueaFacturacion: f.bloquea_facturacion ?? false,
    bloqueaPago: f.bloquea_pago ?? false,
    motivoBloqueo: f.motivo_bloqueo ?? null,
    fuentesComparadas: f.fuentes_comparadas ?? null,
    actualizadoEn: f.actualizado_en,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function filaToEventoConciliacionHistorial(f: Record<string, any>): EventoConciliacionHistorial {
  return {
    id: f.id,
    tenantId: f.tenant_id,
    eventoId: f.evento_id,
    tipoCambio: f.tipo_cambio,
    estadoAnterior: f.estado_anterior ?? null,
    estadoNuevo: f.estado_nuevo ?? null,
    comentario: f.comentario ?? null,
    datos: f.datos ?? {},
    actorUsuarioId: f.actor_usuario_id ?? null,
    actorTipo: f.actor_tipo,
    creadoEn: f.creado_en,
  };
}

// =============================================================================
// Períodos de cobro
// =============================================================================

/**
 * Lista períodos de cobro del tenant (con filtros opcionales de seller y estado).
 * Para el dueño/administración: todos los períodos del tenant.
 * Para el seller: solo los suyos (RLS lo refuerza en BD; aquí también filtramos).
 */
export async function listarPeriodosCobro(
  cliente: SupabaseClient,
  tenantId: string,
  sellerId?: string,
  estado?: EstadoPeriodo,
): Promise<PeriodoCobro[]> {
  let query = cliente
    .schema('dinero')
    .from('periodos_cobro')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('fecha_inicio', { ascending: false });

  if (sellerId) query = query.eq('seller_id', sellerId);
  if (estado) query = query.eq('estado', estado);

  const { data, error } = await query;

  if (error) throw new Error(`Error al listar períodos de cobro: ${error.message}`);
  return (data ?? []).map(filaToPeriodoCobro);
}

/**
 * Obtiene un período de cobro con sus líneas incluidas.
 */
export async function obtenerPeriodoCobro(
  cliente: SupabaseClient,
  tenantId: string,
  periodoId: string,
): Promise<(PeriodoCobro & { lineas: LineaCobro[] }) | null> {
  const { data: periodoData, error: periodoError } = await cliente
    .schema('dinero')
    .from('periodos_cobro')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', periodoId)
    .maybeSingle();

  if (periodoError) throw new Error(`Error al obtener período: ${periodoError.message}`);
  if (!periodoData) return null;

  const lineas = await listarLineasCobroPorPeriodo(cliente, tenantId, periodoId);

  return { ...filaToPeriodoCobro(periodoData), lineas };
}

/**
 * Lista las líneas de cobro VIGENTES (no anuladas) de un período específico.
 * Las líneas anuladas (`anulada = true`) corresponden a pedidos devueltos tras
 * haber fallado; se excluyen de los totales y de la vista del período para que
 * el monto mostrado al usuario coincida con lo que se facturará al seller.
 *
 * Para ver las anuladas con fines de auditoría, usar la consulta directa a BD
 * con service_role (fuera del portal del seller y del módulo de facturación).
 */
export async function listarLineasCobroPorPeriodo(
  cliente: SupabaseClient,
  tenantId: string,
  periodoId: string,
): Promise<LineaCobro[]> {
  // ⚠️ PAGINADO OBLIGATORIO. Es la lista con la que el courier revisa el período
  // antes de facturarlo: sin paginar, PostgREST corta en `max_rows` (1000) sin
  // error y tanto el listado como cualquier total derivado salen incompletos.
  // Medido con 1.365 líneas: mostraba $3.420.800 de $4.681.000 reales.
  const data = await leerTodasLasFilas<Record<string, unknown>>(
    `líneas de cobro del período ${periodoId}`,
    (desde, hasta) =>
      cliente
        .schema('dinero')
        .from('lineas_cobro')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('periodo_cobro_id', periodoId)
        .eq('anulada', false)
        .order('fecha_hecho', { ascending: true })
        .order('id')
        .range(desde, hasta),
  );

  return data.map(filaToLineaCobro);
}

// =============================================================================
// Documentos DTE
// =============================================================================

/**
 * Lista documentos DTE del tenant. Opcionalmente filtrado por seller.
 */
export async function listarDocumentosDte(
  cliente: SupabaseClient,
  tenantId: string,
  sellerId?: string,
): Promise<DocumentoDte[]> {
  let query = cliente
    .schema('dinero')
    .from('documentos_dte')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('fecha_emision', { ascending: false });

  if (sellerId) query = query.eq('seller_id', sellerId);

  const { data, error } = await query;

  if (error) throw new Error(`Error al listar documentos DTE: ${error.message}`);
  return (data ?? []).map(filaToDocumentoDte);
}

// =============================================================================
// Liquidaciones
// =============================================================================

/**
 * Lista liquidaciones del tenant. Opcionalmente filtrado por conductor.
 * Para el dueño/administración: todas del tenant.
 * Para el conductor: solo las suyas (RLS lo refuerza en BD).
 */
export async function listarLiquidaciones(
  cliente: SupabaseClient,
  tenantId: string,
  driverId?: string,
): Promise<Liquidacion[]> {
  let query = cliente
    .schema('dinero')
    .from('liquidaciones')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('fecha_inicio', { ascending: false });

  if (driverId) query = query.eq('driver_id', driverId);

  const { data, error } = await query;

  if (error) throw new Error(`Error al listar liquidaciones: ${error.message}`);
  return (data ?? []).map(filaToLiquidacion);
}

/**
 * Obtiene una liquidación con sus líneas de liquidación incluidas.
 */
export async function obtenerLiquidacion(
  cliente: SupabaseClient,
  tenantId: string,
  liquidacionId: string,
): Promise<(Liquidacion & { lineas: LineaLiquidacion[] }) | null> {
  const { data: liqData, error: liqError } = await cliente
    .schema('dinero')
    .from('liquidaciones')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', liquidacionId)
    .maybeSingle();

  if (liqError) throw new Error(`Error al obtener liquidación: ${liqError.message}`);
  if (!liqData) return null;

  // Filtrar anuladas: líneas de pedidos devueltos tras fallido no deben mostrarse
  // ni sumarse al total de la liquidación del conductor.
  // ⚠️ PAGINADO OBLIGATORIO — es el detalle que el conductor abre para revisar lo
  // que se le paga. Sin paginar, PostgREST corta en `max_rows` (1000) sin error y
  // el conductor vería su liquidación incompleta, sin ninguna señal de que falta.
  const lineasData = await leerTodasLasFilas<Record<string, unknown>>(
    `líneas de la liquidación ${liquidacionId}`,
    (desde, hasta) =>
      cliente
        .schema('dinero')
        .from('lineas_liquidacion')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('liquidacion_id', liquidacionId)
        .eq('anulada', false)
        .order('fecha_hecho', { ascending: true })
        .order('id')
        .range(desde, hasta),
  );

  const lineas = lineasData.map(filaToLineaLiquidacion);
  return { ...filaToLiquidacion(liqData), lineas };
}

// =============================================================================
// Conciliación
// =============================================================================

/** Filtros opcionales adicionales de `listarEventosConciliacion` (§1.1 P1 — bandeja de excepciones). */
export interface FiltrosEventosConciliacion {
  categoria?: CategoriaNegocioConciliacion;
  /** UUID del usuario asignado (`asignado_a_usuario_id`). */
  asignadoA?: string;
  /** `true` = solo eventos con `bloquea_facturacion` o `bloquea_pago` en true; `false` = solo sin bloqueo. */
  bloqueado?: boolean;
  /** Lista de estados (OR) — complementa (no reemplaza) el parámetro posicional `estado`. */
  estados?: EstadoEventoConciliacion[];
}

/**
 * Lista eventos de conciliación del tenant.
 * Solo para roles internos (dueño/administración) — RLS lo refuerza en BD.
 *
 * `pedidoId` (opcional, al final para no romper callers existentes) filtra
 * a los eventos que apuntan a un pedido específico — usado por la traza
 * pedido→dinero (`obtenerTrazaDineroPorPedido`) y por el filtro `?pedido=`
 * de la pantalla de conciliación.
 *
 * `filtros` (§1.1 P1, opcional al final para no romper callers existentes)
 * agrega los filtros propios de la bandeja de excepciones: categoría de
 * negocio, asignado a, bloqueo activo, o una lista de estados.
 */
export async function listarEventosConciliacion(
  cliente: SupabaseClient,
  tenantId: string,
  estado?: EstadoEventoConciliacion,
  pedidoId?: string,
  filtros?: FiltrosEventosConciliacion,
): Promise<EventoConciliacion[]> {
  let query = cliente
    .schema('dinero')
    .from('eventos_conciliacion')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('creado_en', { ascending: false });

  if (estado) query = query.eq('estado', estado);
  if (pedidoId) query = query.eq('pedido_id', pedidoId);
  if (filtros?.categoria) query = query.eq('categoria_negocio', filtros.categoria);
  if (filtros?.asignadoA) query = query.eq('asignado_a_usuario_id', filtros.asignadoA);
  if (filtros?.bloqueado === true) query = query.or('bloquea_facturacion.eq.true,bloquea_pago.eq.true');
  if (filtros?.bloqueado === false) query = query.eq('bloquea_facturacion', false).eq('bloquea_pago', false);
  if (filtros?.estados && filtros.estados.length > 0) query = query.in('estado', filtros.estados);

  const { data, error } = await query;

  if (error) throw new Error(`Error al listar eventos de conciliación: ${error.message}`);
  return (data ?? []).map(filaToEventoConciliacion);
}

/**
 * Lista el historial (append-only) de una excepción de conciliación, ordenado
 * cronológicamente (`creado_en asc`) — para la vista de detalle/timeline de la
 * bandeja. Solo para roles internos (dueño/administración) — RLS lo refuerza.
 */
export async function listarHistorialEventoConciliacion(
  cliente: SupabaseClient,
  tenantId: string,
  eventoId: string,
): Promise<EventoConciliacionHistorial[]> {
  const { data, error } = await cliente
    .schema('dinero')
    .from('eventos_conciliacion_historial')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('evento_id', eventoId)
    .order('creado_en', { ascending: true });

  if (error) throw new Error(`Error al listar historial del evento de conciliación: ${error.message}`);
  return (data ?? []).map(filaToEventoConciliacionHistorial);
}

// =============================================================================
// Pagos recibidos (cobranza Fintoc — capa "pagado")
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function filaToPagoRecibido(f: Record<string, any>): PagoRecibido {
  return {
    id: f.id,
    tenantId: f.tenant_id,
    sellerId: f.seller_id ?? null,
    periodoCobroId: f.periodo_cobro_id ?? null,
    movimientoExternoId: f.movimiento_externo_id,
    montoClp: Number(f.monto_clp),
    fechaMovimiento: f.fecha_movimiento,
    contraparteRutNormalizado: f.contraparte_rut_normalizado ?? null,
    contraparteNombre: f.contraparte_nombre ?? null,
    estadoMatch: f.estado_match,
    atribuidoPorUsuarioId: f.atribuido_por_usuario_id ?? null,
    atribuidoEn: f.atribuido_en ?? null,
    creadoEn: f.creado_en,
    actualizadoEn: f.actualizado_en,
  };
}

/**
 * Lista los pagos recibidos del tenant para la bandeja de revisión de cobranza.
 * Opcionalmente filtra por uno o varios estados de match.
 *
 * Solo para roles internos (la RLS de `pagos_recibidos` lo refuerza en BD; el
 * filtro `tenant_id` es defensa en profundidad). Ordena por fecha de movimiento
 * descendente (lo más reciente primero).
 *
 * `periodoId` (opcional, al final para no romper callers existentes) filtra a
 * los pagos imputados a un período de cobro específico — usado por la traza
 * pedido→dinero (`obtenerTrazaDineroPorPedido`).
 */
export async function listarPagosRecibidos(
  cliente: SupabaseClient,
  tenantId: string,
  estados?: EstadoMatchPago[],
  periodoId?: string,
): Promise<PagoRecibido[]> {
  let query = cliente
    .schema('dinero')
    .from('pagos_recibidos')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('fecha_movimiento', { ascending: false })
    .order('creado_en', { ascending: false });

  if (estados && estados.length > 0) query = query.in('estado_match', estados);
  if (periodoId) query = query.eq('periodo_cobro_id', periodoId);

  const { data, error } = await query;

  if (error) throw new Error(`Error al listar pagos recibidos: ${error.message}`);
  return (data ?? []).map(filaToPagoRecibido);
}

// =============================================================================
// Traza del lazo entrega→dinero (para el detalle de pedido — UX-1)
// =============================================================================

/**
 * Estado del lazo entrega→dinero de un pedido: su línea de cobro al seller, el
 * período/factura donde aterrizó y su estado de pago, más su línea de
 * liquidación al conductor y el payout que la salda. Cada nodo puede no
 * existir aún (lazo en curso). Solo lectura; pensado para que un rol
 * financiero/dueño *vea* la trazabilidad completa (RF, ítem 1.1 P1 del audit).
 */
export interface TrazaDineroPedido {
  cobro: {
    montoFinalClp: number;
    /** Copia congelada de la tarifa/regla aplicada — ver `LineaCobro.snapshotRegla`. */
    snapshotRegla: unknown;
    anulada: boolean;
    motivoAnulacion: string | null;
  } | null;
  periodo: { id: string; estado: EstadoPeriodo; estadoCobro: EstadoCobroPeriodo } | null;
  factura: { folio: number; estadoSii: EstadoSii } | null;
  liquidacion: {
    id: string;
    estado: EstadoLiquidacion;
    montoFinalClp: number;
    snapshotRegla: unknown;
    anulada: boolean;
    motivoAnulacion: string | null;
  } | null;
  /** Pagos (Fintoc) imputados al período de cobro de este pedido. Vacío si el pedido aún no tiene período o no hay pagos. */
  pagosRecibidos: PagoRecibido[];
  conciliacion: {
    /**
     * true si el motor de conciliación ya tuvo oportunidad de evaluar este
     * pedido: hay al menos un evento propio, o su período ya salió de
     * `abierto` (lo que dispara C6 al cerrar, y dentro del alcance del cron
     * diario C7). Si es false, "sin discrepancias" todavía no es una garantía
     * — simplemente no se ha evaluado. Decisión de diseño: no existe una
     * tabla de "corridas de conciliación" separada del log de diferencias,
     * así que se infiere de estas dos señales.
     */
    evaluada: boolean;
    eventos: EventoConciliacion[];
  };
  /** Payout (transferencia saliente) que salda la liquidación de este pedido, si existe. */
  payout: PayoutConductor | null;
}

export async function obtenerTrazaDineroPorPedido(
  cliente: SupabaseClient,
  tenantId: string,
  pedidoId: string,
): Promise<TrazaDineroPedido> {
  // Línea de cobro y línea de liquidación del pedido (una por pedido, a lo sumo),
  // más los eventos de conciliación que apuntan directamente a este pedido —
  // estos tres no dependen entre sí, se piden en paralelo.
  const [cobroRes, liqLineaRes, eventosConciliacion] = await Promise.all([
    cliente
      .schema('dinero')
      .from('lineas_cobro')
      .select('monto_final_clp, periodo_cobro_id, snapshot_regla, anulada, motivo_anulacion')
      .eq('tenant_id', tenantId)
      .eq('pedido_id', pedidoId)
      .maybeSingle(),
    cliente
      .schema('dinero')
      .from('lineas_liquidacion')
      .select('monto_final_clp, liquidacion_id, snapshot_regla, anulada, motivo_anulacion')
      .eq('tenant_id', tenantId)
      .eq('pedido_id', pedidoId)
      .maybeSingle(),
    listarEventosConciliacion(cliente, tenantId, undefined, pedidoId),
  ]);

  const cobroFila = cobroRes.data;
  const liqLineaFila = liqLineaRes.data;

  let periodo: TrazaDineroPedido['periodo'] = null;
  let factura: TrazaDineroPedido['factura'] = null;
  let pagosRecibidos: PagoRecibido[] = [];

  if (cobroFila?.periodo_cobro_id) {
    const { data: pf } = await cliente
      .schema('dinero')
      .from('periodos_cobro')
      .select('id, estado, estado_cobro, documento_dte_id')
      .eq('tenant_id', tenantId)
      .eq('id', cobroFila.periodo_cobro_id)
      .maybeSingle();

    if (pf) {
      periodo = { id: pf.id, estado: pf.estado, estadoCobro: pf.estado_cobro };

      if (pf.documento_dte_id) {
        const { data: df } = await cliente
          .schema('dinero')
          .from('documentos_dte')
          .select('folio, estado_sii, tipo_documento')
          .eq('tenant_id', tenantId)
          .eq('id', pf.documento_dte_id)
          .maybeSingle();

        if (df && df.tipo_documento === 33) {
          factura = { folio: df.folio, estadoSii: df.estado_sii };
        }
      }
    }

    pagosRecibidos = await listarPagosRecibidos(cliente, tenantId, undefined, cobroFila.periodo_cobro_id);
  }

  let liquidacion: TrazaDineroPedido['liquidacion'] = null;
  let payout: PayoutConductor | null = null;

  if (liqLineaFila?.liquidacion_id) {
    const { data: lf } = await cliente
      .schema('dinero')
      .from('liquidaciones')
      .select('id, estado')
      .eq('tenant_id', tenantId)
      .eq('id', liqLineaFila.liquidacion_id)
      .maybeSingle();

    if (lf) {
      liquidacion = {
        id: lf.id,
        estado: lf.estado,
        montoFinalClp: Number(liqLineaFila.monto_final_clp),
        snapshotRegla: liqLineaFila.snapshot_regla ?? null,
        anulada: liqLineaFila.anulada ?? false,
        motivoAnulacion: liqLineaFila.motivo_anulacion ?? null,
      };
    }

    payout = await obtenerPayoutPorLiquidacion(cliente, tenantId, liqLineaFila.liquidacion_id);
  }

  // Ver el comentario de diseño en `TrazaDineroPedido['conciliacion']`.
  const conciliacionEvaluada =
    eventosConciliacion.length > 0 || (periodo !== null && periodo.estado !== 'abierto');

  return {
    cobro: cobroFila
      ? {
          montoFinalClp: Number(cobroFila.monto_final_clp),
          snapshotRegla: cobroFila.snapshot_regla ?? null,
          anulada: cobroFila.anulada ?? false,
          motivoAnulacion: cobroFila.motivo_anulacion ?? null,
        }
      : null,
    periodo,
    factura,
    liquidacion,
    pagosRecibidos,
    conciliacion: { evaluada: conciliacionEvaluada, eventos: eventosConciliacion },
    payout,
  };
}

/**
 * Obtiene el payout (transferencia saliente) que salda una liquidación, si
 * ya existe uno. `UNIQUE (tenant_id, liquidacion_id)` en `dinero.payouts_conductor`
 * (migración 20260613000011) garantiza a lo sumo una fila — es la barrera de
 * doble-pago del motor de payouts (F19).
 */
export async function obtenerPayoutPorLiquidacion(
  cliente: SupabaseClient,
  tenantId: string,
  liquidacionId: string,
): Promise<PayoutConductor | null> {
  const { data, error } = await cliente
    .schema('dinero')
    .from('payouts_conductor')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('liquidacion_id', liquidacionId)
    .maybeSingle();

  if (error) throw new Error(`Error al obtener el payout de la liquidación: ${error.message}`);
  if (!data) return null;
  return filaToPayoutConductor(data);
}
