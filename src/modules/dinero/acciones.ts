/**
 * Server Actions del módulo `dinero`.
 *
 * Estas acciones son llamadas desde Server Components o Route Handlers del
 * frontend. Todas:
 * - Verifican RBAC antes de actuar.
 * - Registran en bitácora de auditoría (toda acción financiera — RF-004).
 * - Usan el cliente service_role (bypass RLS) porque escriben en tablas que
 *   solo admiten escritura desde service_role.
 * - Operan dentro del tenant del usuario (aislamiento garantizado).
 *
 * No se llaman APIs externas aquí — la emisión del DTE ocurre en el job C3
 * disparado por el evento `dinero/periodo.cerrado`.
 */

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { inngest } from '@/lib/inngest/cliente';
import {
  puedeEmitirFacturas,
  puedeGestionarLiquidacionesConductores,
  puedeVerConciliacion,
} from '@/modules/identidad/capacidades';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import { ErrorValidacion } from '@/modules/identidad/errores';
import type { UsuarioActual } from '@/modules/identidad/usuario-actual';
import type { EstadoEventoConciliacion } from './tipos';
import { conciliarPagoPersistido } from './aplicar-pago';
import { esEstadoTerminal } from './matching-pago';

// =============================================================================
// cerrarPeriodoManualmente
// =============================================================================

/**
 * Cierra un período de cobro manualmente.
 *
 * Precondiciones:
 * - El usuario debe tener capacidad `emitir_facturas` (dueño o administración).
 * - El período debe estar en estado `abierto`.
 *
 * Efectos:
 * - Suma lineas_cobro, cuenta filas, actualiza estado a `cerrado`.
 * - Publica evento `dinero/periodo.cerrado` → dispara SOLO C6 (conciliación).
 *   El cierre NO emite el DTE: para facturar hay que llamar después a
 *   `emitirFacturaPeriodo` (compuerta de aprobación humana, B1-1).
 * - Registra en bitácora con el autor (`actorUsuarioId`).
 *
 * @param actorUsuarioId UUID de auth del usuario que ejecuta la acción
 *   (`sesion.usuarioId`). Queda en la bitácora y en `cerrado_por_usuario_id`
 *   — RNF-04 exige registrar "quién".
 */
