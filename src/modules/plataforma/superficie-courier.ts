/**
 * Superficie del COURIER sobre `plataforma` (backstage de suscripción de Rutax).
 * =============================================================================
 * `plataforma` es deny-all para `authenticated` (RLS, ver migración 0015): un
 * courier autenticado NUNCA puede leer/escribir este schema directo, ni con el
 * cliente RLS normal ni con un `service_role` filtrado a mano por el frontend.
 * Este archivo es la ÚNICA puerta que una Server Action del courier puede
 * invocar — usa `crearClienteServiceRole()` internamente y expone solo
 * proyecciones "courier-safe".
 *
 * Contrato de seguridad (H-1/H-2, no negociable):
 *  - `tenantId` SIEMPRE lo valida el llamador contra el claim del JWT
 *    (`sesion.usuario.tenantId`) — estas funciones NUNCA aceptan un tenant sin
 *    validar del cliente. El courier no puede nombrar otro tenant.
 *  - Ninguna proyección expone `suscripciones.notas` (notas internas del
 *    super-admin), `pagos_plataforma.link_pago_url` ni `pago_externo_id`
 *    (identificadores/URLs del proveedor de pago — superficie de ataque y
 *    ruido irrelevante para el courier). `mandato_ref` tampoco se expone: es
 *    un puntero opaco sin utilidad para el cliente.
 *
 * Distinto de `dinero`: este es el backstage financiero de Rutax (Rutax cobra
 * al courier), no el motor entrega→dinero (courier cobra al seller).
 */

import { cache } from 'react';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { inngest } from '@/lib/inngest/cliente';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import { esAreaProducto, type AreaProducto } from '@/modules/identidad/areas-producto';
import { ahoraEnSantiago, sumarDiasCalendario, diferenciaEnDiasCalendario } from '@/lib/fecha-santiago';
import { descifrarSecreto, comoReferenciaSecreto } from '@/modules/integraciones/secretos';
import { obtenerPuertoSuscripcionRecurrente } from '@/modules/integraciones/pagos/suscripcion-recurrente';
import { obtenerPlanesActivos, obtenerSuscripcionPorTenant, obtenerPeriodosConPago } from './consultas';
import type {
  Plan,
  EstadoSuscripcion,
  EstadoPeriodo,
  EstadoPago,
  MetodoPago,
  EstadoMandato,
  Periodicidad,
} from './tipos';

// =============================================================================
// Proyecciones courier-safe
// =============================================================================

/** DTO público de un plan — sin campos de administración interna. */
export interface PlanPublico {
  id: string;
  nombre: string;
  descripcion: string | null;
  precioMensualClp: number;
  precioAnualClp: number;
  limitePedidosMes: number | null;
  caracteristicas: Record<string, unknown>;
}

/** El período vigente de la propia suscripción (estado/monto/vence). */
export interface PeriodoActualCourier {
  id: string;
  periodoInicio: string;
  periodoFin: string;
  montoClp: number;
  estado: EstadoPeriodo;
  venceEn: string | null;
}

/** Una entrada del historial de pagos — curada, SIN link ni ids externos. */
export interface PagoHistorialCourier {
  periodoId: string;
  /** Fecha de confirmación del pago, o `null` si el período aún no tiene un pago confirmado. */
  fecha: string | null;
  montoClp: number;
  /** `null` = todavía no hay ningún intento de pago registrado para este período. */
  estado: EstadoPago | null;
  metodo: MetodoPago | null;
}

/**
 * Cambio de plan PENDIENTE (downgrade diferido aún no aplicado) — proyecta
 * `suscripcion.planAnteriorId`/`cambioEfectivoDesde` (ver el JSDoc de
 * `Suscripcion.planAnteriorId` en `tipos.ts` para el modelo de datos
 * completo). `planId` aquí es el plan DESTINO al que bajará el courier.
 */
export interface CambioPlanPendiente {
  planId: string;
  /** Fecha ('YYYY-MM-DD', Santiago) en que el cambio será efectivo. */
  efectivoDesde: string;
}

/** La propia suscripción del courier, curada para su pantalla "Mi plan". */
export interface VistaMiPlan {
  suscripcionId: string;
  estado: EstadoSuscripcion;
  plan: PlanPublico;
  periodicidad: Periodicidad;
  trialHasta: string | null;
  activaDesde: string | null;
  canceladaEn: string | null;
  autoCobroHabilitado: boolean;
  mandatoEstado: EstadoMandato;
  periodoActual: PeriodoActualCourier | null;
  historialPagos: PagoHistorialCourier[];
  /** `null` si no hay un downgrade programado esperando aplicarse. */
  cambioPendiente: CambioPlanPendiente | null;
}

/** Resolución de entitlements del tenant — lo que el plan habilita/limita. */
export interface Entitlements {
  limitePedidosMes: number | null;
  conductoresMax: number | null;
  apiPublica: boolean;
  webhooks: boolean;
  estadoSuscripcion: EstadoSuscripcion | null;
}

/** Proyecta un `Plan` (interno, con `activo`) a `PlanPublico` (sin él). */
function planPublicoDesde(plan: Plan): PlanPublico {
  return {
    id: plan.id,
    nombre: plan.nombre,
    descripcion: plan.descripcion,
    precioMensualClp: plan.precioMensualClp,
    precioAnualClp: plan.precioAnualClp,
    limitePedidosMes: plan.limitePedidosMes,
    caracteristicas: plan.caracteristicas,
  };
}

// =============================================================================
// obtenerCatalogoPlanesPublico
// =============================================================================

/** Catálogo público de planes activos (para la pantalla de alta/upgrade). */
export async function obtenerCatalogoPlanesPublico(): Promise<PlanPublico[]> {
  const planes = await obtenerPlanesActivos();
  return planes.map(planPublicoDesde);
}

// =============================================================================
// obtenerMiPlan
// =============================================================================

/**
 * La propia suscripción del tenant, curada para UI. `null` si el tenant aún no
 * tiene suscripción (courier recién onboardeado, antes de `crearSuscripcionInicial`).
 */
