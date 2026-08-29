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
 * - Aceptan `opts.actorUsuarioId?: string | null` (default `null`,
 *   RETROCOMPATIBLE) — el uuid REAL del super-admin resuelto por
 *   `exigirActorAdmin()` (`app/admin/sesion-admin.ts`, gap 3 F2-mínimo). Los
 *   callers que no lo pasen conservan el comportamiento previo
 *   (`actorUsuarioId: null` en la bitácora).
 *
 * NO son `'use server'` — son funciones puras del módulo que el llamador
 * (route handler o action del área super-admin) importa y llama.
 *
 * NUNCA loguear `adminSecret` ni `actorUsuarioId`.
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
// Validadores compartidos del CRUD de planes / overrides
// =============================================================================

/** CLP entero (sin decimales) y no negativo — invariante de moneda de CLAUDE.md. */
function validarPrecioClp(valor: number, campo: string): void {
  if (!Number.isInteger(valor) || valor < 0) {
    throw new Error(`${campo} debe ser un monto CLP entero y no negativo.`);
  }
}

/** Entero no negativo genérico (p. ej. `limitePedidosMes`). */
function validarEnteroNoNegativo(valor: number, campo: string): void {
  if (!Number.isInteger(valor) || valor < 0) {
    throw new Error(`${campo} debe ser un número entero no negativo.`);
  }
}

/**
 * Llaves de características conocidas por el dominio — únicas que
 * `sanearJsonbPlano` deja pasar, tanto en `planes.caracteristicas` como en
 * `suscripciones.caracteristicas_override`. Espejo de lo que
 * `obtenerEntitlementsTenant` (`superficie-courier.ts`) efectivamente lee de
 * `caracteristicasEfectivas` (`conductores_max`, `api_publica`, `webhooks`) —
 * más `limite_pedidos_mes`, que esa misma función especialcasa SOLO desde el
 * override (pisa la columna dedicada `planes.limite_pedidos_mes` si la llave
 * está presente ahí explícitamente; en `caracteristicas` de plan no tiene
 * efecto, pero se whitelistea igual por consistencia y para no romper un
 * override que la traiga junto a otras llaves). Cualquier llave fuera de
 * esta lista se descarta en silencio antes de persistir — higiene: evita que
 * el catálogo/overrides acumulen "features" fantasma que ningún consumidor
 * del dominio interpreta.
 */
const LLAVES_CARACTERISTICAS_VALIDAS = new Set([
  'conductores_max',
  'api_publica',
  'webhooks',
  'limite_pedidos_mes',
]);

/**
 * `caracteristicas`/`override` deben ser un objeto jsonb plano (no array, no
 * null) — y se whitelistea a `LLAVES_CARACTERISTICAS_VALIDAS`: cualquier
 * llave desconocida se descarta antes de persistir.
 */
