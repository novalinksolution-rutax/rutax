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

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  PeriodoCobro,
  LineaCobro,
  LineaLiquidacion,
  DocumentoDte,
  Liquidacion,
  EventoConciliacion,
  EstadoPeriodo,
  EstadoEventoConciliacion,
  PagoRecibido,
  EstadoMatchPago,
  EstadoCobroPeriodo,
  EstadoSii,
  EstadoLiquidacion,
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
    fechaEntrega: f.fecha_entrega,
    incidenciaId: f.incidencia_id ?? null,
    origenGeneracion: f.origen_generacion,
    generadoPorUsuarioId: f.generado_por_usuario_id ?? null,
    notas: f.notas ?? null,
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
    pedidoId: f.pedido_id,
    liquidacionId: f.liquidacion_id ?? null,
    montoBaseClp: Number(f.monto_base_clp),
    ajusteIncidenciaClp: Number(f.ajuste_incidencia_clp ?? 0),
    montoFinalClp: Number(f.monto_final_clp),
    concepto: f.concepto,
    fechaEntrega: f.fecha_entrega,
    incidenciaId: f.incidencia_id ?? null,
    origenGeneracion: f.origen_generacion,
    generadoPorUsuarioId: f.generado_por_usuario_id ?? null,
    notas: f.notas ?? null,
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
 * Lista las líneas de cobro de un período específico.
 */
export async function listarLineasCobroPorPeriodo(
  cliente: SupabaseClient,
  tenantId: string,
  periodoId: string,
): Promise<LineaCobro[]> {
  const { data, error } = await cliente
    .schema('dinero')
    .from('lineas_cobro')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('periodo_cobro_id', periodoId)
    .order('fecha_entrega', { ascending: true });

  if (error) throw new Error(`Error al listar líneas de cobro: ${error.message}`);
  return (data ?? []).map(filaToLineaCobro);
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

  const { data: lineasData, error: lineasError } = await cliente
    .schema('dinero')
    .from('lineas_liquidacion')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('liquidacion_id', liquidacionId)
    .order('fecha_entrega', { ascending: true });

  if (lineasError) throw new Error(`Error al listar líneas de liquidación: ${lineasError.message}`);

  const lineas = (lineasData ?? []).map(filaToLineaLiquidacion);
  return { ...filaToLiquidacion(liqData), lineas };
}

// =============================================================================
// Conciliación
// =============================================================================

/**
 * Lista eventos de conciliación del tenant.
 * Solo para roles internos (dueño/administración) — RLS lo refuerza en BD.
 */
export async function listarEventosConciliacion(
  cliente: SupabaseClient,
  tenantId: string,
  estado?: EstadoEventoConciliacion,
): Promise<EventoConciliacion[]> {
  let query = cliente
    .schema('dinero')
    .from('eventos_conciliacion')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('creado_en', { ascending: false });

  if (estado) query = query.eq('estado', estado);

  const { data, error } = await query;

  if (error) throw new Error(`Error al listar eventos de conciliación: ${error.message}`);
  return (data ?? []).map(filaToEventoConciliacion);
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
 */
export async function listarPagosRecibidos(
  cliente: SupabaseClient,
  tenantId: string,
  estados?: EstadoMatchPago[],
): Promise<PagoRecibido[]> {
  let query = cliente
    .schema('dinero')
    .from('pagos_recibidos')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('fecha_movimiento', { ascending: false })
    .order('creado_en', { ascending: false });

  if (estados && estados.length > 0) query = query.in('estado_match', estados);

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
 * liquidación al conductor. Cada nodo puede no existir aún (lazo en curso).
 * Solo lectura; pensado para que un rol financiero/dueño *vea* la trazabilidad.
 */
export interface TrazaDineroPedido {
  cobro: { montoFinalClp: number } | null;
  periodo: { id: string; estado: EstadoPeriodo; estadoCobro: EstadoCobroPeriodo } | null;
  factura: { folio: number; estadoSii: EstadoSii } | null;
  liquidacion: { id: string; estado: EstadoLiquidacion; montoFinalClp: number } | null;
}

export async function obtenerTrazaDineroPorPedido(
  cliente: SupabaseClient,
  tenantId: string,
  pedidoId: string,
): Promise<TrazaDineroPedido> {
  // Línea de cobro y línea de liquidación del pedido (una por pedido, a lo sumo).
  const [cobroRes, liqLineaRes] = await Promise.all([
    cliente
      .schema('dinero')
      .from('lineas_cobro')
      .select('monto_final_clp, periodo_cobro_id')
      .eq('tenant_id', tenantId)
      .eq('pedido_id', pedidoId)
      .maybeSingle(),
    cliente
      .schema('dinero')
      .from('lineas_liquidacion')
      .select('monto_final_clp, liquidacion_id')
      .eq('tenant_id', tenantId)
      .eq('pedido_id', pedidoId)
      .maybeSingle(),
  ]);

  const cobroFila = cobroRes.data;
  const liqLineaFila = liqLineaRes.data;

  let periodo: TrazaDineroPedido['periodo'] = null;
  let factura: TrazaDineroPedido['factura'] = null;

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
  }

  let liquidacion: TrazaDineroPedido['liquidacion'] = null;
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
      };
    }
  }

  return {
    cobro: cobroFila ? { montoFinalClp: Number(cobroFila.monto_final_clp) } : null,
    periodo,
    factura,
    liquidacion,
  };
}