export async function obtenerMiPlan(tenantId: string): Promise<VistaMiPlan | null> {
  const suscripcion = await obtenerSuscripcionPorTenant(tenantId);
  if (!suscripcion) return null;

  // Últimos 12 períodos, más reciente primero (mismo orden que `consultas.ts`).
  const periodos = await obtenerPeriodosConPago(suscripcion.id, 12);
  const masReciente = periodos[0] ?? null;

  const periodoActual: PeriodoActualCourier | null = masReciente
    ? {
        id: masReciente.id,
        periodoInicio: masReciente.periodoInicio,
        periodoFin: masReciente.periodoFin,
        montoClp: masReciente.montoClp,
        estado: masReciente.estado,
        venceEn: masReciente.venceEn,
      }
    : null;

  const historialPagos: PagoHistorialCourier[] = periodos.map((p) => ({
    periodoId: p.id,
    fecha: p.pagadoEn,
    montoClp: p.montoClp,
    estado: (p.pagoEstado as EstadoPago | null) ?? null,
    metodo: (p.metodoPago as MetodoPago | null) ?? null,
  }));

  // Downgrade diferido pendiente (ver JSDoc de `CambioPlanPendiente`): solo
  // "pendiente" si AMBOS campos están presentes — `aplicarCambiosPlan` limpia
  // ambos a la vez al aplicar el swap, nunca deja uno sin el otro.
  const cambioPendiente: CambioPlanPendiente | null =
    suscripcion.planAnteriorId && suscripcion.cambioEfectivoDesde
      ? { planId: suscripcion.planAnteriorId, efectivoDesde: suscripcion.cambioEfectivoDesde }
      : null;

  return {
    suscripcionId: suscripcion.id,
    estado: suscripcion.estado,
    plan: planPublicoDesde(suscripcion.plan),
    periodicidad: suscripcion.periodicidad,
    trialHasta: suscripcion.trialHasta,
    activaDesde: suscripcion.activaDesde,
    canceladaEn: suscripcion.canceladaEn,
    autoCobroHabilitado: suscripcion.autoCobroHabilitado,
    mandatoEstado: suscripcion.mandatoEstado,
    periodoActual,
    historialPagos,
    cambioPendiente,
    // NUNCA: suscripcion.notas, mandatoRef, ni pago.linkPagoUrl/pagoExternoId.
  };
}

// =============================================================================
// crearSuscripcionInicial — alta self-serve idempotente y anti-abuso
// =============================================================================

/**
 * Días de trial al alta self-serve. Constante nombrada, ajustable — cambiarla
 * solo afecta altas NUEVAS (las suscripciones existentes ya tienen su
 * `trial_hasta` fijado en BD).
 */
export const TRIAL_DIAS = 14;

/**
 * Alta self-serve de la suscripción de un tenant. Idempotente: si el tenant ya
 * tiene suscripción, la devuelve sin crear una segunda (el UNIQUE(tenant_id) de
 * BD ya lo impide a nivel de constraint — esta función evita que ese conflicto
 * se propague como un 500 al courier).
 *
 * `tenantId` DEBE venir ya validado por el llamador (forzado desde el claim del
 * JWT) — esta función no vuelve a resolverlo.
 */
export async function crearSuscripcionInicial(opts: {
  tenantId: string;
  planId: string;
  actorUsuarioId: string;
}): Promise<{ ok: boolean; suscripcionId: string }> {
  const supabase = crearClienteServiceRole();

  // Idempotencia: ¿el tenant ya tiene suscripción?
  const { data: existente, error: errExistente } = await supabase
    .schema('plataforma')
    .from('suscripciones')
    .select('id')
    .eq('tenant_id', opts.tenantId)
    .maybeSingle();
  if (errExistente) {
    throw new Error(`Error al verificar suscripción existente: ${errExistente.message}`);
  }
  if (existente) {
    return { ok: true, suscripcionId: existente.id as string };
  }

  // Validar que el plan exista y esté activo (anti-abuso: no se puede dar de
  // alta contra un plan retirado o inexistente).
  const { data: plan, error: errPlan } = await supabase
    .schema('plataforma')
    .from('planes')
    .select('id, activo')
    .eq('id', opts.planId)
    .maybeSingle();
  if (errPlan) throw new Error(`Error al leer el plan: ${errPlan.message}`);
  if (!plan || !plan.activo) {
    throw new Error(`El plan solicitado no existe o no está disponible.`);
  }

  const trialHasta = sumarDiasCalendario(ahoraEnSantiago().fecha, TRIAL_DIAS);

  // Bitácora ANTES del INSERT (RNF-04: acción financiera con autor).
  await registrarEnBitacora(supabase, {
    tenantId: opts.tenantId,
    actorUsuarioId: opts.actorUsuarioId,
    actorTipo: 'usuario',
    accion: 'plataforma.suscripcion_autocreada',
    entidadTipo: 'suscripcion',
    entidadId: opts.tenantId,
    detalle: { plan_id: opts.planId, trial_hasta: trialHasta },
  });

  const { data: nueva, error: errInsert } = await supabase
    .schema('plataforma')
    .from('suscripciones')
    .insert({
      tenant_id: opts.tenantId,
      plan_id: opts.planId,
      estado: 'trial',
      trial_hasta: trialHasta,
    })
    .select('id')
    .maybeSingle();

  if (errInsert) {
    // Carrera: dos requests concurrentes del mismo tenant. El UNIQUE(tenant_id)
    // rechaza el segundo INSERT con 23505 — recuperamos el id existente en vez
    // de propagar un 500 (misma idempotencia que arriba, para la carrera).
    if ((errInsert as { code?: string }).code === '23505') {
      const { data: reintento, error: errReintento } = await supabase
        .schema('plataforma')
        .from('suscripciones')
        .select('id')
        .eq('tenant_id', opts.tenantId)
        .maybeSingle();
      if (errReintento) {
        throw new Error(`Error al recuperar la suscripción tras conflicto: ${errReintento.message}`);
      }
      if (reintento) return { ok: true, suscripcionId: reintento.id as string };
    }
    throw new Error(`Error al crear la suscripción inicial: ${errInsert.message}`);
  }
  if (!nueva) throw new Error('El INSERT de la suscripción inicial no devolvió datos.');

  const suscripcionId = nueva.id as string;

  // Publicar evento DESPUÉS del insert — la bitácora (el "efecto" que importa
  // para la auditoría financiera) ya quedó registrada antes.
  await inngest.send({
    name: 'plataforma/suscripcion.creada',
    id: `suscripcion-creada-${suscripcionId}`,
    data: {
      tenantId: opts.tenantId,
      suscripcionId,
      planId: opts.planId,
      estado: 'trial',
      trialHasta,
      origen: 'self_serve',
    },
  });

  return { ok: true, suscripcionId };
}