function sanearJsonbPlano(valor: Record<string, unknown>, campo: string): Record<string, unknown> {
  if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) {
    throw new Error(`${campo} debe ser un objeto jsonb plano (p. ej. { "conductores_max": 10 }).`);
  }
  const saneado: Record<string, unknown> = {};
  for (const [clave, val] of Object.entries(valor)) {
    if (LLAVES_CARACTERISTICAS_VALIDAS.has(clave)) {
      saneado[clave] = val;
    }
  }
  return saneado;
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
  /** UUID real del super-admin actor (vía `exigirActorAdmin()`). `null` = sin
   *  actor declarado (compat con callers previos al gap 3, F2-mínimo). */
  actorUsuarioId?: string | null;
}): Promise<{ ok: boolean; suscripcionId: string }> {
  verificarAdminSecret(opts.adminSecret);

  const supabase = crearClienteServiceRole();
  const ahora = new Date().toISOString();
  const estadoFinal: EstadoSuscripcion = opts.estado ?? 'trial';

  // Bitácora ANTES del upsert (acción financiera — RNF-04)
  await registrarEnBitacora(supabase, {
    tenantId: opts.tenantId,
    actorUsuarioId: opts.actorUsuarioId ?? null,
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
  /** UUID real del super-admin actor (vía `exigirActorAdmin()`). `null` = sin
   *  actor declarado (compat con callers previos al gap 3, F2-mínimo). */
  actorUsuarioId?: string | null;
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
    actorUsuarioId: opts.actorUsuarioId ?? null,
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
  /** UUID real del super-admin actor (vía `exigirActorAdmin()`). `null` = sin
   *  actor declarado (compat con callers previos al gap 3, F2-mínimo). */
  actorUsuarioId?: string | null;
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
    actorUsuarioId: opts.actorUsuarioId ?? null,
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
  /** UUID real del super-admin actor (vía `exigirActorAdmin()`). `null` = sin
   *  actor declarado (compat con callers previos al gap 3, F2-mínimo). */
  actorUsuarioId?: string | null;
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
    actorUsuarioId: opts.actorUsuarioId ?? null,
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
  /** UUID real del super-admin actor (vía `exigirActorAdmin()`). `null` = sin
   *  actor declarado (compat con callers previos al gap 3, F2-mínimo). */
  actorUsuarioId?: string | null;
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
    actorUsuarioId: opts.actorUsuarioId ?? null,
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
  /** UUID real del super-admin actor (vía `exigirActorAdmin()`). `null` = sin
   *  actor declarado (compat con callers previos al gap 3, F2-mínimo). */
  actorUsuarioId?: string | null;
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
    actorUsuarioId: opts.actorUsuarioId ?? null,
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
  /** UUID real del super-admin actor (vía `exigirActorAdmin()`). `null` = sin
   *  actor declarado (compat con callers previos al gap 3, F2-mínimo). */
  actorUsuarioId?: string | null;
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
    actorUsuarioId: opts.actorUsuarioId ?? null,
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

// =============================================================================
// crearPlan / actualizarPlan / activarDesactivarPlan — CRUD del catálogo
// =============================================================================
// "Ola 1" (monetización base) del backstage de plataforma, F2, ítem D.
// `plataforma.planes` no tiene RLS para `authenticated` (deny-all, migración
// 0015) — el catálogo lo edita EXCLUSIVAMENTE el super-admin, vía estas
// funciones. `obtenerCatalogoPlanesPublico` (superficie-courier.ts) es la
// ÚNICA proyección que el courier ve, y solo de planes `activo=true`.

/**
 * Da de alta un plan nuevo en el catálogo. `activo:true` por defecto — un
 * plan recién creado entra de inmediato al catálogo público salvo que se
 * desactive explícitamente después.
 */
export async function crearPlan(opts: {
  adminSecret: string;
  nombre: string;
  descripcion?: string | null;
  /**
   * CLP por pedido efectivo. Es el eje del cobro desde 2026-08-28 y por eso es
   * OBLIGATORIO: la modalidad de cuota plana quedó retirada, y un plan sin
   * tarifa no cobraría nada sin que nada fallara.
   */
  precioPorPedidoClp: number;
  /** Piso mensual. `null` o 0 = sin piso. No aplica el primer mes del courier. */
  minimoMensualClp?: number | null;
  caracteristicas?: Record<string, unknown>;
  /** UUID real del super-admin actor (vía `exigirActorAdmin()`). `null` = sin
   *  actor declarado (compat con callers previos al gap 3, F2-mínimo). */
  actorUsuarioId?: string | null;
}): Promise<{ ok: boolean; planId: string }> {
  verificarAdminSecret(opts.adminSecret);

  const nombre = opts.nombre.trim();
  if (!nombre) throw new Error('El nombre del plan no puede estar vacío.');

  validarPrecioClp(opts.precioPorPedidoClp, 'precioPorPedidoClp');
  if (opts.minimoMensualClp !== undefined && opts.minimoMensualClp !== null) {
    validarEnteroNoNegativo(opts.minimoMensualClp, 'minimoMensualClp');
  }
  const caracteristicas = sanearJsonbPlano(opts.caracteristicas ?? {}, 'caracteristicas');

  const supabase = crearClienteServiceRole();

  // Bitácora ANTES del INSERT (RNF-04). El plan aún no tiene id definitivo —
  // no es una acción de un tenant específico (`tenantId: null`, igual que el
  // resto de acciones de catálogo/plataforma sin tenant asociado).
  await registrarEnBitacora(supabase, {
    tenantId: null,
    actorUsuarioId: opts.actorUsuarioId ?? null,
    actorTipo: 'super_admin',
    accion: 'plataforma.plan_creado',
    entidadTipo: 'plan',
    entidadId: null,
    detalle: {
      nombre,
      precio_por_pedido_clp: opts.precioPorPedidoClp,
      minimo_mensual_clp: opts.minimoMensualClp ?? null,
    },
  });

  const { data, error } = await supabase
    .schema('plataforma')
    .from('planes')
    .insert({
      nombre,
      descripcion: opts.descripcion ?? null,
      precio_por_pedido_clp: opts.precioPorPedidoClp,
      minimo_mensual_clp: opts.minimoMensualClp ?? null,
      // ⚠️ Vestigiales, y en CERO a propósito. Las dos columnas son NOT NULL de
      // la migración original y no se pueden omitir; ponerles el precio de una
      // cuota que ya no se cobra dejaría una cifra que alguien puede leer como
      // vigente. Cero dice lo que es: acá no se cobra por mes.
      precio_mensual_clp: 0,
      precio_anual_clp: 0,
      // Los topes se retiraron: con comisión, más pedidos es más ingreso.
      limite_pedidos_mes: null,
      caracteristicas,
      activo: true,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Error al crear el plan: ${error.message}`);
  if (!data) throw new Error('El INSERT del plan no devolvió datos.');

  return { ok: true, planId: data.id as string };
}

/**
 * Edita campos del plan (parcial — solo se tocan los campos presentes en
 * `opts`). NO permite tocar `activo` (usar `activarDesactivarPlan`, que deja
 * su propio rastro de auditoría distinguible del resto de ediciones).
 */
export async function actualizarPlan(opts: {
  adminSecret: string;
  planId: string;
  nombre?: string;
  descripcion?: string | null;
  /** CLP por pedido efectivo. */
  precioPorPedidoClp?: number;
  /** Piso mensual. `null` = sin piso. */
  minimoMensualClp?: number | null;
  caracteristicas?: Record<string, unknown>;
  /** UUID real del super-admin actor (vía `exigirActorAdmin()`). `null` = sin
   *  actor declarado (compat con callers previos al gap 3, F2-mínimo). */
  actorUsuarioId?: string | null;
}): Promise<{ ok: boolean }> {
  verificarAdminSecret(opts.adminSecret);

  const supabase = crearClienteServiceRole();

  const { data: plan, error: errLectura } = await supabase
    .schema('plataforma')
    .from('planes')
    .select('id')
    .eq('id', opts.planId)
    .maybeSingle();
  if (errLectura) throw new Error(`Error al leer el plan: ${errLectura.message}`);
  if (!plan) throw new Error(`Plan ${opts.planId} no encontrado.`);

  const cambios: Record<string, unknown> = {};

  if (opts.nombre !== undefined) {
    const nombre = opts.nombre.trim();
    if (!nombre) throw new Error('El nombre del plan no puede estar vacío.');
    cambios.nombre = nombre;
  }
  if (opts.descripcion !== undefined) cambios.descripcion = opts.descripcion;
  if (opts.precioPorPedidoClp !== undefined) {
    validarPrecioClp(opts.precioPorPedidoClp, 'precioPorPedidoClp');
    cambios.precio_por_pedido_clp = opts.precioPorPedidoClp;
  }
  if (opts.minimoMensualClp !== undefined) {
    if (opts.minimoMensualClp !== null) {
      validarEnteroNoNegativo(opts.minimoMensualClp, 'minimoMensualClp');
    }
    cambios.minimo_mensual_clp = opts.minimoMensualClp;
  }
  if (opts.caracteristicas !== undefined) {
    cambios.caracteristicas = sanearJsonbPlano(opts.caracteristicas, 'caracteristicas');
  }

  if (Object.keys(cambios).length === 0) {
    // Nada que editar — no-op, sin bitácora (no hubo efecto real).
    return { ok: true };
  }

  // Bitácora ANTES del UPDATE (RNF-04).
  await registrarEnBitacora(supabase, {
    tenantId: null,
    actorUsuarioId: opts.actorUsuarioId ?? null,
    actorTipo: 'super_admin',
    accion: 'plataforma.plan_actualizado',
    entidadTipo: 'plan',
    entidadId: opts.planId,
    detalle: { campos_editados: Object.keys(cambios) },
  });

  const { error } = await supabase.schema('plataforma').from('planes').update(cambios).eq('id', opts.planId);
  if (error) throw new Error(`Error al actualizar el plan: ${error.message}`);

  return { ok: true };
}

/**
 * Activa o desactiva un plan del catálogo PÚBLICO — NO lo borra (no hay
 * `delete` en este módulo para `planes`). DESACTIVAR (`activo:false`) solo lo
 * saca de `obtenerCatalogoPlanesPublico` (que filtra `activo=true`): las
 * suscripciones EXISTENTES que ya referencian este plan siguen operando sin
 * cambios — su `plan_id` sigue siendo válido, `obtenerSuscripcionPorTenant`
 * lo resuelve igual (no filtra por `activo`). Esta garantía es la razón por
 * la que NO existe un `eliminarPlan`: borrar violaría la FK de
 * `suscripciones.plan_id` y rompería la trazabilidad histórica de cobros ya
 * generados con ese plan.
 */
export async function activarDesactivarPlan(opts: {
  adminSecret: string;
  planId: string;
  activo: boolean;
  /** UUID real del super-admin actor (vía `exigirActorAdmin()`). `null` = sin
   *  actor declarado (compat con callers previos al gap 3, F2-mínimo). */
  actorUsuarioId?: string | null;
}): Promise<{ ok: boolean }> {
  verificarAdminSecret(opts.adminSecret);

  const supabase = crearClienteServiceRole();

  const { data: plan, error: errLectura } = await supabase
    .schema('plataforma')
    .from('planes')
    .select('id, activo')
    .eq('id', opts.planId)
    .maybeSingle();
  if (errLectura) throw new Error(`Error al leer el plan: ${errLectura.message}`);
  if (!plan) throw new Error(`Plan ${opts.planId} no encontrado.`);

  // Bitácora ANTES del UPDATE (RNF-04).
  await registrarEnBitacora(supabase, {
    tenantId: null,
    actorUsuarioId: opts.actorUsuarioId ?? null,
    actorTipo: 'super_admin',
    accion: opts.activo ? 'plataforma.plan_reactivado' : 'plataforma.plan_desactivado',
    entidadTipo: 'plan',
    entidadId: opts.planId,
    detalle: { activo_anterior: plan.activo, activo_nuevo: opts.activo },
  });

  const { error } = await supabase
    .schema('plataforma')
    .from('planes')
    .update({ activo: opts.activo })
    .eq('id', opts.planId);
  if (error) throw new Error(`Error al actualizar el estado del plan: ${error.message}`);

  return { ok: true };
}

// =============================================================================
// establecerCaracteristicasOverride — override de entitlements por courier
// =============================================================================
// "Ola 1", gap 6. Permite forzar/habilitar features puntuales para UN courier
// sin cambiar su plan (p. ej. subirle el tope de conductores a un cliente
// puntual). El merge con `plan.caracteristicas` (override GANA) lo hace
// `obtenerEntitlementsTenant` (superficie-courier.ts) — esta función solo
// PERSISTE el override.

/**
 * Actualiza `caracteristicas_override` de la suscripción del tenant.
 *
 * Semántica de "merge/set" (documentada aquí porque no es obvia del nombre):
 * el `override` recibido se MEZCLA superficialmente sobre el override YA
 * guardado — no lo reemplaza entero. Esto evita que un admin que solo quiere
 * tocar una llave (p. ej. subir `conductores_max`) tenga que releer y reenviar
 * TODO el override existente (y arriesgarse a pisar por accidente algo que
 * otro admin fijó antes). Para BORRAR una llave del override (volver a que
 * ese entitlement lo resuelva el plan) se envía esa llave con valor `null`
 * explícito — un `null` en el `override` de entrada elimina la llave en vez
 * de guardarla como `null` literal.
 */
export async function establecerCaracteristicasOverride(opts: {
  adminSecret: string;
  tenantId: string;
  override: Record<string, unknown>;
  /** UUID real del super-admin actor (vía `exigirActorAdmin()`). `null` = sin
   *  actor declarado (compat con callers previos al gap 3, F2-mínimo). */
  actorUsuarioId?: string | null;
}): Promise<{ ok: boolean }> {
  verificarAdminSecret(opts.adminSecret);

  const overrideEntrante = sanearJsonbPlano(opts.override, 'override');

  const supabase = crearClienteServiceRole();

  const { data: susc, error: errLectura } = await supabase
    .schema('plataforma')
    .from('suscripciones')
    .select('id, caracteristicas_override')
    .eq('tenant_id', opts.tenantId)
    .maybeSingle();
  if (errLectura) throw new Error(`Error al leer la suscripción: ${errLectura.message}`);
  if (!susc) throw new Error(`El tenant ${opts.tenantId} no tiene una suscripción.`);

  const overrideAnterior = (susc.caracteristicas_override ?? {}) as Record<string, unknown>;
  const overrideNuevo: Record<string, unknown> = { ...overrideAnterior };
  for (const [clave, valor] of Object.entries(overrideEntrante)) {
    if (valor === null) {
      delete overrideNuevo[clave];
    } else {
      overrideNuevo[clave] = valor;
    }
  }

  // Bitácora ANTES del UPDATE (RNF-04) — deja constancia del antes/después
  // completo (no solo del delta) para poder auditar qué feature se forzó.
  await registrarEnBitacora(supabase, {
    tenantId: opts.tenantId,
    actorUsuarioId: opts.actorUsuarioId ?? null,
    actorTipo: 'super_admin',
    accion: 'plataforma.override_caracteristicas_actualizado',
    entidadTipo: 'suscripcion',
    entidadId: susc.id as string,
    detalle: { override_anterior: overrideAnterior, override_nuevo: overrideNuevo },
  });

  const { error } = await supabase
    .schema('plataforma')
    .from('suscripciones')
    .update({ caracteristicas_override: overrideNuevo, actualizado_en: new Date().toISOString() })
    .eq('id', susc.id as string);
  if (error) throw new Error(`Error al actualizar el override de características: ${error.message}`);

  return { ok: true };
}

// =============================================================================
// establecerEmisionDteReal — opt-in/opt-out de DTE real por courier (auditado)
// =============================================================================
// "Ola 1", ítem 8.

/**
 * Habilita o deshabilita `identidad.courier_config_dte.emision_dte_real_habilitada`
 * para UN courier — vía `service_role` (el schema `identidad` no es deny-all
 * como `plataforma`, pero esta escritura específica es exclusiva del
 * super-admin, no del courier).
 *
 * CLAVE — invariante NO-NEGOCIABLE de CLAUDE.md, no debilitarlo nunca: esta
 * función SOLO habilita la CAPACIDAD del courier de emitir DTE real. NO emite
 * ningún DTE por sí misma (la emisión sigue exigiendo la acción humana
 * `emitirFacturaPeriodo` con capacidad `emitir_facturas`, `dinero/acciones.ts`)
 * NI cambia el modo sandbox/real de la PLATAFORMA (`DTE_SANDBOX_MODE`,
 * `modules/dinero/modo-dte.ts`). El modo EFECTIVO de un courier
 * (`resolverModoDteTenant`) es `'real'` SOLO si AMBAS condiciones se cumplen:
 * la plataforma entera está en modo real Y este flag está en `true` — este
 * toggle es UNA de las dos, nunca las reemplaza. Activar `DTE_SANDBOX_MODE=false`
 * en el entorno exige, por su cuenta, revisión de `seguridad-cumplimiento`
 * ANTES — este opt-in por courier es una capa ADICIONAL, no un atajo.
 */
export async function establecerEmisionDteReal(opts: {
  adminSecret: string;
  tenantId: string;
  habilitada: boolean;
  /** UUID real del super-admin actor (vía `exigirActorAdmin()`). `null` = sin
   *  actor declarado (compat con callers previos al gap 3, F2-mínimo). */
  actorUsuarioId?: string | null;
}): Promise<{ ok: boolean }> {
  verificarAdminSecret(opts.adminSecret);

  const supabase = crearClienteServiceRole();

  const { data: config, error: errLectura } = await supabase
    .schema('identidad')
    .from('courier_config_dte')
    .select('tenant_id, emision_dte_real_habilitada')
    .eq('tenant_id', opts.tenantId)
    .maybeSingle();
  if (errLectura) throw new Error(`Error al leer la configuración DTE: ${errLectura.message}`);
  if (!config) {
    throw new Error(
      `El tenant ${opts.tenantId} aún no tiene configuración DTE (no eligió proveedor) — no se puede habilitar la emisión real.`,
    );
  }

  // Bitácora ANTES del UPDATE (RNF-04) — actor super_admin real.
  await registrarEnBitacora(supabase, {
    tenantId: opts.tenantId,
    actorUsuarioId: opts.actorUsuarioId ?? null,
    actorTipo: 'super_admin',
    accion: opts.habilitada ? 'plataforma.dte_real_opt_in' : 'plataforma.dte_real_opt_out',
    entidadTipo: 'courier_config_dte',
    entidadId: opts.tenantId,
    detalle: {
      habilitada_anterior: Boolean(config.emision_dte_real_habilitada),
      habilitada_nueva: opts.habilitada,
    },
  });

  const { error } = await supabase
    .schema('identidad')
    .from('courier_config_dte')
    .update({ emision_dte_real_habilitada: opts.habilitada })
    .eq('tenant_id', opts.tenantId);
  if (error) throw new Error(`Error al actualizar el opt-in de emisión DTE real: ${error.message}`);

  return { ok: true };
}
