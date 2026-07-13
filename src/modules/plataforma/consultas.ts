/**
 * Consultas de lectura del módulo `plataforma`.
 *
 * Todas usan `crearClienteServiceRole()` porque el schema `plataforma` tiene
 * RLS deny-all para `authenticated` — solo `service_role` puede leer.
 *
 * Para los joins cross-schema (plataforma + identidad), PostgREST no soporta
 * joins entre schemas distintos en un solo query. Se usan dos queries separadas
 * y se combinan en TypeScript.
 *
 * Ninguna función aquí escribe en BD ni tiene side effects.
 */

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import type { Plan, Suscripcion, SuscripcionConPlan, PeriodoSuscripcion } from './tipos';

// =============================================================================
// Mappers fila BD → interfaz
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function filaToPlan(f: Record<string, any>): Plan {
  return {
    id: f.id,
    nombre: f.nombre,
    descripcion: f.descripcion ?? null,
    precioMensualClp: Number(f.precio_mensual_clp),
    precioAnualClp: Number(f.precio_anual_clp),
    limitePedidosMes: f.limite_pedidos_mes !== null && f.limite_pedidos_mes !== undefined
      ? Number(f.limite_pedidos_mes)
      : null,
    caracteristicas: (f.caracteristicas ?? {}) as Record<string, unknown>,
    activo: Boolean(f.activo),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function filaToSuscripcion(f: Record<string, any>): Suscripcion {
  return {
    id: f.id,
    tenantId: f.tenant_id,
    planId: f.plan_id,
    estado: f.estado,
    trialHasta: f.trial_hasta ?? null,
    activaDesde: f.activa_desde ?? null,
    canceladaEn: f.cancelada_en ?? null,
    notas: f.notas ?? null,
    // Columnas de la migración 20260710000001 (periodicidad/auto-cobro/mandato).
    // Defaults defensivos por si la fila viene de un mock de prueba incompleto.
    periodicidad: (f.periodicidad ?? 'mensual') as Suscripcion['periodicidad'],
    autoCobroHabilitado: Boolean(f.auto_cobro_habilitado ?? false),
    mandatoEstado: (f.mandato_estado ?? 'sin_mandato') as Suscripcion['mandatoEstado'],
    mandatoRef: f.mandato_ref ?? null,
    planAnteriorId: f.plan_anterior_id ?? null,
    cambioEfectivoDesde: f.cambio_efectivo_desde ?? null,
    // Columna de la migración 20260712000001 (overrides de entitlements por
    // courier, gap 6). Default defensivo `{}` por si la fila viene de un mock
    // de prueba incompleto o de antes de la migración.
    caracteristicasOverride: (f.caracteristicas_override ?? {}) as Record<string, unknown>,
    creadaEn: f.creada_en,
    actualizadoEn: f.actualizado_en,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function filaToPeriodoSuscripcion(f: Record<string, any>): PeriodoSuscripcion {
  return {
    id: f.id,
    suscripcionId: f.suscripcion_id,
    tenantId: f.tenant_id,
    periodoInicio: f.periodo_inicio,
    periodoFin: f.periodo_fin,
    montoClp: Number(f.monto_clp),
    estado: f.estado,
    venceEn: f.vence_en ?? null,
    generadoEn: f.generado_en,
    // Columna de la migración 20260712000004 (Ola 2 F2, item I). Default
    // defensivo 'periodo' por si la fila viene de un mock de prueba incompleto.
    concepto: (f.concepto ?? 'periodo') as PeriodoSuscripcion['concepto'],
  };
}

// =============================================================================
// Planes
// =============================================================================

/**
 * Lista todos los planes activos ordenados por precio mensual ascendente.
 */
export async function obtenerPlanesActivos(): Promise<Plan[]> {
  const supabase = crearClienteServiceRole();

  const { data, error } = await supabase
    .schema('plataforma')
    .from('planes')
    .select('*')
    .eq('activo', true)
    .order('precio_mensual_clp', { ascending: true });

  if (error) throw new Error(`Error al obtener planes activos: ${error.message}`);
  return (data ?? []).map(filaToPlan);
}

/**
 * Lista TODOS los planes del catálogo (activos e inactivos), para el CRUD del
 * super-admin (`/admin/planes`, F2 "Ola 1", ítem D) — distinta de
 * `obtenerPlanesActivos`, que es la proyección pública que consume el courier
 * (`obtenerCatalogoPlanesPublico`) y solo debe ver `activo=true`.
 */
export async function obtenerTodosLosPlanes(): Promise<Plan[]> {
  const supabase = crearClienteServiceRole();

  const { data, error } = await supabase
    .schema('plataforma')
    .from('planes')
    .select('*')
    .order('precio_mensual_clp', { ascending: true });

  if (error) throw new Error(`Error al obtener el catálogo de planes: ${error.message}`);
  return (data ?? []).map(filaToPlan);
}

// =============================================================================
// Suscripciones
// =============================================================================

/**
 * Lista todas las suscripciones con su plan y el nombre del tenant.
 *
 * Hace dos queries separadas (plataforma + identidad) y combina en TypeScript
 * porque PostgREST no soporta joins cross-schema en un solo query.
 */
export async function obtenerTodasSuscripciones(): Promise<SuscripcionConPlan[]> {
  const supabase = crearClienteServiceRole();

  // Query 1: suscripciones
  const { data: suscData, error: suscError } = await supabase
    .schema('plataforma')
    .from('suscripciones')
    .select('*')
    .order('estado', { ascending: true })
    .order('creada_en', { ascending: false });

  if (suscError) throw new Error(`Error al listar suscripciones: ${suscError.message}`);
  const suscripciones = suscData ?? [];
  if (suscripciones.length === 0) return [];

  // Query 2: planes (catálogo completo — suele ser pequeño)
  const { data: planesData, error: planesError } = await supabase
    .schema('plataforma')
    .from('planes')
    .select('*');

  if (planesError) throw new Error(`Error al leer planes: ${planesError.message}`);
  const planesMap = new Map((planesData ?? []).map((p) => [p.id as string, filaToPlan(p)]));

  // Query 3: tenants (solo los que están en las suscripciones)
  const tenantIds = [...new Set(suscripciones.map((s) => s.tenant_id as string))];
  const { data: tenantsData, error: tenantsError } = await supabase
    .schema('identidad')
    .from('tenants')
    .select('id, nombre_fantasia')
    .in('id', tenantIds);

  if (tenantsError) throw new Error(`Error al leer tenants: ${tenantsError.message}`);
  const tenantsMap = new Map(
    (tenantsData ?? []).map((t) => [t.id as string, (t.nombre_fantasia ?? null) as string | null]),
  );

  // Combinar
  return suscripciones.map((s) => {
    const suscripcion = filaToSuscripcion(s);
    const plan = planesMap.get(s.plan_id as string);
    if (!plan) {
      throw new Error(`Plan ${s.plan_id} no encontrado para suscripción ${s.id}`);
    }
    return {
      ...suscripcion,
      plan,
      nombreFantasiaTenant: tenantsMap.get(s.tenant_id as string) ?? null,
    };
  });
}

/**
 * Obtiene la suscripción de un tenant específico con su plan y nombre de tenant.
 * Devuelve null si el tenant no tiene suscripción.
 */
export async function obtenerSuscripcionPorTenant(tenantId: string): Promise<SuscripcionConPlan | null> {
  const supabase = crearClienteServiceRole();

  const { data: suscData, error: suscError } = await supabase
    .schema('plataforma')
    .from('suscripciones')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (suscError) throw new Error(`Error al obtener suscripción del tenant: ${suscError.message}`);
  if (!suscData) return null;

  // Leer plan
  const { data: planData, error: planError } = await supabase
    .schema('plataforma')
    .from('planes')
    .select('*')
    .eq('id', suscData.plan_id as string)
    .single();

  if (planError) throw new Error(`Error al leer plan de la suscripción: ${planError.message}`);

  // Leer nombre del tenant
  const { data: tenantData, error: tenantError } = await supabase
    .schema('identidad')
    .from('tenants')
    .select('nombre_fantasia')
    .eq('id', tenantId)
    .maybeSingle();

  if (tenantError) throw new Error(`Error al leer tenant: ${tenantError.message}`);

  return {
    ...filaToSuscripcion(suscData),
    plan: filaToPlan(planData),
    nombreFantasiaTenant: tenantData?.nombre_fantasia ?? null,
  };
}

// =============================================================================
// Períodos
// =============================================================================

/**
 * Lista los períodos de suscripción de una suscripción, ordenados por fecha
 * de inicio descendente. Por defecto devuelve los últimos 12.
 */
export async function obtenerPeriodosDeSuscripcion(
  suscripcionId: string,
  limite = 12,
): Promise<PeriodoSuscripcion[]> {
  const supabase = crearClienteServiceRole();

  const { data, error } = await supabase
    .schema('plataforma')
    .from('periodos_suscripcion')
    .select('*')
    .eq('suscripcion_id', suscripcionId)
    .order('periodo_inicio', { ascending: false })
    .limit(limite);

  if (error) throw new Error(`Error al obtener períodos de suscripción: ${error.message}`);
  return (data ?? []).map(filaToPeriodoSuscripcion);
}

/** Período de suscripción con los datos de su último pago (para el tablero de cobros). */
export interface PeriodoConPago extends PeriodoSuscripcion {
  /** URL del link de cobro Fintoc del último pago pendiente (si se generó). */
  linkPagoUrl: string | null;
  /** Estado del último pago: 'pendiente' | 'confirmado' | 'fallido' (o null si no hay pago). */
  pagoEstado: string | null;
  /** Método del último pago: 'fintoc_link' | 'transferencia_manual' | 'cortesia'. */
  metodoPago: string | null;
  /** Momento de confirmación del pago (si confirmado). */
  pagadoEn: string | null;
}

/**
 * Lista los períodos de una suscripción junto con su último pago (link, estado,
 * método). Combina dos queries (períodos + pagos) en TypeScript — PostgREST no
 * hace joins intra-schema desnormalizados de forma trivial aquí.
 */
export async function obtenerPeriodosConPago(
  suscripcionId: string,
  limite = 12,
): Promise<PeriodoConPago[]> {
  const supabase = crearClienteServiceRole();

  const { data: periodosData, error: errPeriodos } = await supabase
    .schema('plataforma')
    .from('periodos_suscripcion')
    .select('*')
    .eq('suscripcion_id', suscripcionId)
    .order('periodo_inicio', { ascending: false })
    .limit(limite);

  if (errPeriodos) throw new Error(`Error al obtener períodos: ${errPeriodos.message}`);
  const periodos = (periodosData ?? []).map(filaToPeriodoSuscripcion);
  if (periodos.length === 0) return [];

  // Último pago por período (el más reciente por registrado_en).
  const periodoIds = periodos.map((p) => p.id);
  const { data: pagosData, error: errPagos } = await supabase
    .schema('plataforma')
    .from('pagos_plataforma')
    .select('periodo_id, estado, metodo, link_pago_url, pagado_en, registrado_en')
    .in('periodo_id', periodoIds)
    .order('registrado_en', { ascending: false });

  if (errPagos) throw new Error(`Error al leer pagos: ${errPagos.message}`);

  // Primer pago por período = el más reciente (ya vienen ordenados desc).
  const ultimoPagoPorPeriodo = new Map<string, Record<string, unknown>>();
  for (const pago of pagosData ?? []) {
    const pid = pago.periodo_id as string;
    if (!ultimoPagoPorPeriodo.has(pid)) ultimoPagoPorPeriodo.set(pid, pago);
  }

  return periodos.map((periodo) => {
    const pago = ultimoPagoPorPeriodo.get(periodo.id);
    return {
      ...periodo,
      linkPagoUrl: (pago?.link_pago_url as string | null) ?? null,
      pagoEstado: (pago?.estado as string | null) ?? null,
      metodoPago: (pago?.metodo as string | null) ?? null,
      pagadoEn: (pago?.pagado_en as string | null) ?? null,
    };
  });
}

/**
 * Obtiene la suscripción por su id (para la cabecera de la página de detalle).
 */
export async function obtenerSuscripcionPorId(suscripcionId: string): Promise<SuscripcionConPlan | null> {
  const supabase = crearClienteServiceRole();
  const { data, error } = await supabase
    .schema('plataforma')
    .from('suscripciones')
    .select('tenant_id')
    .eq('id', suscripcionId)
    .maybeSingle();
  if (error) throw new Error(`Error al leer suscripción: ${error.message}`);
  if (!data) return null;
  return obtenerSuscripcionPorTenant(data.tenant_id as string);
}

// =============================================================================
// Tenants sin suscripción
// =============================================================================

/**
 * Lista los tenants que aún no tienen suscripción asignada.
 * Útil para el super-admin al asignar planes a couriers nuevos.
 */
export async function obtenerTodosLosTenantsSinSuscripcion(): Promise<
  { id: string; nombreFantasia: string | null }[]
> {
  const supabase = crearClienteServiceRole();

  // Tenant IDs que YA tienen suscripción
  const { data: suscData, error: suscError } = await supabase
    .schema('plataforma')
    .from('suscripciones')
    .select('tenant_id');

  if (suscError) throw new Error(`Error al leer suscripciones existentes: ${suscError.message}`);
  const tenantIdsConSusc = (suscData ?? []).map((s) => s.tenant_id as string);

  // Todos los tenants.
  // Excluir los que ya tienen suscripción (filtro en app si la lista es pequeña)
  // PostgREST no soporta NOT IN con subquery, así que filtramos en TypeScript.
  const { data: tenantsData, error: tenantsError } = await supabase
    .schema('identidad')
    .from('tenants')
    .select('id, nombre_fantasia')
    .order('nombre_fantasia', { ascending: true });

  if (tenantsError) throw new Error(`Error al leer tenants: ${tenantsError.message}`);

  const sinSusc = (tenantsData ?? []).filter(
    (t) => !tenantIdsConSusc.includes(t.id as string),
  );

  return sinSusc.map((t) => ({
    id: t.id as string,
    nombreFantasia: (t.nombre_fantasia ?? null) as string | null,
  }));
}

// =============================================================================
// Configuración DTE del courier (lectura para el panel admin de overrides)
// =============================================================================

/**
 * Estado actual del opt-in de emisión DTE real del tenant — lector para la
 * sección "Entitlements / overrides" de `/admin/suscripciones/[id]` (F2 "Ola
 * 1", ítem 8). Distinto de `resolverModoDteTenant` (`modules/dinero/modo-dte.ts`):
 * ese resuelve el modo EFECTIVO (mezclando el switch global
 * `DTE_SANDBOX_MODE`), mientras que esto expone el valor CRUDO del flag por
 * courier tal como lo dejó `establecerEmisionDteReal` — lo que el admin
 * necesita ver/editar independientemente del modo global de la plataforma.
 *
 * `tieneConfig:false` = el courier aún no completó el onboarding DTE (no
 * existe fila en `identidad.courier_config_dte`) — `establecerEmisionDteReal`
 * rechaza el opt-in en ese caso; la UI debe reflejar esa imposibilidad.
 */
export async function obtenerConfigDteTenant(
  tenantId: string,
): Promise<{ tieneConfig: boolean; emisionDteRealHabilitada: boolean }> {
  const supabase = crearClienteServiceRole();

  const { data, error } = await supabase
    .schema('identidad')
    .from('courier_config_dte')
    .select('emision_dte_real_habilitada')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error) throw new Error(`Error al leer la configuración DTE del courier: ${error.message}`);
  if (!data) return { tieneConfig: false, emisionDteRealHabilitada: false };

  return { tieneConfig: true, emisionDteRealHabilitada: Boolean(data.emision_dte_real_habilitada) };
}
