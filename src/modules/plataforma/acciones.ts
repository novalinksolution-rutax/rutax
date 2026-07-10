/**
 * Acciones del módulo `plataforma` — gestión de suscripciones SaaS de Rutax.
 *
 * Estas funciones son ejecutadas EXCLUSIVAMENTE por el super-admin de Rutax
 * (nunca por el courier/tenant autenticado). Todas:
 * - Verifican `adminSecret` contra `SUPER_ADMIN_SECRET` al inicio.
 * - Usan `crearClienteServiceRole()` para bypassar RLS (el schema `plataforma`
 *   tiene deny-all para `authenticated`).
 * - Registran en `bitacora_auditoria` con `actorTipo: 'super_admin'` antes de
 *   cualquier efecto externo (invariante del proyecto, RNF-04).
 *
 * NO son `'use server'` — son funciones puras del módulo que el llamador
 * (route handler o action del área super-admin) importa y llama.
 *
 * NUNCA loguear `adminSecret`.
 */

import { timingSafeEqual } from 'node:crypto';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import { obtenerPuertoCheckout } from '@/modules/integraciones/pagos';
import type { EstadoSuscripcion, MetodoPago } from './tipos';

// =============================================================================
// Guard de autenticación del super-admin
// =============================================================================

function verificarAdminSecret(adminSecret: string): void {
  const esperado = process.env.SUPER_ADMIN_SECRET;
  if (!esperado) {
    throw new Error('SUPER_ADMIN_SECRET no está configurado en el entorno del servidor.');
  }
  // Comparación de tiempo constante para no filtrar el secreto vía timing.
  // Longitudes distintas ⇒ no autorizado (timingSafeEqual lanzaría si difieren).
  const recibido = Buffer.from(adminSecret ?? '', 'utf8');
  const referencia = Buffer.from(esperado, 'utf8');
  if (recibido.length !== referencia.length || !timingSafeEqual(recibido, referencia)) {
    throw new Error('No autorizado');
  }
}

// =============================================================================
// asignarPlan
// =============================================================================

/**
 * Asigna (o actualiza) un plan a un courier (tenant).
 *
 * Hace upsert en `plataforma.suscripciones` con ON CONFLICT en `tenant_id`:
 * si el tenant ya tiene suscripción, actualiza el plan, estado y notas.
 *
 * Registra en bitácora ANTES del upsert.
 */
export async function asignarPlan(opts: {
  adminSecret: string;
  tenantId: string;
  planId: string;
  estado?: EstadoSuscripcion;
  trialHasta?: string;
  notas?: string;
}): Promise<{ ok: boolean; suscripcionId: string }> {
  verificarAdminSecret(opts.adminSecret);

  const supabase = crearClienteServiceRole();
  const ahora = new Date().toISOString();
  const estadoFinal: EstadoSuscripcion = opts.estado ?? 'trial';

  // Bitácora ANTES del upsert (acción financiera — RNF-04)
  await registrarEnBitacora(supabase, {
    tenantId: opts.tenantId,
    actorUsuarioId: null,
    actorTipo: 'super_admin',
    accion: 'plataforma.plan_asignado',
    entidadTipo: 'suscripcion',
    entidadId: opts.tenantId,
    detalle: {
      plan_id: opts.planId,
      estado: estadoFinal,
      trial_hasta: opts.trialHasta ?? null,
    },
  });

  const { data, error } = await supabase
    .schema('plataforma')
    .from('suscripciones')
    .upsert(
      {
        tenant_id: opts.tenantId,
        plan_id: opts.planId,
        estado: estadoFinal,
        trial_hasta: opts.trialHasta ?? null,
        notas: opts.notas ?? null,
        actualizado_en: ahora,
      },
      { onConflict: 'tenant_id' },
    )
    .select('id')
    .single();

  if (error) throw new Error(`Error al asignar plan al tenant: ${error.message}`);
  if (!data) throw new Error('El upsert de suscripción no devolvió datos.');

  return { ok: true, suscripcionId: data.id as string };
}

// =============================================================================
// activarSuscripcion
// =============================================================================

/**
 * Activa una suscripción (trial → activa o suspendida → activa).
 * Registra `activa_desde` con la fecha de hoy.
 */