// =============================================================================
// obtenerEntitlementsTenant — resolución de entitlements para enforcement
// =============================================================================

/**
 * Entitlements del tenant según su plan actual. Fail-open BLANDO: si el tenant
 * no tiene suscripción (aún no completó el alta), devuelve límites nulos/
 * permisivos en vez de lanzar — el enforcement real se activa cuando exista una
 * suscripción, esto solo resuelve "qué sabe el courier sobre su plan".
 *
 * MERGE de overrides (migración 20260712000001, gap 6): las features
 * EFECTIVAS del tenant = `plan.caracteristicas` MEZCLADAS con
 * `suscripcion.caracteristicasOverride`, donde el OVERRIDE TIENE PRECEDENCIA
 * (gana la llave del override si existe). `limitePedidosMes` normalmente
 * viene de la columna dedicada del plan (no de `caracteristicas`); el
 * override puede pisarlo SOLO si trae explícitamente la llave
 * `limite_pedidos_mes` — su ausencia en el override deja el valor del plan
 * intacto (no se interpreta "ausente" como "null").
 *
 * Memoizada por request con `cache()` de React (mismo patrón que
 * `obtenerSesionActual`): páginas/layouts pueden consultarla varias veces por
 * navegación sin repetir la consulta a `plataforma`.
 */
export const obtenerEntitlementsTenant = cache(async function obtenerEntitlementsTenant(
  tenantId: string,
): Promise<Entitlements> {
  const suscripcion = await obtenerSuscripcionPorTenant(tenantId);
  if (!suscripcion) {
    return {
      limitePedidosMes: null,
      conductoresMax: null,
      apiPublica: false,
      webhooks: false,
      estadoSuscripcion: null,
    };
  }

  const caracteristicasPlan = suscripcion.plan.caracteristicas ?? {};
  const override = suscripcion.caracteristicasOverride ?? {};
  // El override GANA la llave si existe — spread del plan primero, override después.
  const caracteristicasEfectivas: Record<string, unknown> = { ...caracteristicasPlan, ...override };

  const conductoresMaxRaw = caracteristicasEfectivas['conductores_max'];
  const conductoresMax =
    typeof conductoresMaxRaw === 'number' && Number.isFinite(conductoresMaxRaw) ? conductoresMaxRaw : null;

  // `limite_pedidos_mes` vive en una columna del plan, no en `caracteristicas`
  // — el override solo lo pisa si trae la llave EXPLÍCITAMENTE (distingue
  // "ausente" de "presente con valor null" = override explícito a "sin límite").
  let limitePedidosMes = suscripcion.plan.limitePedidosMes;
  if (Object.prototype.hasOwnProperty.call(override, 'limite_pedidos_mes')) {
    const valorOverride = override['limite_pedidos_mes'];
    limitePedidosMes =
      typeof valorOverride === 'number' && Number.isFinite(valorOverride) ? valorOverride : null;
  }

  return {
    limitePedidosMes,
    conductoresMax,
    apiPublica: Boolean(caracteristicasEfectivas['api_publica']),
    webhooks: Boolean(caracteristicasEfectivas['webhooks']),
    estadoSuscripcion: suscripcion.estado,
  };
});

// =============================================================================
// iniciarEnrolamientoMandato / cancelarMandatoAutoCobro — auto-cobro (F1-E)
// =============================================================================

/**
 * Inicia el enrolamiento del mandato de auto-cobro (PAC/tarjeta vía Fintoc).
 * Deja `mandato_estado='pendiente'` y `auto_cobro_habilitado=true` — el
 * opt-in del courier ES este clic; el mandato queda técnicamente utilizable
 * recién cuando el webhook `mandato_activado` lo confirme
 * (`api/webhooks/fintoc-suscripcion-recurrente`), que lo transiciona a
 * `'activo'`. El job de auto-cobro exige AMBAS condiciones antes de cobrar.
 *
 * El `mandatoExternoId` que devuelve `registrarMandato` es solo un puntero de
 * correlación TEMPORAL (la sesión de checkout) — no es el id definitivo del
 * mandato y por eso NO se cifra ni se guarda en `mandato_ref` aquí; el id
 * definitivo llega en el webhook y ES ese el que se cifra (`cobro-recurrente`).
 */
export async function iniciarEnrolamientoMandato(opts: {
  tenantId: string;
  actorUsuarioId: string;
}): Promise<{ ok: boolean; urlEnrolamiento: string }> {
  const supabase = crearClienteServiceRole();

  const { data: susc, error } = await supabase
    .schema('plataforma')
    .from('suscripciones')
    .select('id, mandato_estado')
    .eq('tenant_id', opts.tenantId)
    .maybeSingle();
  if (error) throw new Error(`Error al leer la suscripción: ${error.message}`);
  if (!susc) throw new Error('El tenant no tiene una suscripción — no se puede activar el auto-cobro.');
  if (susc.mandato_estado === 'activo') {
    throw new Error('El auto-cobro ya está activo.');
  }

  const suscripcionId = susc.id as string;

  // Bitácora ANTES del efecto externo (llamada a Fintoc) — RNF-04, actor usuario.
  // Solo lleva lo que ya se conoce antes de la llamada (nunca el resultado del
  // proveedor, que llega después) — mismo patrón que `generarLinkCobroPeriodo`.
  await registrarEnBitacora(supabase, {
    tenantId: opts.tenantId,
    actorUsuarioId: opts.actorUsuarioId,
    actorTipo: 'usuario',
    accion: 'plataforma.auto_cobro_enrolamiento_iniciado',
    entidadTipo: 'suscripcion',
    entidadId: suscripcionId,
    detalle: {},
  });

  const puerto = obtenerPuertoSuscripcionRecurrente({ autoCobroHabilitado: true });
  const resultado = await puerto.registrarMandato({
    tenantId: opts.tenantId,
    metadata: { tenant_id: opts.tenantId, suscripcion_id: suscripcionId },
  });

  const { error: errUpdate } = await supabase
    .schema('plataforma')
    .from('suscripciones')
    .update({
      mandato_estado: 'pendiente',
      auto_cobro_habilitado: true,
      actualizado_en: new Date().toISOString(),
    })
    .eq('id', suscripcionId);
  if (errUpdate) throw new Error(`Error al actualizar la suscripción: ${errUpdate.message}`);

  return { ok: true, urlEnrolamiento: resultado.urlEnrolamiento };
}

