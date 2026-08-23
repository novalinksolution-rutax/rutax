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
import { esquemaMotivo } from '@/lib/validacion/esquemas';
import type { UsuarioActual } from '@/modules/identidad/usuario-actual';
import type {
  EstadoEventoConciliacion,
  AccionSugeridaConciliacion,
  TipoCambioConciliacion,
} from './tipos';
import { esTransicionValida, esEstadoTerminal as esEstadoTerminalConciliacion } from './conciliacion-clasificacion';
import { conciliarPagoPersistido } from './aplicar-pago';
import { esEstadoTerminal } from './matching-pago';
import { montosDesdeNeto } from './montos';
import { modoDtePlataforma } from './modo-dte';
import type { TipoAccionDinero } from './preflight';
import { calcularMontoPayout, type TipoRelacionConductor } from './jobs/calculo-payout';
import { hayFolioDisponible } from './folios';

/**
 * Valida y normaliza (trim) un motivo de texto libre del usuario con zod (#10).
 * Lanza `ErrorValidacion` con el mensaje del esquema si está vacío o excede el
 * largo. Devuelve el motivo ya saneado.
 */
function validarMotivo(motivo: string): string {
  const r = esquemaMotivo.safeParse(motivo);
  if (!r.success) {
    throw new ErrorValidacion(r.error.issues[0]?.message ?? 'El motivo es obligatorio.');
  }
  return r.data;
}

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
  // IMPORTANTE: excluir líneas anuladas (anulada = false) — las líneas de
  // pedidos devueltos tras fallido se anulan antes del cierre; incluirlas
  // inflaría el monto del DTE y lo haría incorrecto ante el SII.
  const { data: totalesData, error: errorTotales } = await supabase
    .schema('dinero')
    .from('lineas_cobro')
    .select('monto_final_clp')
    .eq('tenant_id', tenantId)
    .eq('periodo_cobro_id', periodoId)
    .eq('anulada', false);

  if (errorTotales) throw new Error(`Error al calcular totales: ${errorTotales.message}`);

  const lineas = totalesData ?? [];
  const totalLineas = lineas.length;
  // Líneas en NETO (tarifa = neto, A2). El total del período es BRUTO (neto +
  // IVA), calculado una sola vez sobre la suma — igual que el cron C2.
  const netoTotal = lineas.reduce((acc, l) => acc + Math.round(Number(l.monto_final_clp)), 0);
  const montoTotal = montosDesdeNeto(netoTotal).totalClp;

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
  const modo = modoDtePlataforma();

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

  // Verificación de SOLO LECTURA (no reserva folio: eso lo hace el job C3 de
  // forma transaccional). Misma precondición que ya evalúa `preflightEmitirFactura`
  // (bloqueo `folios_agotados`) — se comprueba TAMBIÉN aquí para no publicar un
  // evento condenado a fallar (fix QA jul 2026): sin este chequeo, el usuario
  // veía "Factura emitida" de inmediato (la emisión real es asíncrona) aunque
  // no hubiera folios — el job fallaba minutos después sin que nadie se enterara.
  if (!(await hayFolioDisponible(tenantId, 33))) {
    throw new ErrorValidacion(
      'No hay folios CAF disponibles para facturas (tipo 33). Carga un nuevo CAF antes de emitir.',
    );
  }

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

  const motivoLimpio = validarMotivo(motivo);

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
  const modo = modoDtePlataforma();

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

  // Verificación de SOLO LECTURA — folio tipo 61, discriminado del 33 de la
  // factura. Misma precondición que `preflightEmitirNotaCredito` (bloqueo
  // `folios_agotados`); se comprueba TAMBIÉN aquí por la misma razón que en
  // `emitirFacturaPeriodo` (fix QA jul 2026): no publicar un evento condenado
  // a fallar sin que el usuario se entere.
  if (!(await hayFolioDisponible(tenantId, 61))) {
    throw new ErrorValidacion(
      'No hay folios CAF disponibles para notas de crédito (tipo 61). Carga un nuevo CAF antes de emitir.',
    );
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
// emitirPagoLiquidacion — COMPUERTA DE PAGO A CONDUCTOR (F19)
// =============================================================================

/**
 * Solicita el pago de una liquidación de conductor YA emitida. Es la compuerta
 * de aprobación humana del dinero SALIENTE del motor entrega→dinero: ningún
 * proceso automático emite un payout; solo esta acción, disparada por una
 * persona con permiso de gestión de liquidaciones, publica el evento que activa
 * el job `jobEjecutarPayout`.
 *
 * Por qué existe la compuerta: una transferencia bancaria real es irreversible.
 * El levantamiento exige "aprobación humana antes de pagar" (RF-F19). La
 * auto-emisión en un cron convertiría un error de monto en un pago incorrecto
 * sin posibilidad de retención.
 *
 * Precondiciones:
 * - Capacidad `gestionar_liquidaciones_conductores` (dueño o administración).
 * - La liquidación debe estar en estado `emitida` (ya revisada y aprobada).
 * - `monto_total_clp > 0`.
 *
 * Efectos:
 * - Registra en bitácora (`dinero.pago_liquidacion_solicitado`, con autor).
 * - Publica `dinero/liquidacion.pago-solicitado` → dispara jobEjecutarPayout.
 *
 * @param actorUsuarioId UUID de auth del usuario que ejecuta la acción
 *   (`sesion.usuarioId`). Queda en la bitácora — RNF-04 exige el "quién".
 */
export async function emitirPagoLiquidacion(
  tenantId: string,
  liquidacionId: string,
  usuario: UsuarioActual,
  actorUsuarioId: string,
): Promise<void> {
  if (!puedeGestionarLiquidacionesConductores(usuario)) {
    throw new ErrorValidacion(
      'Solo el dueño o administración puede solicitar el pago de liquidaciones a conductores.',
    );
  }

  const supabase = crearClienteServiceRole();

  // Leer la liquidación y verificar que pertenece al tenant.
  const { data: liq, error: errorLectura } = await supabase
    .schema('dinero')
    .from('liquidaciones')
    .select(
      'id, tenant_id, driver_id, estado, monto_total_clp, bono_clp, penalizacion_clp, tipo_relacion_conductor',
    )
    .eq('id', liquidacionId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (errorLectura) throw new Error(`Error al leer liquidación: ${errorLectura.message}`);
  if (!liq) throw new ErrorValidacion(`Liquidación ${liquidacionId} no encontrada en el tenant.`);

  if (liq.estado !== 'emitida') {
    throw new ErrorValidacion(
      `La liquidación está en estado '${liq.estado}' — solo se pueden pagar liquidaciones en estado 'emitida'.`,
    );
  }

  const montoTotal = Math.round(Number(liq.monto_total_clp ?? 0));

  // Las mismas precondiciones que ya evalúa `preflightEmitirPago` (bloqueo) y
  // que igualmente exige `jobEjecutarPayout` (NonRetriableError) — se
  // verifican TAMBIÉN aquí, en la compuerta humana, para no publicar un
  // evento condenado a fallar en el job si el usuario llega a esta acción sin
  // haber pasado por (o habiendo salteado) el preflight. Misma fórmula
  // compartida (`calcularMontoPayout`) — nunca puede divergir del monto que el
  // job realmente transferiría.
  const { data: conductorPago, error: errorConductorPago } = await supabase
    .schema('identidad')
    .from('conductores')
    .select('banco, tipo_cuenta, numero_cuenta, tipo_relacion')
    .eq('id', liq.driver_id as string)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (errorConductorPago) throw new Error(`Error al leer conductor: ${errorConductorPago.message}`);

  if (!conductorPago?.banco || !conductorPago?.tipo_cuenta || !conductorPago?.numero_cuenta) {
    throw new ErrorValidacion(
      'El conductor no tiene datos bancarios completos (banco, tipo de cuenta, número de cuenta) — no se puede solicitar el pago.',
    );
  }

  const { data: configPago, error: errorConfigPago } = await supabase
    .schema('identidad')
    .from('courier_config_payout')
    .select('porcentaje_retencion, minimo_retiro_clp')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (errorConfigPago) throw new Error(`Error al leer configuración de payout: ${errorConfigPago.message}`);

  const porcentajeRetencion =
    typeof configPago?.porcentaje_retencion === 'number' ? configPago.porcentaje_retencion : 0;
  const minimoRetiroClp =
    typeof configPago?.minimo_retiro_clp === 'number' ? configPago.minimo_retiro_clp : 0;
  const tipoRelacion: TipoRelacionConductor =
    (conductorPago.tipo_relacion as TipoRelacionConductor | undefined) ??
    (liq.tipo_relacion_conductor as TipoRelacionConductor);

  const calculo = calcularMontoPayout({
    montoTotalClp: montoTotal,
    bonoClp: Math.round(Number(liq.bono_clp ?? 0)),
    penalizacionClp: Math.round(Number(liq.penalizacion_clp ?? 0)),
    tipoRelacion,
    porcentajeRetencion,
  });

  if (calculo.montoLiquidoClp <= 0) {
    throw new ErrorValidacion('La liquidación no tiene monto a pagar.');
  }
  if (minimoRetiroClp > 0 && calculo.montoLiquidoClp < minimoRetiroClp) {
    throw new ErrorValidacion(
      `El monto líquido (${calculo.montoLiquidoClp} CLP) es menor al mínimo de retiro configurado (${minimoRetiroClp} CLP).`,
    );
  }

  // Bitácora ANTES de publicar el evento (acción financiera auditada aunque
  // `inngest.send` falle — invariante del proyecto, RNF-04).
  await registrarEnBitacora(supabase, {
    tenantId,
    actorUsuarioId,
    actorTipo: 'usuario',
    accion: 'dinero.pago_liquidacion_solicitado',
    entidadTipo: 'liquidacion',
    entidadId: liquidacionId,
    detalle: {
      driver_id: liq.driver_id,
      monto_total_clp: montoTotal,
      estado_anterior: 'emitida',
    },
  });

  // Publicar evento — después de la bitácora. El job jobEjecutarPayout consume
  // este evento y ejecuta la transferencia de forma idempotente. El id del evento
  // garantiza deduplicación de Inngest: un solo envío aunque la acción se llame
  // dos veces para la misma liquidación.
  await inngest.send({
    name: 'dinero/liquidacion.pago-solicitado',
    id: `pago-solicitado-${liquidacionId}`,
    data: {
      liquidacionId,
      tenantId,
      driverId: liq.driver_id as string,
      montoTotalClp: montoTotal,
      solicitadoPorUsuarioId: actorUsuarioId,
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
  /**
   * Cómo y cuándo se pagó por fuera. **Obligatorio**, y no por prolijidad: esta
   * acción no mueve un peso — solo AFIRMA que alguien pagó. Sin el cómo y el
   * cuándo, la afirmación no se puede comprobar después, y lo que queda es una
   * liquidación marcada como pagada que nadie sabe si se pagó.
   */
  motivo: string,
  usuario: UsuarioActual,
  actorUsuarioId: string,
): Promise<void> {
  if (!puedeGestionarLiquidacionesConductores(usuario)) {
    throw new ErrorValidacion(
      'Solo el dueño o administración puede marcar liquidaciones como pagadas.',
    );
  }
  if (motivo.trim().length < MINIMO_MOTIVO_AJUSTE) {
    throw new ErrorValidacion(
      `Marcar como pagada exige registrar cómo y cuándo pagaste, con al menos ${MINIMO_MOTIVO_AJUSTE} caracteres: esta acción no transfiere plata, solo afirma que alguien lo hizo.`,
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
    // El motivo vive en la bitácora: es la única constancia de que el pago
    // ocurrió fuera de Rutax, y de cómo.
    entidadId: liquidacionId,
    detalle: {
      driver_id: liq.driver_id,
      monto_total_clp: liq.monto_total_clp,
    },
  });
}

// =============================================================================
// ajustarLiquidacion (F16 — bono/penalización manual)
// =============================================================================

/**
 * Aplica un ajuste manual (bono y/o penalización) a una liquidación en borrador.
 *
 * Precondiciones:
 * - El usuario debe tener capacidad `gestionar_liquidaciones_conductores`.
 * - La liquidación debe estar en estado `borrador` (no emitida ni pagada).
 *
 * El monto final a pagar al conductor =
 *   monto_total_clp + bono_clp - penalizacion_clp
 * Este cálculo es responsabilidad de la capa de presentación; aquí solo
 * persistimos los componentes del ajuste.
 */
/**
 * Mínimo del motivo de un ajuste manual. Lo fija el tablero B2b, y la razón es
 * quién lo lee, no la prolijidad.
 */
export const MINIMO_MOTIVO_AJUSTE = 10;

export async function ajustarLiquidacion(
  tenantId: string,
  liquidacionId: string,
  bonoClp: number,
  penalizacionClp: number,
  notaAjuste: string | null,
  usuario: UsuarioActual,
  actorUsuarioId: string,
): Promise<void> {
  if (!puedeGestionarLiquidacionesConductores(usuario)) {
    throw new ErrorValidacion(
      'Solo el dueño o administración puede ajustar liquidaciones.',
    );
  }
  if (!Number.isInteger(bonoClp) || bonoClp < 0) {
    throw new ErrorValidacion('El bono debe ser un entero CLP mayor o igual a cero.');
  }
  if (!Number.isInteger(penalizacionClp) || penalizacionClp < 0) {
    throw new ErrorValidacion('La penalización debe ser un entero CLP mayor o igual a cero.');
  }
  // El motivo es OBLIGATORIO cuando hay un ajuste, y se valida acá y no solo en
  // la pantalla: **lo lee el conductor** en su liquidación y en su PDF, así que
  // un descuento sin explicación es una pregunta que le llega a alguien por
  // WhatsApp. Diez caracteres es el mínimo con el que un motivo dice algo —
  // «error» no llega.
  //
  // Con los dos ajustes en cero NO se exige: eso es limpiar un ajuste anterior,
  // no aplicar uno nuevo.
  const hayAjuste = bonoClp > 0 || penalizacionClp > 0;
  if (hayAjuste && (notaAjuste ?? '').trim().length < MINIMO_MOTIVO_AJUSTE) {
    throw new ErrorValidacion(
      `Un bono o una penalización necesitan un motivo de al menos ${MINIMO_MOTIVO_AJUSTE} caracteres: lo lee el conductor en su liquidación.`,
    );
  }

  const supabase = crearClienteServiceRole();

  const { data: liq, error: errorLectura } = await supabase
    .schema('dinero')
    .from('liquidaciones')
    .select('id, tenant_id, driver_id, estado, monto_total_clp')
    .eq('id', liquidacionId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (errorLectura) throw new Error(`Error al leer liquidación: ${errorLectura.message}`);
  if (!liq) throw new ErrorValidacion(`Liquidación ${liquidacionId} no encontrada.`);
  if (liq.estado !== 'borrador') {
    throw new ErrorValidacion(
      `La liquidación está en estado '${liq.estado}' — solo se pueden ajustar las que están en borrador.`,
    );
  }

  await registrarEnBitacora(supabase, {
    tenantId,
    actorUsuarioId,
    actorTipo: 'usuario',
    accion: 'dinero.liquidacion_ajustada',
    entidadTipo: 'liquidacion',
    entidadId: liquidacionId,
    detalle: {
      driver_id: liq.driver_id,
      bono_clp: bonoClp,
      penalizacion_clp: penalizacionClp,
      nota_ajuste: notaAjuste,
    },
  });

  const { error: errorUpdate } = await supabase
    .schema('dinero')
    .from('liquidaciones')
    .update({
      bono_clp: bonoClp,
      penalizacion_clp: penalizacionClp,
      nota_ajuste: notaAjuste ?? null,
      actualizado_en: new Date().toISOString(),
    })
    .eq('id', liquidacionId)
    .eq('tenant_id', tenantId)
    .eq('estado', 'borrador');

  if (errorUpdate) throw new Error(`Error al ajustar liquidación: ${errorUpdate.message}`);
}

// =============================================================================
// Bandeja de excepciones de conciliación (§1.1 P1, jul 2026)
// =============================================================================
//
// Reemplaza la vieja `resolverEventoConciliacion` (4 estados, log append-only,
// que auditaba DESPUÉS del UPDATE) por las 7 funciones de abajo, sobre la
// bandeja gestionable de 8 estados (migración 20260708000001). Gate único:
// `puedeVerConciliacion(usuario)`. Orden invariante en TODAS:
//   (1) RBAC + cargar fila actual con tenant_id + validar (incl. legalidad de
//       la transición si aplica) ANTES de auditar;
//   (2) `registrarEnBitacora(...)` con `actorUsuarioId` (bitácora ANTES del
//       efecto — corrige el hallazgo de que la función vieja auditaba después);
//   (3) UPDATE sobre `eventos_conciliacion`;
//   (4) INSERT en `eventos_conciliacion_historial`.

function exigirPermisoConciliacion(usuario: UsuarioActual): void {
  if (!puedeVerConciliacion(usuario)) {
    throw new ErrorValidacion(
      'Solo el dueño o administración puede gestionar la bandeja de excepciones de conciliación.',
    );
  }
}

/** Carga la fila del evento acotada al tenant (aislamiento) o lanza `ErrorValidacion`. */
async function cargarEventoConciliacionOrThrow(
  supabase: ReturnType<typeof crearClienteServiceRole>,
  tenantId: string,
  eventoId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const { data: evento, error } = await supabase
    .schema('dinero')
    .from('eventos_conciliacion')
    .select('*')
    .eq('id', eventoId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error) throw new Error(`Error al leer evento de conciliación: ${error.message}`);
  if (!evento) throw new ErrorValidacion(`Evento de conciliación ${eventoId} no encontrado en el tenant.`);
  return evento;
}

/** Registra una entrada en `eventos_conciliacion_historial` — helper compartido por las 7 funciones. */
async function registrarHistorialConciliacion(
  supabase: ReturnType<typeof crearClienteServiceRole>,
  input: {
    tenantId: string;
    eventoId: string;
    tipoCambio: TipoCambioConciliacion;
    estadoAnterior?: string | null;
    estadoNuevo?: string | null;
    comentario?: string | null;
    datos?: Record<string, unknown>;
    actorUsuarioId: string;
  },
): Promise<void> {
  const { error } = await supabase
    .schema('dinero')
    .from('eventos_conciliacion_historial')
    .insert({
      tenant_id: input.tenantId,
      evento_id: input.eventoId,
      tipo_cambio: input.tipoCambio,
      estado_anterior: input.estadoAnterior ?? null,
      estado_nuevo: input.estadoNuevo ?? null,
      comentario: input.comentario ?? null,
      datos: input.datos ?? {},
      actor_usuario_id: input.actorUsuarioId,
      actor_tipo: 'usuario',
    });

  if (error) {
    throw new Error(`Error al registrar historial de conciliación: ${error.message}`);
  }
}

// -----------------------------------------------------------------------------
// 1. transicionarEventoConciliacion
// -----------------------------------------------------------------------------

/** Destinos que exigen un comentario obligatorio (cierre humano de la excepción). */
const ESTADOS_QUE_EXIGEN_COMENTARIO: ReadonlySet<EstadoEventoConciliacion> = new Set([
  'resuelta_manual',
  'aceptada_justificada',
  'ignorada',
]);

/**
 * Transiciona el estado de una excepción de conciliación según la máquina de
 * estados fija (`TRANSICIONES_VALIDAS` en `./conciliacion-clasificacion.ts`).
 *
 * Reglas de nota obligatoria (`opts.comentario`):
 * - Exigido cuando el destino ∈ {resuelta_manual, aceptada_justificada, ignorada}.
 * - Exigido cuando el origen es un estado terminal (motivo de la reapertura).
 *
 * Para destino `requiere_ajuste`: exige que el evento tenga
 * `accion_sugerida != 'sin_accion_requerida'` (elegir una acción primero).
 *
 * Al ENTRAR a un estado terminal: `resuelto_en`/`resuelto_por_usuario_id` se
 * fijan. Al REABRIR (salir de un terminal): se limpian a null. Los flags de
 * bloqueo (`bloquea_facturacion`/`bloquea_pago`) NUNCA se tocan aquí — no se
 * auto-limpian al resolver (decisión consciente, preserva el registro para
 * auditoría; el preflight filtra por estado no-terminal).
 *
 * `resuelta_auto` no es alcanzable como destino desde esta función humana —
 * la matriz de transiciones ya lo excluye salvo el propio caso `resuelta_auto`
 * como origen (reapertura).
 * // TODO(resuelta_auto): re-chequeo automático del job — Más adelante.
 */
export async function transicionarEventoConciliacion(
  tenantId: string,
  eventoId: string,
  nuevoEstado: EstadoEventoConciliacion,
  usuario: UsuarioActual,
  actorUsuarioId: string,
  opts?: { comentario?: string },
): Promise<void> {
  exigirPermisoConciliacion(usuario);

  const supabase = crearClienteServiceRole();
  const evento = await cargarEventoConciliacionOrThrow(supabase, tenantId, eventoId);
  const estadoAnterior = evento.estado as EstadoEventoConciliacion;

  if (!esTransicionValida(estadoAnterior, nuevoEstado)) {
    throw new ErrorValidacion(
      `No se puede pasar de '${estadoAnterior}' a '${nuevoEstado}' — transición no permitida.`,
    );
  }

  const origenEsTerminal = esEstadoTerminalConciliacion(estadoAnterior);
  const requiereComentario = ESTADOS_QUE_EXIGEN_COMENTARIO.has(nuevoEstado) || origenEsTerminal;
  const comentario = opts?.comentario?.trim() ?? '';

  if (requiereComentario && comentario.length === 0) {
    throw new ErrorValidacion(
      origenEsTerminal
        ? 'Indica el motivo de la reapertura antes de continuar.'
        : 'Indica un comentario antes de marcar esta excepción como resuelta, aceptada o ignorada.',
    );
  }

  if (nuevoEstado === 'requiere_ajuste' && evento.accion_sugerida === 'sin_accion_requerida') {
    throw new ErrorValidacion(
      'Elige una acción sugerida para esta excepción antes de marcarla como "requiere ajuste".',
    );
  }

  // Bitácora ANTES del efecto (acción financiera/de gestión auditada aunque el
  // UPDATE falle — RNF-04, con actorUsuarioId).
  await registrarEnBitacora(supabase, {
    tenantId,
    actorUsuarioId,
    actorTipo: 'usuario',
    accion: 'dinero.evento_conciliacion_transicionado',
    entidadTipo: 'evento_conciliacion',
    entidadId: eventoId,
    detalle: {
      estado_anterior: estadoAnterior,
      estado_nuevo: nuevoEstado,
      comentario: comentario || null,
    },
  });

  const entrandoATerminal = esEstadoTerminalConciliacion(nuevoEstado);
  const saliendoDeTerminal = origenEsTerminal && !entrandoATerminal;

  const update: Record<string, unknown> = {
    estado: nuevoEstado,
    actualizado_en: new Date().toISOString(),
  };
  if (entrandoATerminal) {
    update.resuelto_en = new Date().toISOString();
    update.resuelto_por_usuario_id = actorUsuarioId;
  } else if (saliendoDeTerminal) {
    update.resuelto_en = null;
    update.resuelto_por_usuario_id = null;
  }

  const { error: errorUpdate } = await supabase
    .schema('dinero')
    .from('eventos_conciliacion')
    .update(update)
    .eq('id', eventoId)
    .eq('tenant_id', tenantId);

  if (errorUpdate) {
    throw new Error(`Error al transicionar el evento de conciliación: ${errorUpdate.message}`);
  }

  await registrarHistorialConciliacion(supabase, {
    tenantId,
    eventoId,
    tipoCambio: 'cambio_estado',
    estadoAnterior,
    estadoNuevo: nuevoEstado,
    comentario: comentario || null,
    actorUsuarioId,
  });
}

// -----------------------------------------------------------------------------
// 2. reabrirEventoConciliacion — wrapper delgado sobre transicionarEventoConciliacion
// -----------------------------------------------------------------------------

/**
 * Reabre una excepción de conciliación cerrada (estado terminal). Destino:
 * `en_analisis` si el evento tiene `asignado_a_usuario_id` no nulo, si no
 * `pendiente`. Delega toda la validación/efectos en `transicionarEventoConciliacion`.
 */
export async function reabrirEventoConciliacion(
  tenantId: string,
  eventoId: string,
  usuario: UsuarioActual,
  actorUsuarioId: string,
  opts?: { comentario?: string },
): Promise<void> {
  exigirPermisoConciliacion(usuario);

  const supabase = crearClienteServiceRole();
  const evento = await cargarEventoConciliacionOrThrow(supabase, tenantId, eventoId);
  const destino: EstadoEventoConciliacion = evento.asignado_a_usuario_id ? 'en_analisis' : 'pendiente';

  await transicionarEventoConciliacion(tenantId, eventoId, destino, usuario, actorUsuarioId, opts);
}

// -----------------------------------------------------------------------------
// 3. asignarEventoConciliacion
// -----------------------------------------------------------------------------

/**
 * Asigna (o desasigna, con `null`) una excepción de conciliación a un usuario
 * interno del mismo tenant. Si `asignadoAUsuarioId` no es null, valida que el
 * usuario pertenezca al tenant, tenga rol `dueno`/`administracion` y no esté
 * `suspendido` (vía `identidad.usuarios_perfil`).
 */
export async function asignarEventoConciliacion(
  tenantId: string,
  eventoId: string,
  asignadoAUsuarioId: string | null,
  usuario: UsuarioActual,
  actorUsuarioId: string,
): Promise<void> {
  exigirPermisoConciliacion(usuario);

  const supabase = crearClienteServiceRole();

  if (asignadoAUsuarioId) {
    const { data: perfil, error: errorPerfil } = await supabase
      .schema('identidad')
      .from('usuarios_perfil')
      .select('id, tenant_id, rol, estado')
      .eq('id', asignadoAUsuarioId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (errorPerfil) throw new Error(`Error al leer el usuario a asignar: ${errorPerfil.message}`);
    if (!perfil) {
      throw new ErrorValidacion('El usuario a asignar no pertenece a este tenant.');
    }
    if (perfil.rol !== 'dueno' && perfil.rol !== 'administracion') {
      throw new ErrorValidacion('Solo se puede asignar la excepción a un usuario con rol dueño o administración.');
    }
    if (perfil.estado === 'suspendido') {
      throw new ErrorValidacion('No se puede asignar la excepción a un usuario suspendido.');
    }
  }

  const evento = await cargarEventoConciliacionOrThrow(supabase, tenantId, eventoId);
  const asignadoAnterior = (evento.asignado_a_usuario_id as string | null) ?? null;

  await registrarEnBitacora(supabase, {
    tenantId,
    actorUsuarioId,
    actorTipo: 'usuario',
    accion: 'dinero.evento_conciliacion_asignado',
    entidadTipo: 'evento_conciliacion',
    entidadId: eventoId,
    detalle: {
      asignado_a: asignadoAUsuarioId,
      asignado_a_anterior: asignadoAnterior,
    },
  });

  const { error: errorUpdate } = await supabase
    .schema('dinero')
    .from('eventos_conciliacion')
    .update({
      asignado_a_usuario_id: asignadoAUsuarioId,
      asignado_en: asignadoAUsuarioId ? new Date().toISOString() : null,
      asignado_por_usuario_id: asignadoAUsuarioId ? actorUsuarioId : null,
      actualizado_en: new Date().toISOString(),
    })
    .eq('id', eventoId)
    .eq('tenant_id', tenantId);

  if (errorUpdate) {
    throw new Error(`Error al asignar el evento de conciliación: ${errorUpdate.message}`);
  }

  await registrarHistorialConciliacion(supabase, {
    tenantId,
    eventoId,
    tipoCambio: 'asignacion',
    datos: { asignado_a: asignadoAUsuarioId, asignado_a_anterior: asignadoAnterior },
    actorUsuarioId,
  });
}

// -----------------------------------------------------------------------------
// 4. fijarFechaLimiteConciliacion
// -----------------------------------------------------------------------------

const REGEX_FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Fija (o limpia, con `null`) la fecha límite (SLA) de una excepción de conciliación. */
export async function fijarFechaLimiteConciliacion(
  tenantId: string,
  eventoId: string,
  fechaLimite: string | null,
  usuario: UsuarioActual,
  actorUsuarioId: string,
): Promise<void> {
  exigirPermisoConciliacion(usuario);

  if (fechaLimite !== null && !REGEX_FECHA_ISO.test(fechaLimite)) {
    throw new ErrorValidacion(`Fecha límite inválida: "${fechaLimite}". Formato esperado: YYYY-MM-DD.`);
  }

  const supabase = crearClienteServiceRole();
  const evento = await cargarEventoConciliacionOrThrow(supabase, tenantId, eventoId);
  const valorAnterior = (evento.fecha_limite as string | null) ?? null;

  await registrarEnBitacora(supabase, {
    tenantId,
    actorUsuarioId,
    actorTipo: 'usuario',
    accion: 'dinero.evento_conciliacion_fecha_limite_fijada',
    entidadTipo: 'evento_conciliacion',
    entidadId: eventoId,
    detalle: { valor: fechaLimite, valor_anterior: valorAnterior },
  });

  const { error: errorUpdate } = await supabase
    .schema('dinero')
    .from('eventos_conciliacion')
    .update({ fecha_limite: fechaLimite, actualizado_en: new Date().toISOString() })
    .eq('id', eventoId)
    .eq('tenant_id', tenantId);

  if (errorUpdate) {
    throw new Error(`Error al fijar la fecha límite del evento de conciliación: ${errorUpdate.message}`);
  }

  await registrarHistorialConciliacion(supabase, {
    tenantId,
    eventoId,
    tipoCambio: 'fecha_limite',
    datos: { valor: fechaLimite, valor_anterior: valorAnterior },
    actorUsuarioId,
  });
}

// -----------------------------------------------------------------------------
// 5. fijarBloqueosConciliacion
// -----------------------------------------------------------------------------

/**
 * Fija los flags de bloqueo de acciones financieras (`bloquea_facturacion` /
 * `bloquea_pago`) de una excepción de conciliación. Espeja el CHECK SQL
 * `eventos_conciliacion_bloqueo_motivo` (no confía solo en el CHECK — da un
 * error de validación legible antes de golpear la BD): si alguno de los dos
 * flags queda en `true`, `motivoBloqueo` es obligatorio (no vacío).
 */
export async function fijarBloqueosConciliacion(
  tenantId: string,
  eventoId: string,
  opciones: { bloqueaFacturacion: boolean; bloqueaPago: boolean; motivoBloqueo: string | null },
  usuario: UsuarioActual,
  actorUsuarioId: string,
): Promise<void> {
  exigirPermisoConciliacion(usuario);

  const { bloqueaFacturacion, bloqueaPago } = opciones;
  const motivo = opciones.motivoBloqueo?.trim() ?? '';

  if ((bloqueaFacturacion || bloqueaPago) && motivo.length === 0) {
    throw new ErrorValidacion('Indica el motivo del bloqueo antes de bloquear la facturación o el pago.');
  }

  const supabase = crearClienteServiceRole();
  const evento = await cargarEventoConciliacionOrThrow(supabase, tenantId, eventoId);

  const anteriores = {
    bloqueaFacturacion: (evento.bloquea_facturacion as boolean | null) ?? false,
    bloqueaPago: (evento.bloquea_pago as boolean | null) ?? false,
    motivoBloqueo: (evento.motivo_bloqueo as string | null) ?? null,
  };

  await registrarEnBitacora(supabase, {
    tenantId,
    actorUsuarioId,
    actorTipo: 'usuario',
    accion: 'dinero.evento_conciliacion_bloqueo_fijado',
    entidadTipo: 'evento_conciliacion',
    entidadId: eventoId,
    detalle: {
      bloquea_facturacion: bloqueaFacturacion,
      bloquea_pago: bloqueaPago,
      motivo_bloqueo: motivo || null,
      bloquea_facturacion_anterior: anteriores.bloqueaFacturacion,
      bloquea_pago_anterior: anteriores.bloqueaPago,
    },
  });

  const { error: errorUpdate } = await supabase
    .schema('dinero')
    .from('eventos_conciliacion')
    .update({
      bloquea_facturacion: bloqueaFacturacion,
      bloquea_pago: bloqueaPago,
      motivo_bloqueo: motivo || null,
      actualizado_en: new Date().toISOString(),
    })
    .eq('id', eventoId)
    .eq('tenant_id', tenantId);

  if (errorUpdate) {
    throw new Error(`Error al fijar el bloqueo del evento de conciliación: ${errorUpdate.message}`);
  }

  await registrarHistorialConciliacion(supabase, {
    tenantId,
    eventoId,
    tipoCambio: 'bloqueo',
    comentario: motivo || null,
    datos: {
      bloquea_facturacion: bloqueaFacturacion,
      bloquea_pago: bloqueaPago,
      bloquea_facturacion_anterior: anteriores.bloqueaFacturacion,
      bloquea_pago_anterior: anteriores.bloqueaPago,
      motivo_bloqueo_anterior: anteriores.motivoBloqueo,
    },
    actorUsuarioId,
  });
}

// -----------------------------------------------------------------------------
// 6. cambiarAccionSugeridaConciliacion
// -----------------------------------------------------------------------------

const ACCIONES_SUGERIDAS_VALIDAS: ReadonlySet<AccionSugeridaConciliacion> = new Set([
  'revisar_tarifa_aplicada',
  'confirmar_con_seller',
  'confirmar_con_conductor',
  'generar_cobro_manual',
  'generar_ajuste_liquidacion',
  'reasignar_lineas_a_periodo',
  'reenviar_o_verificar_dte',
  'gestionar_cobranza_seller',
  'gestionar_pago_conductor',
  'marcar_error_del_motor',
  'sin_accion_requerida',
  'revisar_estado_externo',
]);

/** Cambia la acción sugerida de una excepción de conciliación. */
export async function cambiarAccionSugeridaConciliacion(
  tenantId: string,
  eventoId: string,
  accionSugerida: AccionSugeridaConciliacion,
  usuario: UsuarioActual,
  actorUsuarioId: string,
): Promise<void> {
  exigirPermisoConciliacion(usuario);

  if (!ACCIONES_SUGERIDAS_VALIDAS.has(accionSugerida)) {
    throw new ErrorValidacion(`Acción sugerida inválida: "${accionSugerida}".`);
  }

  const supabase = crearClienteServiceRole();
  const evento = await cargarEventoConciliacionOrThrow(supabase, tenantId, eventoId);
  const valorAnterior = evento.accion_sugerida as AccionSugeridaConciliacion;

  await registrarEnBitacora(supabase, {
    tenantId,
    actorUsuarioId,
    actorTipo: 'usuario',
    accion: 'dinero.evento_conciliacion_accion_sugerida_cambiada',
    entidadTipo: 'evento_conciliacion',
    entidadId: eventoId,
    detalle: { valor: accionSugerida, valor_anterior: valorAnterior },
  });

  const { error: errorUpdate } = await supabase
    .schema('dinero')
    .from('eventos_conciliacion')
    .update({ accion_sugerida: accionSugerida, actualizado_en: new Date().toISOString() })
    .eq('id', eventoId)
    .eq('tenant_id', tenantId);

  if (errorUpdate) {
    throw new Error(`Error al cambiar la acción sugerida del evento de conciliación: ${errorUpdate.message}`);
  }

  await registrarHistorialConciliacion(supabase, {
    tenantId,
    eventoId,
    tipoCambio: 'accion_sugerida',
    datos: { valor: accionSugerida, valor_anterior: valorAnterior },
    actorUsuarioId,
  });
}

// -----------------------------------------------------------------------------
// 7. agregarComentarioConciliacion
// -----------------------------------------------------------------------------

/**
 * Agrega un comentario libre al historial de una excepción de conciliación,
 * SIN mutar la fila padre (solo bitácora + INSERT en el historial).
 */
export async function agregarComentarioConciliacion(
  tenantId: string,
  eventoId: string,
  comentario: string,
  usuario: UsuarioActual,
  actorUsuarioId: string,
): Promise<void> {
  exigirPermisoConciliacion(usuario);

  const comentarioLimpio = validarMotivo(comentario);

  const supabase = crearClienteServiceRole();
  // Confirma existencia + tenant (aislamiento) aunque no se actualice la fila padre.
  await cargarEventoConciliacionOrThrow(supabase, tenantId, eventoId);

  await registrarEnBitacora(supabase, {
    tenantId,
    actorUsuarioId,
    actorTipo: 'usuario',
    accion: 'dinero.evento_conciliacion_comentado',
    entidadTipo: 'evento_conciliacion',
    entidadId: eventoId,
    detalle: { comentario: comentarioLimpio },
  });

  await registrarHistorialConciliacion(supabase, {
    tenantId,
    eventoId,
    tipoCambio: 'comentario',
    comentario: comentarioLimpio,
    actorUsuarioId,
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

  const motivoLimpio = validarMotivo(motivo);

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

// =============================================================================
// anularLineaCobroPedido — corrección manual del cobro (B2)
// =============================================================================

/**
 * Anula manualmente la línea de cobro de un pedido cuando el cobro al seller no
 * corresponde — p. ej. un fallido que el motor cargó por defecto (incidencia
 * `tipo='otro'` ⇒ afecta_cobro=true) pero que, revisado, no debe facturarse.
 *
 * Es la palanca que faltaba: la afectación de la incidencia se fija al abrir y
 * no se puede reclasificar, así que esta acción permite a dueño/administración
 * corregir el dinero directamente, SIN depender del `tipo` de la incidencia.
 *
 * Precondiciones:
 * - Capacidad `ver_conciliacion` (dueño o administración) — es una acción
 *   financiera; el supervisor gestiona la incidencia, no el cobro.
 * - La línea debe existir, no estar ya anulada, y su período debe seguir
 *   `abierto` (mutable). Si el período está cerrado/facturado, la corrección va
 *   por nota de crédito (RF-038), no por anulación.
 *
 * Efectos (BITÁCORA ANTES del efecto, con `actorUsuarioId` — RNF-04):
 * - Registra `dinero.linea_cobro_anulada_manual` (con motivo) en bitácora.
 * - Marca la línea `anulada=true` (los totales del período la excluyen).
 * - Resetea `operacion.pedidos.cobro_generado=false`.
 */
export async function anularLineaCobroPedido(
  tenantId: string,
  pedidoId: string,
  motivo: string,
  usuario: UsuarioActual,
  actorUsuarioId: string,
): Promise<void> {
  if (!puedeVerConciliacion(usuario)) {
    throw new ErrorValidacion('Solo el dueño o administración puede anular líneas de cobro.');
  }

  const motivoLimpio = validarMotivo(motivo);
  const supabase = crearClienteServiceRole();

  const { data: linea, error: errLinea } = await supabase
    .schema('dinero')
    .from('lineas_cobro')
    .select('id, anulada, periodo_cobro_id, monto_final_clp')
    .eq('pedido_id', pedidoId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (errLinea) throw new Error(`Error al leer línea de cobro: ${errLinea.message}`);
  if (!linea) throw new ErrorValidacion('No hay línea de cobro para este pedido.');
  if (linea.anulada) throw new ErrorValidacion('La línea de cobro ya está anulada.');

  if (linea.periodo_cobro_id) {
    const { data: periodo, error: errPeriodo } = await supabase
      .schema('dinero')
      .from('periodos_cobro')
      .select('estado')
      .eq('id', linea.periodo_cobro_id as string)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (errPeriodo) throw new Error(`Error al leer período: ${errPeriodo.message}`);
    if (periodo && periodo.estado !== 'abierto') {
      throw new ErrorValidacion(
        `No se puede anular: el período está '${periodo.estado}'. Para revertir un cobro ya facturado, emite una nota de crédito.`,
      );
    }
  }

  await registrarEnBitacora(supabase, {
    tenantId,
    actorUsuarioId,
    actorTipo: 'usuario',
    accion: 'dinero.linea_cobro_anulada_manual',
    entidadTipo: 'pedido',
    entidadId: pedidoId,
    detalle: {
      linea_id: linea.id,
      periodo_cobro_id: linea.periodo_cobro_id ?? null,
      monto_final_clp: Math.round(Number(linea.monto_final_clp ?? 0)),
      motivo: motivoLimpio,
    },
  });

  const { error: errUpdate } = await supabase
    .schema('dinero')
    .from('lineas_cobro')
    .update({
      anulada: true,
      anulada_en: new Date().toISOString(),
      motivo_anulacion: 'ajuste_manual',
      actualizado_en: new Date().toISOString(),
    })
    .eq('id', linea.id as string)
    .eq('tenant_id', tenantId)
    .eq('anulada', false); // idempotente
  if (errUpdate) throw new Error(`Error al anular línea de cobro: ${errUpdate.message}`);

  await supabase
    .schema('operacion')
    .from('pedidos')
    .update({ cobro_generado: false, actualizado_en: new Date().toISOString() })
    .eq('id', pedidoId)
    .eq('tenant_id', tenantId);
}

// =============================================================================
// anularLineaLiquidacionPedido — corrección manual de la liquidación (B2)
// =============================================================================

/**
 * Anula manualmente la línea de liquidación de un pedido cuando no corresponde
 * pagar al conductor por ese pedido. Análoga a `anularLineaCobroPedido` para el
 * lado del dinero saliente.
 *
 * Precondiciones:
 * - Capacidad `gestionar_liquidaciones_conductores` (dueño o administración).
 * - La línea debe existir, no estar anulada, y su liquidación debe seguir en
 *   `borrador` (las `emitida`/`pagada` son inmutables).
 *
 * Efectos (BITÁCORA ANTES del efecto, con `actorUsuarioId`):
 * - Registra `dinero.linea_liquidacion_anulada_manual` en bitácora.
 * - Marca la línea `anulada=true` y resetea `pedidos.liquidacion_generada=false`.
 */
export async function anularLineaLiquidacionPedido(
  tenantId: string,
  pedidoId: string,
  motivo: string,
  usuario: UsuarioActual,
  actorUsuarioId: string,
): Promise<void> {
  if (!puedeGestionarLiquidacionesConductores(usuario)) {
    throw new ErrorValidacion(
      'Solo el dueño o administración puede anular líneas de liquidación.',
    );
  }

  const motivoLimpio = validarMotivo(motivo);
  const supabase = crearClienteServiceRole();

  const { data: linea, error: errLinea } = await supabase
    .schema('dinero')
    .from('lineas_liquidacion')
    .select('id, anulada, liquidacion_id, monto_final_clp')
    .eq('pedido_id', pedidoId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (errLinea) throw new Error(`Error al leer línea de liquidación: ${errLinea.message}`);
  if (!linea) throw new ErrorValidacion('No hay línea de liquidación para este pedido.');
  if (linea.anulada) throw new ErrorValidacion('La línea de liquidación ya está anulada.');

  if (linea.liquidacion_id) {
    const { data: liq, error: errLiq } = await supabase
      .schema('dinero')
      .from('liquidaciones')
      .select('estado')
      .eq('id', linea.liquidacion_id as string)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (errLiq) throw new Error(`Error al leer liquidación: ${errLiq.message}`);
    if (liq && liq.estado !== 'borrador') {
      throw new ErrorValidacion(
        `No se puede anular: la liquidación está '${liq.estado}'. Solo se anulan líneas de liquidaciones en borrador.`,
      );
    }
  }

  await registrarEnBitacora(supabase, {
    tenantId,
    actorUsuarioId,
    actorTipo: 'usuario',
    accion: 'dinero.linea_liquidacion_anulada_manual',
    entidadTipo: 'pedido',
    entidadId: pedidoId,
    detalle: {
      linea_id: linea.id,
      liquidacion_id: linea.liquidacion_id ?? null,
      monto_final_clp: Math.round(Number(linea.monto_final_clp ?? 0)),
      motivo: motivoLimpio,
    },
  });

  const { error: errUpdate } = await supabase
    .schema('dinero')
    .from('lineas_liquidacion')
    .update({
      anulada: true,
      anulada_en: new Date().toISOString(),
      motivo_anulacion: 'ajuste_manual',
      actualizado_en: new Date().toISOString(),
    })
    .eq('id', linea.id as string)
    .eq('tenant_id', tenantId)
    .eq('anulada', false);
  if (errUpdate) throw new Error(`Error al anular línea de liquidación: ${errUpdate.message}`);

  await supabase
    .schema('operacion')
    .from('pedidos')
    .update({ liquidacion_generada: false, actualizado_en: new Date().toISOString() })
    .eq('id', pedidoId)
    .eq('tenant_id', tenantId);
}

// =============================================================================
// anularLineaLiquidacion — por ID de línea (etapa 8)
// =============================================================================

/**
 * Anula una línea de liquidación identificándola por SU PROPIO ID.
 *
 * POR QUÉ EXISTE, SI YA HAY `anularLineaLiquidacionPedido`. Porque aquella está
 * cableada por `pedidoId` de punta a punta —la lee con `.eq('pedido_id', …)`,
 * la audita contra la entidad `pedido` y al final marca `liquidacion_generada`
 * en la fila del pedido— y una línea de RETIRO EN BODEGA no tiene pedido. Sin
 * esta función no había ningún camino en el producto para anular el pago de una
 * visita: quedaba escrita para siempre.
 *
 * El id de la línea es lo ÚNICO que las dos clases comparten, así que es la
 * llave correcta. La de pedido no se retira: sigue siendo la que usa la ficha
 * del pedido, donde el usuario no conoce el id de la línea.
 *
 * ⚠️ NO toca `operacion.pedidos.liquidacion_generada`: en una línea de retiro no
 * hay pedido que marcar, y en una de entrega esa bandera la gobierna la función
 * hermana. Duplicar la escritura acá crearía dos dueños del mismo campo.
 *
 * La visita en sí NO se borra ni se marca: lo que se anula es el PAGO, no el
 * hecho. El conductor fue a la bodega igual, y el acta de retiro lo respalda.
 */
export async function anularLineaLiquidacion(
  tenantId: string,
  lineaId: string,
  motivo: string,
  usuario: UsuarioActual,
  actorUsuarioId: string,
): Promise<void> {
  if (!puedeGestionarLiquidacionesConductores(usuario)) {
    throw new ErrorValidacion(
      'Solo el dueño o administración puede anular líneas de liquidación.',
    );
  }

  const motivoLimpio = validarMotivo(motivo);
  const supabase = crearClienteServiceRole();

  const { data: linea, error: errLinea } = await supabase
    .schema('dinero')
    .from('lineas_liquidacion')
    .select('id, anulada, liquidacion_id, monto_final_clp, tipo_hecho, sesion_retiro_id, driver_id')
    .eq('id', lineaId)
    // El filtro de tenant NO es redundante con el id: sin él, conocer un uuid
    // ajeno bastaría para anularle una línea a otro courier.
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (errLinea) throw new Error(`Error al leer línea de liquidación: ${errLinea.message}`);
  if (!linea) throw new ErrorValidacion('No existe esa línea de liquidación.');
  if (linea.anulada) throw new ErrorValidacion('La línea de liquidación ya está anulada.');

  if (linea.liquidacion_id) {
    const { data: liq, error: errLiq } = await supabase
      .schema('dinero')
      .from('liquidaciones')
      .select('estado')
      .eq('id', linea.liquidacion_id as string)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (errLiq) throw new Error(`Error al leer liquidación: ${errLiq.message}`);
    if (liq && liq.estado !== 'borrador') {
      throw new ErrorValidacion(
        `No se puede anular: la liquidación está '${liq.estado}'. Solo se anulan líneas de liquidaciones en borrador.`,
      );
    }
  }

  // Bitácora ANTES del efecto (invariante de CLAUDE.md), y con el autor: es una
  // acción financiera de un humano.
  await registrarEnBitacora(supabase, {
    tenantId,
    actorUsuarioId,
    actorTipo: 'usuario',
    accion: 'dinero.linea_liquidacion_anulada_manual',
    entidadTipo: 'linea_liquidacion',
    entidadId: lineaId,
    detalle: {
      tipo_hecho: linea.tipo_hecho,
      driver_id: linea.driver_id,
      sesion_retiro_id: linea.sesion_retiro_id ?? null,
      liquidacion_id: linea.liquidacion_id ?? null,
      monto_final_clp: Math.round(Number(linea.monto_final_clp ?? 0)),
      motivo: motivoLimpio,
    },
  });

  // `.eq('anulada', false)` es compare-and-set: si otra sesión la anuló entre la
  // lectura y esta escritura, no casa ninguna fila y no se pisa su motivo.
  const { error: errUpdate } = await supabase
    .schema('dinero')
    .from('lineas_liquidacion')
    .update({
      anulada: true,
      anulada_en: new Date().toISOString(),
      motivo_anulacion: 'ajuste_manual',
      actualizado_en: new Date().toISOString(),
    })
    .eq('id', lineaId)
    .eq('tenant_id', tenantId)
    .eq('anulada', false);
  if (errUpdate) throw new Error(`Error al anular línea de liquidación: ${errUpdate.message}`);
}

// =============================================================================
// registrarPreflightOmitido — override del preflight P0 (auditoría jul 2026)
// =============================================================================

/**
 * Registra en bitácora que el usuario decidió CONTINUAR con una acción
 * financiera irreversible (`emitirFacturaPeriodo`, `emitirNotaCreditoPeriodo`,
 * `emitirPagoLiquidacion`) sin un preflight válido — el preflight de
 * `src/modules/dinero/preflight.ts` falló al ejecutarse (error de red/lectura,
 * escenario degradado), y el usuario eligió "continuar bajo mi
 * responsabilidad" en vez de reintentar.
 *
 * Esta función NUNCA reemplaza al preflight normal: cuando el preflight sí
 * corre y solo muestra advertencias (categoría `advierte`/`informativo`), el
 * usuario simplemente confirma la acción real — no hace falta este override.
 * Solo existe para el caso en que el preflight mismo no pudo evaluarse.
 *
 * Exige la MISMA capacidad RBAC que la acción financiera que se está por
 * ejecutar (factura/NC → `emitir_facturas`; pago → `gestionar_liquidaciones_
 * conductores`) — el override no es una puerta trasera para saltarse permisos.
 *
 * @param actorUsuarioId UUID de auth del usuario que decide continuar
 *   (`sesion.usuarioId`). Queda en la bitácora — RNF-04 exige el "quién".
 */
export async function registrarPreflightOmitido(
  tenantId: string,
  tipoAccion: TipoAccionDinero,
  entidadId: string,
  usuario: UsuarioActual,
  actorUsuarioId: string,
): Promise<void> {
  const esAccionDeFacturacion = tipoAccion === 'emitir_factura' || tipoAccion === 'emitir_nota_credito';

  const autorizado = esAccionDeFacturacion
    ? puedeEmitirFacturas(usuario)
    : puedeGestionarLiquidacionesConductores(usuario);

  if (!autorizado) {
    throw new ErrorValidacion('No tienes permiso para continuar sin verificación previa en esta acción.');
  }

  const supabase = crearClienteServiceRole();

  await registrarEnBitacora(supabase, {
    tenantId,
    actorUsuarioId,
    actorTipo: 'usuario',
    accion: 'dinero.preflight_omitido',
    entidadTipo: esAccionDeFacturacion ? 'periodo_cobro' : 'liquidacion',
    entidadId,
    detalle: {
      tipo_accion: tipoAccion,
    },
  });
}