export async function activarSuscripcion(opts: {
  adminSecret: string;
  suscripcionId: string;
  notas?: string;
}): Promise<{ ok: boolean }> {
  verificarAdminSecret(opts.adminSecret);

  const supabase = crearClienteServiceRole();
  const ahora = new Date().toISOString();
  const hoy = ahora.slice(0, 10);

  // Leer para obtener tenant_id (necesario para la bitácora)
  const { data: susc, error: errLectura } = await supabase
    .schema('plataforma')
    .from('suscripciones')
    .select('id, tenant_id, estado, notas')
    .eq('id', opts.suscripcionId)
    .maybeSingle();

  if (errLectura) throw new Error(`Error al leer suscripción: ${errLectura.message}`);
  if (!susc) throw new Error(`Suscripción ${opts.suscripcionId} no encontrada.`);

  // Bitácora ANTES del efecto
  await registrarEnBitacora(supabase, {
    tenantId: susc.tenant_id as string,
    actorUsuarioId: null,
    actorTipo: 'super_admin',
    accion: 'plataforma.suscripcion_activada',
    entidadTipo: 'suscripcion',
    entidadId: opts.suscripcionId,
    detalle: {
      estado_anterior: susc.estado,
      activa_desde: hoy,
      notas: opts.notas ?? null,
    },
  });

  const { error } = await supabase
    .schema('plataforma')
    .from('suscripciones')
    .update({
      estado: 'activa' as EstadoSuscripcion,
      activa_desde: hoy,
      notas: opts.notas !== undefined ? opts.notas : susc.notas,
      actualizado_en: ahora,
    })
    .eq('id', opts.suscripcionId);

  if (error) throw new Error(`Error al activar suscripción: ${error.message}`);

  return { ok: true };
}

// =============================================================================
// suspenderSuscripcion
// =============================================================================

/**
 * Suspende una suscripción activa o en trial.
 */
export async function suspenderSuscripcion(opts: {
  adminSecret: string;
  suscripcionId: string;
  notas?: string;
}): Promise<{ ok: boolean }> {
  verificarAdminSecret(opts.adminSecret);

  const supabase = crearClienteServiceRole();
  const ahora = new Date().toISOString();

  const { data: susc, error: errLectura } = await supabase
    .schema('plataforma')
    .from('suscripciones')
    .select('id, tenant_id, estado, notas')
    .eq('id', opts.suscripcionId)
    .maybeSingle();

  if (errLectura) throw new Error(`Error al leer suscripción: ${errLectura.message}`);
  if (!susc) throw new Error(`Suscripción ${opts.suscripcionId} no encontrada.`);

  // Bitácora ANTES del efecto
  await registrarEnBitacora(supabase, {
    tenantId: susc.tenant_id as string,
    actorUsuarioId: null,
    actorTipo: 'super_admin',
    accion: 'plataforma.suscripcion_suspendida',
    entidadTipo: 'suscripcion',
    entidadId: opts.suscripcionId,
    detalle: {
      estado_anterior: susc.estado,
      notas: opts.notas ?? null,
    },
  });

  const { error } = await supabase
    .schema('plataforma')
    .from('suscripciones')
    .update({
      estado: 'suspendida' as EstadoSuscripcion,
      notas: opts.notas !== undefined ? opts.notas : susc.notas,
      actualizado_en: ahora,
    })
    .eq('id', opts.suscripcionId);

  if (error) throw new Error(`Error al suspender suscripción: ${error.message}`);

  return { ok: true };
}

// =============================================================================
// cancelarSuscripcion
// =============================================================================

/**
 * Cancela una suscripción (estado terminal).
 * Registra `cancelada_en` con el timestamp actual.
 */
export async function cancelarSuscripcion(opts: {
  adminSecret: string;
  suscripcionId: string;
  notas?: string;
}): Promise<{ ok: boolean }> {
  verificarAdminSecret(opts.adminSecret);

  const supabase = crearClienteServiceRole();
  const ahora = new Date().toISOString();

  const { data: susc, error: errLectura } = await supabase
    .schema('plataforma')
    .from('suscripciones')
    .select('id, tenant_id, estado, notas')
    .eq('id', opts.suscripcionId)
    .maybeSingle();

  if (errLectura) throw new Error(`Error al leer suscripción: ${errLectura.message}`);
  if (!susc) throw new Error(`Suscripción ${opts.suscripcionId} no encontrada.`);

  // Bitácora ANTES del efecto
  await registrarEnBitacora(supabase, {
    tenantId: susc.tenant_id as string,
    actorUsuarioId: null,
    actorTipo: 'super_admin',
    accion: 'plataforma.suscripcion_cancelada',
    entidadTipo: 'suscripcion',
    entidadId: opts.suscripcionId,
    detalle: {
      estado_anterior: susc.estado,
      notas: opts.notas ?? null,
    },
  });

  const { error } = await supabase
    .schema('plataforma')
    .from('suscripciones')
    .update({
      estado: 'cancelada' as EstadoSuscripcion,
      cancelada_en: ahora,
      notas: opts.notas !== undefined ? opts.notas : susc.notas,
      actualizado_en: ahora,
    })
    .eq('id', opts.suscripcionId);

  if (error) throw new Error(`Error al cancelar suscripción: ${error.message}`);

  return { ok: true };
}