/**
 * Cancela el auto-cobro: cancela el mandato en el proveedor (si hay uno
 * cifrado) y desactiva `auto_cobro_habilitado` en Rutax. "Sin borrado
 * silencioso": el secreto cifrado en `identidad.secretos_cifrados` NO se
 * borra (append-only, igual que la bitácora) — solo se anula el PUNTERO
 * (`mandato_ref=null`) para que la app deje de poder usarlo, y la bitácora
 * deja constancia de que existía un mandato antes de la cancelación.
 */
export async function cancelarMandatoAutoCobro(opts: {
  tenantId: string;
  actorUsuarioId: string;
}): Promise<{ ok: boolean }> {
  const supabase = crearClienteServiceRole();

  const { data: susc, error } = await supabase
    .schema('plataforma')
    .from('suscripciones')
    .select('id, mandato_ref, mandato_estado, auto_cobro_habilitado')
    .eq('tenant_id', opts.tenantId)
    .maybeSingle();
  if (error) throw new Error(`Error al leer la suscripción: ${error.message}`);
  if (!susc) throw new Error('El tenant no tiene una suscripción.');

  const suscripcionId = susc.id as string;
  const mandatoRef = susc.mandato_ref as string | null;

  // Bitácora ANTES del efecto (cancelación en el proveedor + update en BD) — RNF-04.
  await registrarEnBitacora(supabase, {
    tenantId: opts.tenantId,
    actorUsuarioId: opts.actorUsuarioId,
    actorTipo: 'usuario',
    accion: 'plataforma.auto_cobro_desactivado',
    entidadTipo: 'suscripcion',
    entidadId: suscripcionId,
    detalle: {
      mandato_estado_anterior: susc.mandato_estado,
      tenia_mandato_ref: Boolean(mandatoRef),
    },
  });

  if (mandatoRef) {
    try {
      const descifrado = await descifrarSecreto(comoReferenciaSecreto(mandatoRef));
      if (typeof descifrado.valor === 'string') {
        const puerto = obtenerPuertoSuscripcionRecurrente({
          autoCobroHabilitado: Boolean(susc.auto_cobro_habilitado),
        });
        await puerto.cancelarMandato({ mandatoToken: descifrado.valor });
      }
    } catch {
      // No relanzar: igual queremos dejar el auto-cobro desactivado en Rutax
      // aunque el proveedor falle al cancelar (evita dejar al courier
      // atascado). Riesgo residual documentado: si el proveedor no llegó a
      // cancelar, Rutax simplemente deja de intentar cobrar de todos modos
      // (`auto_cobro_habilitado=false` ⇒ el job de auto-cobro no cobra más).
    }
  }

  const { error: errUpdate } = await supabase
    .schema('plataforma')
    .from('suscripciones')
    .update({
      auto_cobro_habilitado: false,
      mandato_estado: 'cancelado',
      mandato_ref: null,
      actualizado_en: new Date().toISOString(),
    })
    .eq('id', suscripcionId);
  if (errUpdate) throw new Error(`Error al actualizar la suscripción: ${errUpdate.message}`);

  return { ok: true };
}

// =============================================================================
// obtenerComprobantePago — comprobante NO tributario de un pago confirmado
// =============================================================================

/** Datos curados para armar el comprobante de pago descargable (NO es un DTE). */
export interface ComprobantePago {
  periodoId: string;
  tenantNombre: string;
  planNombre: string;
  periodoInicio: string;
  periodoFin: string;
  montoClp: number;
  metodo: MetodoPago;
  /** Momento de confirmación del pago — nunca null (solo se resuelve para pagos `confirmado`). */
  pagadoEn: string;
}

/**
 * Resuelve el comprobante de un pago CONFIRMADO de un período de la
 * suscripción del tenant. Devuelve `null` si el período no existe, no
 * pertenece al `tenantId` dado, o no tiene ningún pago `confirmado` —
 * el llamador (la ruta `api/courier/plataforma/comprobantes/[periodoId]`)
 * responde 404 en ese caso, nunca filtra por otro tenant.
 *
 * `tenantId` DEBE venir ya validado por el llamador (claim del JWT), igual que
 * el resto de este archivo.
 */