export async function cerrarPeriodoManualmente(
  tenantId: string,
  periodoId: string,
  usuario: UsuarioActual,
  actorUsuarioId: string,
): Promise<void> {
  if (!puedeEmitirFacturas(usuario)) {
    throw new ErrorValidacion(
      'Solo el dueño o administración puede cerrar períodos de facturación manualmente.',
    );
  }

  const supabase = crearClienteServiceRole();

  // Leer el período y verificar que pertenece al tenant y está abierto.
  const { data: periodo, error: errorLectura } = await supabase
    .schema('dinero')
    .from('periodos_cobro')
    .select('id, tenant_id, seller_id, fecha_inicio, fecha_fin, estado')
    .eq('id', periodoId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (errorLectura) throw new Error(`Error al leer período: ${errorLectura.message}`);
  if (!periodo) throw new ErrorValidacion(`Período ${periodoId} no encontrado en el tenant.`);
  if (periodo.estado !== 'abierto') {
    throw new ErrorValidacion(`El período ya está en estado '${periodo.estado}' — solo se pueden cerrar períodos abiertos.`);
  }

  // Calcular totales desde las líneas de cobro.
  const { data: totalesData, error: errorTotales } = await supabase
    .schema('dinero')
    .from('lineas_cobro')
    .select('monto_final_clp')
    .eq('tenant_id', tenantId)
    .eq('periodo_cobro_id', periodoId);

  if (errorTotales) throw new Error(`Error al calcular totales: ${errorTotales.message}`);

  const lineas = totalesData ?? [];
  const totalLineas = lineas.length;
  const montoTotal = lineas.reduce((acc, l) => acc + Math.round(Number(l.monto_final_clp)), 0);

  // Actualizar período a cerrado.
  const { error: errorUpdate } = await supabase
    .schema('dinero')
    .from('periodos_cobro')
    .update({
      estado: 'cerrado',
      total_lineas: totalLineas,
      monto_total_clp: montoTotal,
      cerrado_en: new Date().toISOString(),
      // RNF-04: registramos quién cerró el período. `actorUsuarioId` es el UUID
      // de auth (`sesion.usuarioId`) que el llamador (Server Action) propaga.
      cerrado_por_usuario_id: actorUsuarioId,
      actualizado_en: new Date().toISOString(),
    })
    .eq('id', periodoId)
    .eq('tenant_id', tenantId)
    .eq('estado', 'abierto'); // guarda adicional a nivel BD

  if (errorUpdate) throw new Error(`Error al cerrar período: ${errorUpdate.message}`);

  // Bitácora — se registra ANTES de publicar el evento para que la acción
  // financiera quede auditada aunque `inngest.send` falle.
  await registrarEnBitacora(supabase, {
    tenantId,
    actorUsuarioId,
    actorTipo: 'usuario',
    accion: 'dinero.periodo_cerrado_manual',
    entidadTipo: 'periodo_cobro',
    entidadId: periodoId,
    detalle: {
      total_lineas: totalLineas,
      monto_total_clp: montoTotal,
      seller_id: periodo.seller_id,
    },
  });

  // Publicar evento para C6 (conciliación) — después de la bitácora para que la
  // acción financiera quede auditada aunque esto falle. NO dispara la emisión
  // del DTE: cerrar ≠ facturar. La emisión exige `emitirFacturaPeriodo` (B1-1).
  await inngest.send({
    name: 'dinero/periodo.cerrado',
    id: `periodo-cerrado-manual-${periodoId}`,
    data: {
      periodoCobroidId: periodoId,
      tenantId,
      sellerId: periodo.seller_id,
      fechaInicio: periodo.fecha_inicio as string,
      fechaFin: periodo.fecha_fin as string,
      montoTotalClp: montoTotal,
    },
  });
}

// =============================================================================
// emitirFacturaPeriodo — COMPUERTA DE APROBACIÓN DE FACTURACIÓN (B1-1)
// =============================================================================

/**
 * Solicita la emisión del DTE de un período YA cerrado. Es la compuerta de
 * aprobación humana del motor entrega→dinero: ningún proceso automático (el
 * cron `cerrar-periodo`) emite un DTE; solo esta acción, disparada por una
 * persona con permiso de facturación, publica el evento que activa C3.
 *
 * Por qué existe: un DTE emitido al SII es irreversible sin nota de crédito
 * (RF-038, fuera del MVP). El levantamiento le da al dueño la acción "aprobar
 * facturación" y exige "previsualización antes de facturar". Auto-emitir en un
 * cron violaría ambas y convertiría un error de tarifa en un problema
 * tributario real del courier.
 *
 * Precondiciones:
 * - Capacidad `emitir_facturas` (dueño o administración).
 * - El período debe estar en estado `cerrado` (no `abierto`, no `facturado`).
 * - Para emisión REAL (no sandbox): el courier debe tener habilitada
 *   explícitamente `emision_dte_real_habilitada` en su config DTE (opt-in).
 *
 * Efectos:
 * - Registra en bitácora (`dinero.emision_dte_solicitada`, con autor).
 * - Publica `dinero/periodo.emision-solicitada` → dispara C3 (emitirDtePeriodo).
 */
export async function emitirFacturaPeriodo(
  tenantId: string,
  periodoId: string,
  usuario: UsuarioActual,
  actorUsuarioId: string,
): Promise<void> {
  if (!puedeEmitirFacturas(usuario)) {
    throw new ErrorValidacion(
      'Solo el dueño o administración puede emitir facturas (DTE).',
    );
  }

  const supabase = crearClienteServiceRole();

  // Leer el período y verificar tenant + estado.
  const { data: periodo, error: errorLectura } = await supabase
    .schema('dinero')
    .from('periodos_cobro')
    .select('id, tenant_id, seller_id, fecha_inicio, fecha_fin, estado, monto_total_clp, documento_dte_id')
    .eq('id', periodoId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (errorLectura) throw new Error(`Error al leer período: ${errorLectura.message}`);
  if (!periodo) throw new ErrorValidacion(`Período ${periodoId} no encontrado en el tenant.`);

  if (periodo.estado === 'facturado' || periodo.documento_dte_id) {
    throw new ErrorValidacion('El período ya fue facturado — no se puede re-emitir su DTE.');
  }
  if (periodo.estado !== 'cerrado') {
    throw new ErrorValidacion(
      `Solo se puede facturar un período en estado 'cerrado'. Estado actual: '${periodo.estado}'. ` +
        'Cierra el período y revísalo antes de emitir la factura.',
    );
  }

  // Resolver el modo de emisión. Por defecto SANDBOX (stub, sin SII real):
  // la emisión real exige opt-in explícito por courier — defensa en
  // profundidad sobre el switch de entorno `DTE_SANDBOX_MODE`.
  const sandbox = process.env.DTE_SANDBOX_MODE !== 'false';
  const modo: 'sandbox' | 'real' = sandbox ? 'sandbox' : 'real';

  if (modo === 'real') {
    const { data: config } = await supabase
      .schema('identidad')
      .from('courier_config_dte')
      .select('emision_dte_real_habilitada')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (!config?.emision_dte_real_habilitada) {
      throw new ErrorValidacion(
        'La emisión real de DTE no está habilitada para este courier. ' +
          'Actívala explícitamente en la configuración antes de facturar al SII.',
      );
    }
  }

  const montoTotal = Math.round(Number(periodo.monto_total_clp ?? 0));

  // Bitácora ANTES de publicar el evento (acción financiera auditada aunque
  // `inngest.send` falle).
  await registrarEnBitacora(supabase, {
    tenantId,
    actorUsuarioId,
    actorTipo: 'usuario',
    accion: 'dinero.emision_dte_solicitada',
    entidadTipo: 'periodo_cobro',
    entidadId: periodoId,
    detalle: {
      seller_id: periodo.seller_id,
      monto_total_clp: montoTotal,
      modo,
    },
  });

  await inngest.send({
    name: 'dinero/periodo.emision-solicitada',
    id: `emision-solicitada-${periodoId}`,
    data: {
      periodoCobroidId: periodoId,
      tenantId,
      sellerId: periodo.seller_id,
      fechaInicio: periodo.fecha_inicio as string,
      fechaFin: periodo.fecha_fin as string,
      montoTotalClp: montoTotal,
      solicitadoPorUsuarioId: actorUsuarioId,
      modo,
    },
  });
}

// =============================================================================
// emitirNotaCreditoPeriodo — anulación TOTAL de la factura (RF-038)
// =============================================================================

/**
 * Solicita la emisión de una NOTA DE CRÉDITO (DTE tipo 61, CodRef=1) que anula
 * TOTALMENTE la factura de un período `facturado`. Compuerta humana idéntica a
 * la de emisión: solo una persona con `puedeEmitirFacturas` puede solicitarla,
 * con motivo obligatorio.
 *
 * Efectos (los aplica el job C-NC, `dinero/jobs/emitir-nota-credito.ts`):
 * - Emite el 61 referenciando el 33 (montos COPIADOS del 33, no recalculados).
 * - Período → `anulado` (terminal; no se re-factura el mismo rango).
 * - Las líneas de cobro se liberan y se reimputan al período abierto vigente.
 * - Los pagos imputados se desimputan a `sobrante` (vuelven a la bandeja).
 *
 * Alcance MVP: SOLO anulación total (CodRef=1). Quedan fuera: NC parcial por
 * montos (CodRef=3), corrección de texto (CodRef=2), nota de débito (56) y
 * anulación de la propia NC.
 */
export async function emitirNotaCreditoPeriodo(
  tenantId: string,
  periodoId: string,
  motivo: string,
  usuario: UsuarioActual,
  actorUsuarioId: string,
): Promise<void> {
  if (!puedeEmitirFacturas(usuario)) {
    throw new ErrorValidacion(
      'Solo el dueño o administración puede emitir notas de crédito.',
    );
  }

  const motivoLimpio = motivo?.trim() ?? '';
  if (!motivoLimpio) {
    throw new ErrorValidacion(
      'El motivo de la anulación es obligatorio — queda en la auditoría y en la nota de crédito.',
    );
  }

  const supabase = crearClienteServiceRole();

  // Leer el período y verificar tenant + estado facturado con DTE asociado.
  const { data: periodo, error: errorLectura } = await supabase
    .schema('dinero')
    .from('periodos_cobro')
    .select('id, tenant_id, seller_id, estado, documento_dte_id, monto_pagado_clp')
    .eq('id', periodoId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (errorLectura) throw new Error(`Error al leer período: ${errorLectura.message}`);
  if (!periodo) throw new ErrorValidacion(`Período ${periodoId} no encontrado en el tenant.`);

  if (periodo.estado !== 'facturado' || !periodo.documento_dte_id) {
    throw new ErrorValidacion(
      `Solo se puede anular un período 'facturado' con su DTE emitido. Estado actual: '${periodo.estado}'.`,
    );
  }

  // Leer el documento 33 a anular (montos COPIADOS de aquí, fuente tributaria).
  const { data: dte, error: errorDte } = await supabase
    .schema('dinero')
    .from('documentos_dte')
    .select('id, tipo_documento, folio, estado_sii, monto_neto_clp, monto_iva_clp, monto_total_clp')
    .eq('id', periodo.documento_dte_id as string)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (errorDte) throw new Error(`Error al leer DTE: ${errorDte.message}`);
  if (!dte || dte.tipo_documento !== 33) {
    throw new ErrorValidacion('El documento a anular no existe o no es una factura (tipo 33).');
  }
  if (dte.estado_sii === 'rechazado') {
    // Un 33 rechazado nunca entró al SII — no se anula con NC (su flujo de
    // re-emisión es otro ítem, fuera de este alcance).
    throw new ErrorValidacion(
      'La factura fue rechazada por el SII — no requiere nota de crédito.',
    );
  }

  // ¿Ya existe una NC vigente para este 33? (el índice único parcial de la
  // migración lo impone en BD; aquí damos error claro antes).
  const { data: ncExistente } = await supabase
    .schema('dinero')
    .from('documentos_dte')
    .select('id, folio')
    .eq('tenant_id', tenantId)
    .eq('tipo_documento', 61)
    .eq('dte_referencia_id', dte.id as string)
    .maybeSingle();

  if (ncExistente) {
    throw new ErrorValidacion(
      `Esta factura ya fue anulada con la nota de crédito folio ${ncExistente.folio}.`,
    );
  }

  // Resolver el modo de emisión — mismo mecanismo y opt-in que la factura.
  const sandbox = process.env.DTE_SANDBOX_MODE !== 'false';
  const modo: 'sandbox' | 'real' = sandbox ? 'sandbox' : 'real';

  if (modo === 'real') {
    const { data: config } = await supabase
      .schema('identidad')
      .from('courier_config_dte')
      .select('emision_dte_real_habilitada')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (!config?.emision_dte_real_habilitada) {
      throw new ErrorValidacion(
        'La emisión real de DTE no está habilitada para este courier. ' +
          'Actívala explícitamente en la configuración antes de emitir al SII.',
      );
    }
  }

  // Bitácora ANTES de publicar el evento (acción financiera auditada aunque
  // `inngest.send` falle). El motivo queda en la auditoría.
  await registrarEnBitacora(supabase, {
    tenantId,
    actorUsuarioId,
    actorTipo: 'usuario',
    accion: 'dinero.nc_emision_solicitada',
    entidadTipo: 'periodo_cobro',
    entidadId: periodoId,
    detalle: {
      seller_id: periodo.seller_id,
      documento_dte_id: dte.id,
      folio_original: dte.folio,
      monto_total_clp: Math.round(Number(dte.monto_total_clp)),
      monto_pagado_clp: Math.round(Number(periodo.monto_pagado_clp ?? 0)),
      motivo: motivoLimpio,
      modo,
    },
  });

  await inngest.send({
    name: 'dinero/nc.emision-solicitada',
    id: `nc-emision-solicitada-${periodoId}`,
    data: {
      periodoCobroidId: periodoId,
      tenantId,
      sellerId: periodo.seller_id as string,
      documentoDteId: dte.id as string,
      folioReferencia: dte.folio as number,
      tipoDocumentoReferencia: 33,
      montoNetoClp: Math.round(Number(dte.monto_neto_clp)),
      montoIvaClp: Math.round(Number(dte.monto_iva_clp)),
      montoTotalClp: Math.round(Number(dte.monto_total_clp)),
      motivo: motivoLimpio,
      solicitadoPorUsuarioId: actorUsuarioId,
      modo,
    },
  });
}

// =============================================================================
// marcarLiquidacionPagada
// =============================================================================

/**
 * Marca una liquidación de conductor como pagada.
 *
 * Precondiciones:
 * - El usuario debe tener capacidad `gestionar_liquidaciones_conductores`.
 * - La liquidación debe estar en estado `emitida`.
 */
export async function marcarLiquidacionPagada(
  tenantId: string,
  liquidacionId: string,
  usuario: UsuarioActual,
  actorUsuarioId: string,
): Promise<void> {
  if (!puedeGestionarLiquidacionesConductores(usuario)) {
    throw new ErrorValidacion(
      'Solo el dueño o administración puede marcar liquidaciones como pagadas.',
    );
  }

  const supabase = crearClienteServiceRole();

  // Leer liquidación y verificar tenant y estado.
  const { data: liq, error: errorLectura } = await supabase
    .schema('dinero')
    .from('liquidaciones')
    .select('id, tenant_id, driver_id, estado, monto_total_clp')
    .eq('id', liquidacionId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (errorLectura) throw new Error(`Error al leer liquidación: ${errorLectura.message}`);
  if (!liq) throw new ErrorValidacion(`Liquidación ${liquidacionId} no encontrada en el tenant.`);
  if (liq.estado !== 'emitida') {
    throw new ErrorValidacion(
      `La liquidación está en estado '${liq.estado}' — solo se pueden marcar como pagadas las emitidas.`,
    );
  }

  const { error: errorUpdate } = await supabase
    .schema('dinero')
    .from('liquidaciones')
    .update({
      estado: 'pagada',
      actualizado_en: new Date().toISOString(),
    })
    .eq('id', liquidacionId)
    .eq('tenant_id', tenantId)
    .eq('estado', 'emitida');

  if (errorUpdate) throw new Error(`Error al marcar liquidación como pagada: ${errorUpdate.message}`);

  await registrarEnBitacora(supabase, {
    tenantId,
    actorUsuarioId,
    actorTipo: 'usuario',
    accion: 'dinero.liquidacion_marcada_pagada',
    entidadTipo: 'liquidacion',
    entidadId: liquidacionId,
    detalle: {
      driver_id: liq.driver_id,
      monto_total_clp: liq.monto_total_clp,
    },
  });
}

// =============================================================================
// resolverEventoConciliacion
// =============================================================================

/**
 * Actualiza el estado de un evento de conciliación (resolución manual).
 *
 * Precondiciones:
 * - El usuario debe tener capacidad `ver_conciliacion` (dueño o administración).
 *
 * La resolución puede ser 'revisado' | 'resuelto' | 'ignorado'.
 */
export async function resolverEventoConciliacion(
  tenantId: string,
  eventoId: string,
  resolucion: Extract<EstadoEventoConciliacion, 'revisado' | 'resuelto' | 'ignorado'>,
  usuario: UsuarioActual,
  actorUsuarioId: string,
): Promise<void> {
  if (!puedeVerConciliacion(usuario)) {
    throw new ErrorValidacion(
      'Solo el dueño o administración puede resolver eventos de conciliación.',
    );
  }

  const supabase = crearClienteServiceRole();

  const { data: evento, error: errorLectura } = await supabase
    .schema('dinero')
    .from('eventos_conciliacion')
    .select('id, tenant_id, estado')
    .eq('id', eventoId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (errorLectura) throw new Error(`Error al leer evento de conciliación: ${errorLectura.message}`);
  if (!evento) throw new ErrorValidacion(`Evento de conciliación ${eventoId} no encontrado.`);
  if (evento.estado === 'resuelto' || evento.estado === 'ignorado') {
    throw new ErrorValidacion(`El evento ya está en estado '${evento.estado}'.`);
  }

  const { error: errorUpdate } = await supabase
    .schema('dinero')
    .from('eventos_conciliacion')
    .update({
      estado: resolucion,
      resuelto_en: new Date().toISOString(),
      resuelto_por_usuario_id: actorUsuarioId,
    })
    .eq('id', eventoId)
    .eq('tenant_id', tenantId);

  if (errorUpdate) {
    throw new Error(`Error al resolver evento de conciliación: ${errorUpdate.message}`);
  }

  await registrarEnBitacora(supabase, {
    tenantId,
    actorUsuarioId,
    actorTipo: 'usuario',
    accion: 'dinero.evento_conciliacion_resuelto',
    entidadTipo: 'evento_conciliacion',
    entidadId: eventoId,
    detalle: {
      resolucion,
      estado_anterior: evento.estado,
    },
  });
}

// =============================================================================
// atribuirPagoManualmente — resolución manual de cobranza (capa "pagado")
// =============================================================================

/**
 * Atribuye manualmente un pago recibido (sin atribuir o sobrante) a un seller y,
 * opcionalmente, a un período de cobro, y vuelve a correr la conciliación
 * (cascada de matching) con ese seller forzado. Pensada para los pagos que el
 * motor no pudo atribuir solo (sin RUT de contraparte, o ambigüedad) — la
 * conciliación es detective, la decide una persona.
 *
 * Precondiciones:
 * - Capacidad `ver_conciliacion` (dueño o administración) — el mismo gate que
 *   gobierna la conciliación/finanzas del motor entrega→dinero.
 * - El pago debe pertenecer al tenant y NO estar en estado terminal
 *   (`conciliado`/`descartado`).
 * - El seller debe pertenecer al tenant.
 *
 * Efectos (BITÁCORA ANTES del efecto, con `actorUsuarioId` — RNF-04):
 * - Registra `dinero.pago_atribuido_manual` en bitácora.
 * - Fija `seller_id`, `atribuido_por_usuario_id`, `atribuido_en` en el pago.
 * - Corre la conciliación (paso 3 del job de matching) con el seller forzado.
 *   Si calza un período, lo imputa (esa proyección la escribe el job).
 *
 * @param periodoCobroId opcional. Si se da, se valida que pertenezca al tenant
 *   y al seller; la conciliación igualmente decide el calce sobre los períodos
 *   candidatos (no se fuerza una imputación que no cuadre — no adivinar).
 */
export async function atribuirPagoManualmente(
  tenantId: string,
  pagoId: string,
  sellerId: string,
  usuario: UsuarioActual,
  actorUsuarioId: string,
  periodoCobroId?: string,
): Promise<void> {
  if (!puedeVerConciliacion(usuario)) {
    throw new ErrorValidacion(
      'Solo el dueño o administración puede atribuir pagos manualmente.',
    );
  }

  const supabase = crearClienteServiceRole();

  // Leer el pago acotado por tenant (aislamiento). Traemos también la imputación
  // previa (periodo_cobro_id + monto) para poder REVERSARLA antes de re-conciliar
  // — sin esto, re-atribuir un pago ya `parcial` duplicaría `monto_pagado_clp`.
  const { data: pago, error: errPago } = await supabase
    .schema('dinero')
    .from('pagos_recibidos')
    .select('id, tenant_id, estado_match, periodo_cobro_id, monto_clp')
    .eq('id', pagoId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (errPago) throw new Error(`Error al leer pago: ${errPago.message}`);
  if (!pago) throw new ErrorValidacion(`Pago ${pagoId} no encontrado en el tenant.`);
  if (esEstadoTerminal(pago.estado_match as string)) {
    throw new ErrorValidacion(
      `El pago ya está en estado '${pago.estado_match}' — no se puede re-atribuir.`,
    );
  }

  // Validar que el seller pertenece al tenant.
  const { data: seller, error: errSeller } = await supabase
    .schema('identidad')
    .from('sellers')
    .select('id')
    .eq('id', sellerId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (errSeller) throw new Error(`Error al leer seller: ${errSeller.message}`);
  if (!seller) throw new ErrorValidacion('El seller indicado no pertenece al tenant.');

  // Si se indicó período, validar tenant + seller (no imputar a período ajeno).
  if (periodoCobroId) {
    const { data: periodo, error: errPeriodo } = await supabase
      .schema('dinero')
      .from('periodos_cobro')
      .select('id, seller_id')
      .eq('id', periodoCobroId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (errPeriodo) throw new Error(`Error al leer período: ${errPeriodo.message}`);
    if (!periodo) throw new ErrorValidacion('El período indicado no pertenece al tenant.');
    if (periodo.seller_id !== sellerId) {
      throw new ErrorValidacion('El período indicado no corresponde al seller atribuido.');
    }
  }

  // BITÁCORA ANTES del efecto (acción financiera con autor — RNF-04).
  await registrarEnBitacora(supabase, {
    tenantId,
    actorUsuarioId,
    actorTipo: 'usuario',
    accion: 'dinero.pago_atribuido_manual',
    entidadTipo: 'pago_recibido',
    entidadId: pagoId,
    detalle: {
      seller_id: sellerId,
      periodo_cobro_id: periodoCobroId ?? null,
    },
  });

  // REVERSAR la imputación previa (si el pago ya estaba imputado a un período):
  // restar su monto del `monto_pagado_clp` de ese período y volver su
  // `estado_cobro` a 'pendiente'/'parcial' según el saldo restante. Sin esto, la
  // nueva conciliación sumaría el monto OTRA vez (cobro doble) o lo imputaría a
  // un seller distinto dejando inflado el período anterior.
  const periodoPrevioId = pago.periodo_cobro_id as string | null;
  if (periodoPrevioId) {
    const { data: periodoPrevio, error: errPrevio } = await supabase
      .schema('dinero')
      .from('periodos_cobro')
      .select('id, monto_total_clp, monto_pagado_clp')
      .eq('id', periodoPrevioId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (errPrevio) throw new Error(`Error al leer período previo: ${errPrevio.message}`);
    if (periodoPrevio) {
      const montoPago = Math.round(Number(pago.monto_clp ?? 0));
      const pagadoPrevio = Math.round(Number(periodoPrevio.monto_pagado_clp ?? 0));
      const totalPrevio = Math.round(Number(periodoPrevio.monto_total_clp ?? 0));
      const nuevoPagado = Math.max(0, pagadoPrevio - montoPago);
      const { error: errRev } = await supabase
        .schema('dinero')
        .from('periodos_cobro')
        .update({
          monto_pagado_clp: nuevoPagado,
          estado_cobro: nuevoPagado >= totalPrevio && totalPrevio > 0 ? 'pagado' : nuevoPagado > 0 ? 'parcial' : 'pendiente',
          pagado_en: nuevoPagado >= totalPrevio && totalPrevio > 0 ? new Date().toISOString() : null,
          actualizado_en: new Date().toISOString(),
        })
        .eq('id', periodoPrevioId)
        .eq('tenant_id', tenantId);
      if (errRev) throw new Error(`Error al reversar imputación previa: ${errRev.message}`);
    }
  }

  // Fijar la atribución manual (quién y cuándo) en el pago. Se limpia la
  // imputación previa (`periodo_cobro_id`) para que la cascada parta limpia.
  const { error: errUpdate } = await supabase
    .schema('dinero')
    .from('pagos_recibidos')
    .update({
      seller_id: sellerId,
      periodo_cobro_id: null,
      estado_match: 'atribuido',
      atribuido_por_usuario_id: actorUsuarioId,
      atribuido_en: new Date().toISOString(),
      actualizado_en: new Date().toISOString(),
    })
    .eq('id', pagoId)
    .eq('tenant_id', tenantId);
  if (errUpdate) throw new Error(`Error al atribuir pago: ${errUpdate.message}`);

  // Correr la conciliación con el seller forzado (cascada del job de matching).
  // La imputación al período (si calza) la escribe el propio job (service_role).
  await conciliarPagoPersistido(pagoId, tenantId, { sellerIdForzado: sellerId });
}

// =============================================================================
// descartarPago — marca un pago como no-cobranza (resolución manual)
// =============================================================================

/**
 * Descarta un pago recibido (`estado_match='descartado'`): no corresponde a
 * cobranza (devolución, transferencia ajena, error). Estado terminal — no se
 * re-procesa.
 *
 * Precondiciones:
 * - Capacidad `ver_conciliacion` (dueño o administración).
 * - El pago debe pertenecer al tenant y no estar ya en estado terminal.
 *
 * Efectos (BITÁCORA ANTES del efecto, con `actorUsuarioId`):
 * - Registra `dinero.pago_descartado` (con el motivo) en bitácora.
 * - Setea `estado_match='descartado'`. NO toca ningún período.
 */
export async function descartarPago(
  tenantId: string,
  pagoId: string,
  motivo: string,
  usuario: UsuarioActual,
  actorUsuarioId: string,
): Promise<void> {
  if (!puedeVerConciliacion(usuario)) {
    throw new ErrorValidacion('Solo el dueño o administración puede descartar pagos.');
  }

  const motivoLimpio = (motivo ?? '').trim();
  if (motivoLimpio.length === 0) {
    throw new ErrorValidacion('Indica un motivo para descartar el pago.');
  }

  const supabase = crearClienteServiceRole();

  const { data: pago, error: errPago } = await supabase
    .schema('dinero')
    .from('pagos_recibidos')
    .select('id, tenant_id, estado_match')
    .eq('id', pagoId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (errPago) throw new Error(`Error al leer pago: ${errPago.message}`);
  if (!pago) throw new ErrorValidacion(`Pago ${pagoId} no encontrado en el tenant.`);
  if (esEstadoTerminal(pago.estado_match as string)) {
    throw new ErrorValidacion(
      `El pago ya está en estado '${pago.estado_match}' — no se puede descartar.`,
    );
  }

  // BITÁCORA ANTES del efecto.
  await registrarEnBitacora(supabase, {
    tenantId,
    actorUsuarioId,
    actorTipo: 'usuario',
    accion: 'dinero.pago_descartado',
    entidadTipo: 'pago_recibido',
    entidadId: pagoId,
    detalle: {
      motivo: motivoLimpio,
      estado_anterior: pago.estado_match,
    },
  });

  const { error: errUpdate } = await supabase
    .schema('dinero')
    .from('pagos_recibidos')
    .update({
      estado_match: 'descartado',
      actualizado_en: new Date().toISOString(),
    })
    .eq('id', pagoId)
    .eq('tenant_id', tenantId);
  if (errUpdate) throw new Error(`Error al descartar pago: ${errUpdate.message}`);
}