// =============================================================================
// registrarPagoManual
// =============================================================================

/**
 * Registra un pago manual (transferencia o cortesía) para un período y lo
 * marca como pagado.
 *
 * Flujo:
 * 1. Lee el período para obtener monto y tenant_id.
 * 2. Registra en bitácora (ANTES del efecto — RNF-04).
 * 3. Inserta en `plataforma.pagos_plataforma` con estado 'confirmado'.
 * 4. Actualiza el período a 'pagado'.
 */
export async function registrarPagoManual(opts: {
  adminSecret: string;
  periodoId: string;
  metodo: Extract<MetodoPago, 'transferencia_manual' | 'cortesia'>;
  notas?: string;
}): Promise<{ ok: boolean }> {
  verificarAdminSecret(opts.adminSecret);

  const supabase = crearClienteServiceRole();
  const ahora = new Date().toISOString();

  // Leer período para obtener monto y tenant_id
  const { data: periodo, error: errPeriodo } = await supabase
    .schema('plataforma')
    .from('periodos_suscripcion')
    .select('id, suscripcion_id, tenant_id, monto_clp, estado')
    .eq('id', opts.periodoId)
    .maybeSingle();

  if (errPeriodo) throw new Error(`Error al leer período: ${errPeriodo.message}`);
  if (!periodo) throw new Error(`Período ${opts.periodoId} no encontrado.`);
  if (periodo.estado === 'pagado') {
    throw new Error(`El período ${opts.periodoId} ya está pagado.`);
  }

  const tenantId = periodo.tenant_id as string;
  const montoClp = Number(periodo.monto_clp);

  // Bitácora ANTES del INSERT (acción financiera — RNF-04)
  await registrarEnBitacora(supabase, {
    tenantId,
    actorUsuarioId: null,
    actorTipo: 'super_admin',
    accion: 'plataforma.pago_manual_registrado',
    entidadTipo: 'periodo_suscripcion',
    entidadId: opts.periodoId,
    detalle: {
      monto_clp: montoClp,
      metodo: opts.metodo,
    },
  });

  // Insertar pago
  const { error: errPago } = await supabase
    .schema('plataforma')
    .from('pagos_plataforma')
    .insert({
      periodo_id: opts.periodoId,
      tenant_id: tenantId,
      monto_clp: montoClp,
      metodo: opts.metodo,
      estado: 'confirmado',
      pagado_en: ahora,
      notas: opts.notas ?? null,
    });

  if (errPago) throw new Error(`Error al registrar pago: ${errPago.message}`);

  // Marcar período como pagado
  const { error: errUpdate } = await supabase
    .schema('plataforma')
    .from('periodos_suscripcion')
    .update({ estado: 'pagado' })
    .eq('id', opts.periodoId);

  if (errUpdate) throw new Error(`Error al marcar período como pagado: ${errUpdate.message}`);

  return { ok: true };
}

// =============================================================================
// generarLinkCobroPeriodo — cobro por link Fintoc (Payment Links)
// =============================================================================

/**
 * Genera un link de pago Fintoc para cobrar un período de suscripción e inserta
 * el pago en estado `pendiente`. El pago se CONFIRMA de forma asíncrona por el
 * webhook (`/api/webhooks/fintoc-suscripcion`), que marca el período `pagado`.
 *
 * Gate sandbox/real (molde payout/DTE): con `SUSCRIPCION_SANDBOX_MODE` != "false"
 * la fábrica devuelve el stub → un link ficticio de sandbox que NO cobra. Real
 * solo con la bandera en "false" + `FINTOC_SECRET_KEY`.
 *
 * Bitácora ANTES del efecto externo (llamada a Fintoc) — RNF-04, actor super_admin.
 */
