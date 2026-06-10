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