export async function obtenerComprobantePago(opts: {
  tenantId: string;
  periodoId: string;
}): Promise<ComprobantePago | null> {
  const supabase = crearClienteServiceRole();

  // El período SIEMPRE se busca filtrado por tenant_id — nunca solo por id.
  const { data: periodo, error: errPeriodo } = await supabase
    .schema('plataforma')
    .from('periodos_suscripcion')
    .select('id, periodo_inicio, periodo_fin, monto_clp')
    .eq('id', opts.periodoId)
    .eq('tenant_id', opts.tenantId)
    .maybeSingle();
  if (errPeriodo) throw new Error(`Error al leer el período: ${errPeriodo.message}`);
  if (!periodo) return null;

  // El pago más reciente CONFIRMADO de ese período — comprobante solo existe
  // para pagos confirmados (nunca para pendiente/fallido).
  const { data: pago, error: errPago } = await supabase
    .schema('plataforma')
    .from('pagos_plataforma')
    .select('metodo, monto_clp, pagado_en')
    .eq('periodo_id', periodo.id as string)
    .eq('tenant_id', opts.tenantId)
    .eq('estado', 'confirmado')
    .order('pagado_en', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (errPago) throw new Error(`Error al leer el pago: ${errPago.message}`);
  if (!pago || !pago.pagado_en) return null;

  const suscripcion = await obtenerSuscripcionPorTenant(opts.tenantId);
  if (!suscripcion) return null;

  return {
    periodoId: periodo.id as string,
    tenantNombre: suscripcion.nombreFantasiaTenant ?? 'Tu courier',
    planNombre: suscripcion.plan.nombre,
    periodoInicio: periodo.periodo_inicio as string,
    periodoFin: periodo.periodo_fin as string,
    montoClp: Number(pago.monto_clp ?? periodo.monto_clp),
    metodo: pago.metodo as MetodoPago,
    pagadoEn: pago.pagado_en as string,
  };
}

// =============================================================================
// cambiarPlanCourier — cambio de plan self-serve con proración (F2, item I)
// =============================================================================
//
// MODELO DE DOWNGRADE DIFERIDO ELEGIDO (documentado aquí porque no es obvio
// de las columnas — ver también el JSDoc de `Suscripcion.planAnteriorId` en
// `tipos.ts`). Sin agregar una columna nueva, `plataforma.suscripciones` solo
// tiene `plan_anterior_id`/`cambio_efectivo_desde` para trazar el cambio:
//
//   - `plan_id` NUNCA se toca en un downgrade — sigue siendo, en TODO
//     momento, el plan REALMENTE efectivo/facturado hoy. Es deliberado: así
//     TODOS los demás lectores de `plan_id` (`obtenerEntitlementsTenant` acá
//     mismo, el cron `generarPeriodos`, `obtenerMiPlan`) siguen funcionando
//     SIN CAMBIOS — no necesitan "resolver el plan efectivo" con una fecha,
//     porque `plan_id` YA lo es.
//   - Mientras el downgrade está PENDIENTE, `plan_anterior_id` se REUTILIZA
//     temporalmente para guardar el plan DESTINO (no "el plan anterior" pese
//     a su nombre — ver el JSDoc del campo). Es una sobrecarga semántica
//     deliberada, la alternativa más simple sin migración nueva
//     (`plan_pendiente_id` hubiera sido más clara, pero no es necesaria).
//   - El job `aplicarCambiosPlan` (`jobs/aplicar-cambios-plan.ts`), cuando
//     `cambio_efectivo_desde <= hoy`, hace el swap real: `plan_id =
//     plan_anterior_id` (aplica el destino) y LIMPIA ambos campos
//     (`plan_anterior_id = null`, `cambio_efectivo_desde = null`) — no se
//     conserva un histórico permanente de "vino de qué plan" (exigiría una
//     tabla de historial aparte, fuera de alcance de esta fase).
//   - Un UPGRADE posterior CANCELA cualquier downgrade pendiente (limpia
//     `plan_anterior_id`/`cambio_efectivo_desde`) — el upgrade es inmediato y
//     gana sobre un downgrade que aún no se aplicó.
//   - CAMBIO DE PERIODICIDAD (mensual↔anual): SIEMPRE se DIFIERE al próximo
//     ciclo (nunca se prorratea), aplicándose junto al plan destino en
//     `cambio_efectivo_desde`. Se guarda en `periodicidad_pendiente` (migración
//     20260712000006). Razón (fix de dinero ALTO, Ola 2): prorratear un cambio
//     de periodicidad exige comparar precios en unidades de tiempo distintas
//     (mensual vs anual), lo que producía un cargo sin sentido (~el precio
//     anual completo prorrateado sobre un ciclo mensual). Al diferir, cada
//     ciclo se cobra SIEMPRE en una sola unidad. Un cambio de solo-plan (misma
//     periodicidad) mantiene upgrade-inmediato / downgrade-diferido.

/** Resultado tipado de `cambiarPlanCourier` — lo consume la Server Action. */
export interface ResultadoCambioPlan {
  ok: true;
  /** `upgrade` = inmediato con posible cargo prorrateado; `downgrade` = plan
   *  más barato, diferido al próximo ciclo; `periodicidad` = cambio de
   *  periodicidad (mensual↔anual), diferido, sin cargo inmediato. */
  tipo: 'upgrade' | 'downgrade' | 'periodicidad';
  /** Monto del cargo de proración inmediato (CLP), o `null` si no aplicó
   *  ninguno (downgrade, cambio de periodicidad, o upgrade cuyo prorrateo dio
   *  0/negativo). */
  montoAjuste: number | null;
  /** Fecha ('YYYY-MM-DD', Santiago) en que un cambio DIFERIDO (downgrade o
   *  cambio de periodicidad) será efectivo, o `null` para un upgrade
   *  (inmediato). */
  efectivoDesde: string | null;
}

interface ParametrosAjustePlan {
  precioActualClp: number;
  precioNuevoClp: number;
  /** "Hoy" en calendario de Santiago ('YYYY-MM-DD'). */
  hoy: string;
  /** Límites del ciclo VIGENTE que se está prorrateando. */
  periodoInicio: string;
  periodoFin: string;
}

interface ResultadoAjustePlan {
  tipo: 'upgrade' | 'downgrade';
  deltaPrecio: number;
  /** Monto a cobrar de inmediato por el resto del ciclo. Downgrades SIEMPRE 0
   *  (efecto diferido, sin cobro inmediato) — solo aplica a upgrades con
   *  `deltaPrecio > 0` y días restantes > 0 en el ciclo. */
  montoAjuste: number;
}

/**
 * Clasifica un cambio de plan (upgrade/downgrade) y calcula el monto de
 * proración correspondiente. Función PURA (sin I/O) — extraída para poder
 * testearla sin BD, mismo patrón que `decidirAccionAutoCobro`
 * (`jobs/cobrar-periodo-auto.ts`).
 *
 * `montoAjuste = round(deltaPrecio * diasRestantes / diasDelPeriodo)`, donde
 * `diasRestantes` va desde `hoy` hasta `periodoFin` INCLUSIVE, y
 * `diasDelPeriodo` es el largo total INCLUSIVE del ciclo vigente. Precio
 * igual (`deltaPrecio === 0`) se trata como upgrade sin cargo (aplica el
 * cambio de inmediato, sin diferir nada — no hay razón de negocio para
 * diferir un cambio que no empeora el precio).
 */
export function calcularAjustePlan(p: ParametrosAjustePlan): ResultadoAjustePlan {
  const deltaPrecio = p.precioNuevoClp - p.precioActualClp;

  if (deltaPrecio < 0) {
    return { tipo: 'downgrade', deltaPrecio, montoAjuste: 0 };
  }

  const diasDelPeriodo = diferenciaEnDiasCalendario(p.periodoInicio, p.periodoFin) + 1;
  if (deltaPrecio === 0 || diasDelPeriodo <= 0) {
    return { tipo: 'upgrade', deltaPrecio, montoAjuste: 0 };
  }

  const diasRestantesCrudo = diferenciaEnDiasCalendario(p.hoy, p.periodoFin) + 1;
  // Clamp defensivo: `hoy` fuera del ciclo vigente (no debería pasar en el
  // camino normal) nunca produce más días de los que tiene el ciclo, ni un
  // cargo negativo por días "restantes" negativos.
  const diasRestantes = Math.max(0, Math.min(diasRestantesCrudo, diasDelPeriodo));
  const montoAjuste = Math.max(0, Math.round((deltaPrecio * diasRestantes) / diasDelPeriodo));

  return { tipo: 'upgrade', deltaPrecio, montoAjuste };
}

/**
 * Cambia el plan (y opcionalmente la periodicidad) de la suscripción del
 * tenant, con proración. `tenantId` DEBE venir ya validado por el llamador
 * (claim del JWT), igual que el resto de este archivo.
 *
 * UPGRADE (precio nuevo >= actual): efecto INMEDIATO — actualiza `plan_id`
 * (y `periodicidad` si cambió) ya, y si el prorrateo del resto del ciclo da
 * >0, genera un período `concepto='ajuste_proracion'` y emite
 * `plataforma/suscripcion.periodo-generado` (mismo evento que el cron
 * mensual — reusa el auto-cobro/link existente, esta función NUNCA llama al
 * proveedor de pago síncronamente).
 *
 * DOWNGRADE (precio nuevo < actual): efecto DIFERIDO, sin cobro. Ver el
 * bloque de comentarios arriba de este archivo para el modelo de datos
 * elegido.
 *
 * Idempotencia: la bitácora se registra ANTES de cualquier escritura (RNF-04).
 * El período de ajuste comparte la UNIQUE (suscripcion_id, periodo_inicio) de
 * los períodos regulares — un doble submit el mismo día no duplica el cargo
 * (recupera la fila existente ante 23505). El evento Inngest lleva `id`
 * determinístico por período (`suscripcion-periodo-generado-${periodoId}`) —
 * un reintento no dispara un segundo intento de cobro.
 */
export async function cambiarPlanCourier(opts: {
  tenantId: string;
  nuevoPlanId: string;
  nuevaPeriodicidad?: Periodicidad;
  actorUsuarioId: string;
}): Promise<ResultadoCambioPlan> {
  const supabase = crearClienteServiceRole();

  // 1. Leer la suscripción actual.
  const { data: susc, error: errSusc } = await supabase
    .schema('plataforma')
    .from('suscripciones')
    .select('id, plan_id, periodicidad, estado')
    .eq('tenant_id', opts.tenantId)
    .maybeSingle();
  if (errSusc) throw new Error(`Error al leer la suscripción: ${errSusc.message}`);
  if (!susc) throw new Error('El tenant no tiene una suscripción — no se puede cambiar de plan.');
  if (susc.estado === 'cancelada') {
    throw new Error('No se puede cambiar el plan de una suscripción cancelada.');
  }

  const suscripcionId = susc.id as string;
  const planActualId = susc.plan_id as string;
  const periodicidadActual = (susc.periodicidad as Periodicidad) ?? 'mensual';
  const periodicidadNueva = opts.nuevaPeriodicidad ?? periodicidadActual;

  if (opts.nuevoPlanId === planActualId && periodicidadNueva === periodicidadActual) {
    throw new Error('El nuevo plan es igual al plan actual — no hay cambio que aplicar.');
  }

  // 2. Leer el plan nuevo (debe existir y estar activo) y el plan actual.
  const { data: planNuevo, error: errPlanNuevo } = await supabase
    .schema('plataforma')
    .from('planes')
    .select('id, activo, precio_mensual_clp, precio_anual_clp')
    .eq('id', opts.nuevoPlanId)
    .maybeSingle();
  if (errPlanNuevo) throw new Error(`Error al leer el plan solicitado: ${errPlanNuevo.message}`);
  if (!planNuevo) throw new Error('El plan solicitado no existe.');
  if (!planNuevo.activo) throw new Error('El plan solicitado no está disponible.');

  const { data: planActual, error: errPlanActual } = await supabase
    .schema('plataforma')
    .from('planes')
    .select('precio_mensual_clp, precio_anual_clp')
    .eq('id', planActualId)
    .maybeSingle();
  if (errPlanActual) throw new Error(`Error al leer el plan actual: ${errPlanActual.message}`);
  if (!planActual) throw new Error('El plan actual de la suscripción no fue encontrado.');

  const precioActual =
    periodicidadActual === 'mensual' ? Number(planActual.precio_mensual_clp) : Number(planActual.precio_anual_clp);
  const precioNuevo =
    periodicidadNueva === 'mensual' ? Number(planNuevo.precio_mensual_clp) : Number(planNuevo.precio_anual_clp);

  // 3. Leer el período vigente (concepto='periodo', el más reciente) — da los
  // límites del ciclo que se está prorrateando. Filtrar por concepto='periodo'
  // es necesario: un `ajuste_proracion` insertado hoy tendría un
  // `periodo_inicio` más reciente pero NO son los límites reales del ciclo.
  const { data: periodoVigente, error: errPeriodo } = await supabase
    .schema('plataforma')
    .from('periodos_suscripcion')
    .select('periodo_inicio, periodo_fin')
    .eq('suscripcion_id', suscripcionId)
    .eq('concepto', 'periodo')
    .order('periodo_inicio', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (errPeriodo) throw new Error(`Error al leer el período vigente: ${errPeriodo.message}`);
  if (!periodoVigente) {
    throw new Error(
      'La suscripción aún no tiene un período de cobro generado — no se puede calcular el cambio de plan.',
    );
  }

  const hoy = ahoraEnSantiago().fecha;

  // ---------------------------------------------------------------------
  // CAMBIO DE PERIODICIDAD (mensual↔anual) — SIEMPRE diferido al próximo
  // ciclo, sin proración. Se decide ANTES de calcular ningún ajuste: cruzar
  // unidades de tiempo en una resta de precios producía el cargo sin sentido
  // (fix de dinero ALTO, Ola 2). Aplica también el plan destino (puede ser el
  // mismo) en la misma fecha efectiva, vía `periodicidad_pendiente` +
  // `plan_anterior_id`; el job `aplicarCambiosPlan` hace el swap.
  // ---------------------------------------------------------------------
  if (periodicidadNueva !== periodicidadActual) {
    const efectivoDesde = sumarDiasCalendario(periodoVigente.periodo_fin as string, 1);

    await registrarEnBitacora(supabase, {
      tenantId: opts.tenantId,
      actorUsuarioId: opts.actorUsuarioId,
      actorTipo: 'usuario',
      accion: 'plataforma.plan_cambiado',
      entidadTipo: 'suscripcion',
      entidadId: suscripcionId,
      detalle: {
        desde: planActualId,
        hacia: opts.nuevoPlanId,
        tipo: 'cambio_periodicidad',
        periodicidad_desde: periodicidadActual,
        periodicidad_hacia: periodicidadNueva,
        monto_ajuste: null,
      },
    });

    const { error: errUpdatePeriodicidad } = await supabase
      .schema('plataforma')
      .from('suscripciones')
      .update({
        plan_anterior_id: opts.nuevoPlanId, // plan DESTINO pendiente (puede == actual)
        periodicidad_pendiente: periodicidadNueva,
        cambio_efectivo_desde: efectivoDesde,
        actualizado_en: new Date().toISOString(),
      })
      .eq('id', suscripcionId);
    if (errUpdatePeriodicidad) {
      throw new Error(`Error al registrar el cambio de periodicidad diferido: ${errUpdatePeriodicidad.message}`);
    }

    return { ok: true, tipo: 'periodicidad', montoAjuste: null, efectivoDesde };
  }

  // Periodicidad SIN cambio → proración de plan en la MISMA unidad (precioActual
  // y precioNuevo son ambos mensuales o ambos anuales — nunca se cruzan).
  const ajuste = calcularAjustePlan({
    precioActualClp: precioActual,
    precioNuevoClp: precioNuevo,
    hoy,
    periodoInicio: periodoVigente.periodo_inicio as string,
    periodoFin: periodoVigente.periodo_fin as string,
  });

  // Bitácora ANTES de cualquier efecto (RNF-04) — una sola entrada por
  // invocación, cubre ambas ramas.
  await registrarEnBitacora(supabase, {
    tenantId: opts.tenantId,
    actorUsuarioId: opts.actorUsuarioId,
    actorTipo: 'usuario',
    accion: 'plataforma.plan_cambiado',
    entidadTipo: 'suscripcion',
    entidadId: suscripcionId,
    detalle: {
      desde: planActualId,
      hacia: opts.nuevoPlanId,
      tipo: ajuste.tipo,
      monto_ajuste: ajuste.tipo === 'upgrade' && ajuste.montoAjuste > 0 ? ajuste.montoAjuste : null,
    },
  });

  // ---------------------------------------------------------------------
  // DOWNGRADE — efecto diferido, sin cobro. `plan_id` NO se toca (ver
  // comentario del modelo arriba del archivo).
  // ---------------------------------------------------------------------
  if (ajuste.tipo === 'downgrade') {
    const efectivoDesde = sumarDiasCalendario(periodoVigente.periodo_fin as string, 1);

    const { error: errUpdate } = await supabase
      .schema('plataforma')
      .from('suscripciones')
      .update({
        plan_anterior_id: opts.nuevoPlanId, // plan DESTINO mientras está pendiente (ver JSDoc)
        cambio_efectivo_desde: efectivoDesde,
        actualizado_en: new Date().toISOString(),
      })
      .eq('id', suscripcionId);
    if (errUpdate) throw new Error(`Error al registrar el downgrade diferido: ${errUpdate.message}`);

    return { ok: true, tipo: 'downgrade', montoAjuste: null, efectivoDesde };
  }

  // ---------------------------------------------------------------------
  // UPGRADE — efecto inmediato. Actualiza plan_id/periodicidad y limpia
  // cualquier downgrade pendiente (un upgrade lo cancela).
  // ---------------------------------------------------------------------
  const { error: errUpdateSusc } = await supabase
    .schema('plataforma')
    .from('suscripciones')
    .update({
      plan_id: opts.nuevoPlanId,
      periodicidad: periodicidadNueva,
      plan_anterior_id: null,
      cambio_efectivo_desde: null,
      actualizado_en: new Date().toISOString(),
    })
    .eq('id', suscripcionId);
  if (errUpdateSusc) throw new Error(`Error al actualizar el plan: ${errUpdateSusc.message}`);

  // Notificación de ciclo de vida (F2 "Ola 3", ítem M) — el plan YA cambió de
  // forma efectiva en este punto (UPDATE recién confirmado), con o sin cargo
  // de proración. `id` determinístico por suscripción + plan destino + día:
  // un doble submit del MISMO cambio no duplica el correo; dos cambios
  // REALES distintos el mismo día (p. ej. dos upgrades a planes distintos)
  // sí generan cada uno su propia notificación.
  const enviarEventoPlanCambiado = (montoAjusteClp: number | null) =>
    inngest.send({
      name: 'plataforma/plan.cambiado',
      id: `plan-cambiado-${suscripcionId}-${opts.nuevoPlanId}-${hoy}`,
      data: {
        tenantId: opts.tenantId,
        suscripcionId,
        planDesdeId: planActualId,
        planHaciaId: opts.nuevoPlanId,
        tipo: 'upgrade' as const,
        periodicidadDesde: periodicidadActual,
        periodicidadHacia: periodicidadNueva,
        montoAjusteClp,
        efectivoDesde: hoy,
        actorUsuarioId: opts.actorUsuarioId,
      },
    });

  if (ajuste.montoAjuste <= 0) {
    await enviarEventoPlanCambiado(null);
    return { ok: true, tipo: 'upgrade', montoAjuste: null, efectivoDesde: null };
  }

  const venceEn = sumarDiasCalendario(hoy, 5);

  const { data: nuevoPeriodo, error: errInsert } = await supabase
    .schema('plataforma')
    .from('periodos_suscripcion')
    .insert({
      suscripcion_id: suscripcionId,
      tenant_id: opts.tenantId,
      periodo_inicio: hoy,
      periodo_fin: periodoVigente.periodo_fin,
      monto_clp: ajuste.montoAjuste,
      estado: 'pendiente',
      vence_en: venceEn,
      concepto: 'ajuste_proracion',
    })
    .select('id')
    .maybeSingle();

  let periodoAjusteId: string | null = null;
  // Monto REALMENTE persistido para este período de ajuste (lo que se reporta al
  // courier y viaja en el evento) — puede diferir de `ajuste.montoAjuste` recién
  // calculado si recuperamos un ajuste ya existente del mismo día.
  let montoPersistido = ajuste.montoAjuste;
  if (errInsert) {
    if ((errInsert as { code?: string }).code === '23505') {
      // Ya existe un `ajuste_proracion` para HOY. Con el UNIQUE
      // (suscripcion_id, periodo_inicio, concepto) (migración 20260712000005)
      // esto ya NO choca con el período regular del mismo día (fix B-1) — solo
      // con OTRO ajuste del mismo día: un reintento/carrera del MISMO upgrade
      // (un doble submit secuencial se rechaza antes, porque tras el primero
      // `plan_id` ya == destino) o un segundo upgrade distinto. Recuperamos ESE
      // ajuste (filtrando por concepto) y reportamos su monto REAL persistido en
      // vez del recién calculado — así el courier nunca ve confirmado un monto
      // que no quedó en BD (fix del hallazgo MEDIO de QA). No re-prorrateamos ni
      // acumulamos: evita duplicar el cargo ante una carrera del mismo upgrade
      // (el incremental de un segundo upgrade distinto el mismo día no se cobra
      // de nuevo este ciclo — caso raro que favorece al courier).
      const { data: existente, error: errExistente } = await supabase
        .schema('plataforma')
        .from('periodos_suscripcion')
        .select('id, monto_clp')
        .eq('suscripcion_id', suscripcionId)
        .eq('periodo_inicio', hoy)
        .eq('concepto', 'ajuste_proracion')
        .maybeSingle();
      if (errExistente) {
        throw new Error(`Error al recuperar el período de ajuste tras conflicto: ${errExistente.message}`);
      }
      periodoAjusteId = (existente?.id as string) ?? null;
      if (existente?.monto_clp != null) {
        montoPersistido = Number(existente.monto_clp);
      }
    } else {
      throw new Error(`Error al generar el período de ajuste: ${errInsert.message}`);
    }
  } else {
    periodoAjusteId = (nuevoPeriodo?.id as string) ?? null;
  }

  if (periodoAjusteId) {
    // Publicar DESPUÉS de persistir — mismo evento que el cron mensual, `id`
    // determinístico por período (reusa el auto-cobro/link existente; esta
    // función NUNCA llama al proveedor de pago síncronamente). Ante una
    // recuperación, el `id` determinístico hace que Inngest lo dedupee: no
    // dispara un segundo cobro.
    await inngest.send({
      name: 'plataforma/suscripcion.periodo-generado',
      id: `suscripcion-periodo-generado-${periodoAjusteId}`,
      data: {
        tenantId: opts.tenantId,
        suscripcionId,
        periodoId: periodoAjusteId,
        montoClp: montoPersistido,
        periodoInicio: hoy,
        periodoFin: periodoVigente.periodo_fin as string,
        periodicidad: periodicidadNueva,
      },
    });
  }

  await enviarEventoPlanCambiado(montoPersistido);

  return { ok: true, tipo: 'upgrade', montoAjuste: montoPersistido, efectivoDesde: null };
}

// =============================================================================
// Áreas de producto encendidas para el courier
// =============================================================================

/**
 * Qué áreas del producto tiene ENCENDIDAS este courier.
 *
 * `plataforma.areas_habilitadas` es deny-all como el resto del schema: el
 * courier no la lee ni sabe que existe, solo ve el efecto (la opción no está).
 * Por eso pasa por acá, que es la única puerta courier-safe.
 *
 * ⚠️ **La AUSENCIA de fila es «apagada»**, y por eso esta función devuelve la
 * lista vacía cuando no hay nada: un courier recién dado de alta nace sin nada
 * encendido sin que nadie tenga que configurarlo.
 *
 * ⚠️ **Y falla cerrado.** Si la consulta revienta se devuelve la lista vacía, no
 * se lanza: el llamador es `obtenerSesionActual`, que corre en CADA página, y
 * tumbar la sesión entera por esto sería peor. La consecuencia asumida es que
 * una caída de base deja al courier sin las áreas encendidas por un rato —
 * molesto, pero del lado seguro. Al revés (abrir el módulo de dinero cuando la
 * lectura falla) es exactamente lo que este interruptor viene a impedir.
 *
 * Memoizada por request con `cache()` de React: la llama la resolución de
 * sesión, que a su vez se consulta muchas veces por página.
 */
export const obtenerAreasHabilitadas = cache(async function obtenerAreasHabilitadas(
  tenantId: string,
): Promise<readonly AreaProducto[]> {
  try {
    const supabase = crearClienteServiceRole();
    const { data, error } = await supabase
      .schema('plataforma')
      .from('areas_habilitadas')
      .select('area')
      .eq('tenant_id', tenantId);

    if (error) return [];

    return (data ?? [])
      .map((f) => f.area as unknown)
      .filter(esAreaProducto);
  } catch {
    return [];
  }
});