export async function generarLinkCobroPeriodo(opts: {
  adminSecret: string;
  periodoId: string;
}): Promise<{ ok: boolean; url: string; linkExternoId: string; modo: 'test' | 'live' }> {
  verificarAdminSecret(opts.adminSecret);

  const supabase = crearClienteServiceRole();

  const { data: periodo, error: errPeriodo } = await supabase
    .schema('plataforma')
    .from('periodos_suscripcion')
    .select('id, tenant_id, monto_clp, estado, periodo_inicio, periodo_fin')
    .eq('id', opts.periodoId)
    .maybeSingle();

  if (errPeriodo) throw new Error(`Error al leer período: ${errPeriodo.message}`);
  if (!periodo) throw new Error(`Período ${opts.periodoId} no encontrado.`);
  if (periodo.estado === 'pagado') throw new Error(`El período ${opts.periodoId} ya está pagado.`);

  const tenantId = periodo.tenant_id as string;
  const montoClp = Number(periodo.monto_clp);
  if (!Number.isFinite(montoClp) || montoClp <= 0) {
    throw new Error('El período no tiene un monto cobrable (monto_clp <= 0).');
  }

  // Bitácora ANTES del efecto externo (crear el link en Fintoc) — RNF-04.
  await registrarEnBitacora(supabase, {
    tenantId,
    actorUsuarioId: null,
    actorTipo: 'super_admin',
    accion: 'plataforma.link_cobro_generado',
    entidadTipo: 'periodo_suscripcion',
    entidadId: opts.periodoId,
    detalle: { monto_clp: montoClp, metodo: 'fintoc_link' },
  });

  // Crear el link (stub en sandbox; Fintoc real con el gate abierto).
  const puerto = obtenerPuertoCheckout();
  const link = await puerto.crearLinkPago({
    montoClp,
    descripcion: `Suscripción Rutax · período ${periodo.periodo_inicio} a ${periodo.periodo_fin}`,
    // `metadata` viaja a Fintoc y vuelve en el webhook → correlación del pago.
    metadata: { periodo_id: opts.periodoId, tenant_id: tenantId },
  });

  // Registrar el pago pendiente con la referencia externa del link.
  const { error: errPago } = await supabase
    .schema('plataforma')
    .from('pagos_plataforma')
    .insert({
      periodo_id: opts.periodoId,
      tenant_id: tenantId,
      monto_clp: montoClp,
      metodo: 'fintoc_link',
      estado: 'pendiente',
      pago_externo_id: link.linkExternoId,
      link_pago_url: link.url,
    });

  if (errPago) throw new Error(`Error al registrar el pago pendiente: ${errPago.message}`);

  return { ok: true, url: link.url, linkExternoId: link.linkExternoId, modo: link.modo };
}

// =============================================================================
// generarPeriodoManual
// =============================================================================

/**
 * Genera un período de suscripción manualmente para una suscripción.
 *
 * Idempotente: si ya existe un período para `(suscripcion_id, periodo_inicio)`,
 * devuelve el id existente sin error (ON CONFLICT DO NOTHING + SELECT).
 */
export async function generarPeriodoManual(opts: {
  adminSecret: string;
  suscripcionId: string;
  periodoInicio: string;
  periodoFin: string;
  montoClp: number;
}): Promise<{ ok: boolean; periodoId: string }> {
  verificarAdminSecret(opts.adminSecret);

  const supabase = crearClienteServiceRole();

  // Leer suscripción para obtener tenant_id
  const { data: susc, error: errSusc } = await supabase
    .schema('plataforma')
    .from('suscripciones')
    .select('id, tenant_id')
    .eq('id', opts.suscripcionId)
    .maybeSingle();

  if (errSusc) throw new Error(`Error al leer suscripción: ${errSusc.message}`);
  if (!susc) throw new Error(`Suscripción ${opts.suscripcionId} no encontrada.`);

  const tenantId = susc.tenant_id as string;

  // Verificar si ya existe el período (para idempotencia)
  const { data: existente, error: errExistente } = await supabase
    .schema('plataforma')
    .from('periodos_suscripcion')
    .select('id')
    .eq('suscripcion_id', opts.suscripcionId)
    .eq('periodo_inicio', opts.periodoInicio)
    .maybeSingle();

  if (errExistente) throw new Error(`Error al verificar período existente: ${errExistente.message}`);

  if (existente) {
    // Ya existe — idempotente, devolver el id existente
    return { ok: true, periodoId: existente.id as string };
  }

  // Bitácora ANTES del INSERT
  await registrarEnBitacora(supabase, {
    tenantId,
    actorUsuarioId: null,
    actorTipo: 'super_admin',
    accion: 'plataforma.periodo_generado_manual',
    entidadTipo: 'periodo_suscripcion',
    entidadId: opts.suscripcionId,
    detalle: {
      periodo_inicio: opts.periodoInicio,
      periodo_fin: opts.periodoFin,
      monto_clp: opts.montoClp,
    },
  });

  const { data: nuevo, error: errInsert } = await supabase
    .schema('plataforma')
    .from('periodos_suscripcion')
    .insert({
      suscripcion_id: opts.suscripcionId,
      tenant_id: tenantId,
      periodo_inicio: opts.periodoInicio,
      periodo_fin: opts.periodoFin,
      monto_clp: opts.montoClp,
      estado: 'pendiente',
    })
    .select('id')
    .single();

  if (errInsert) throw new Error(`Error al generar período manual: ${errInsert.message}`);
  if (!nuevo) throw new Error('El INSERT de período no devolvió datos.');

  return { ok: true, periodoId: nuevo.id as string };
}
