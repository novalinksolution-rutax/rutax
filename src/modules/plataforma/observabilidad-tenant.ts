/**
 * Drill-down de observabilidad de UN tenant (gap 9 — "Observabilidad
 * por-tenant" del informe, ver `docs/plataforma/`).
 * =============================================================================
 * Complementa a `salud.ts`/`panel-couriers.ts` (system-wide y multi-courier)
 * con el detalle de UN courier específico para `/admin/couriers/[tenantId]`
 * (la pantalla la arma `frontend`). Solo lectura, `service_role`, sin side
 * effects — sigue el mismo patrón de `panel-couriers.ts`: COMPONE lo que ya
 * existe, no reimplementa lógica de negocio.
 *
 * Qué reusa (sin reimplementar):
 * - `obtenerSuscripcionPorTenant` (`consultas.ts`) — estado de suscripción/plan.
 * - `derivarSaludCourier` (`panel-couriers.ts`) — el mismo semáforo verde/
 *   amarillo/rojo que el panel multi-courier, para que ambas pantallas nunca
 *   diverjan en el criterio.
 * - `obtenerResumenSaludMlPorTenant` (`integraciones/ml`, lector NUEVO y
 *   mínimo agregado a ese adaptador para este gap) — agrupa `estado_salud` de
 *   `identidad.conexiones_seller_ml` por tenant. NO toca ni reimplementa el
 *   sondeo (`ml/jobs/sondeo-salud.ts`, Job 2): ese sigue siendo la ÚNICA
 *   fuente que escribe `estado_salud`; esto solo lee y agrupa.
 * - `ESTADOS_TERMINALES_PEDIDO` (`operacion/metricas.ts`) — el mismo criterio
 *   de "pedido no terminal" que ya usa el dashboard del dueño para
 *   "rezagados", así "pedidos pendientes/en curso" no re-deriva una lista
 *   paralela de estados.
 *
 * Qué NO incluye (y por qué, sin inventar infraestructura nueva):
 * - Errores/telemetría de JOBS por-tenant: `infra.ejecuciones_job` SÍ guarda
 *   `tenant_id` (cuando el evento lo trae), pero el schema `infra` no está en
 *   `api.schemas` (`supabase/config.toml`) — a propósito, no se expone a
 *   PostgREST (ver migración `20260709000002`). La única superficie de
 *   lectura es la RPC `salud_jobs_resumen()`, que agrega por `job_id`
 *   SYSTEM-WIDE (una fila por job, no por tenant) — no admite filtrar por
 *   tenant sin una RPC nueva. Crear esa RPC es trabajo de `base-datos-rls`
 *   (migración), fuera del alcance de este módulo de solo-lectura de
 *   TypeScript; queda anotado aquí para cuando se decida abordar ese detalle.
 * - "Errores recientes" SÍ se cubre, pero barato: se reusa
 *   `identidad.bitacora_auditoria` (ya tiene índice `(tenant_id, creado_en
 *   desc)` — migración `20260101000004`) filtrando por un conjunto acotado de
 *   `accion` que ya representan problemas/alertas conocidas en el sistema
 *   (conexión ML caída, conductor caído, incidencia sin gestión, mandato de
 *   auto-cobro fallido, etc. — ver `ACCIONES_ALERTA_TENANT`). No es un log de
 *   errores genérico (la bitácora no está pensada para eso) — es una vista
 *   curada de "cosas que ya el sistema decidió que ameritan revisión" para
 *   ESE tenant.
 *
 * Minimización de PII (multitenant-rls / motor-entrega-dinero): ningún campo
 * expone nombre/dirección de destinatario ni datos identificables de
 * conductor — solo agregados (conteos) y, en alertas, el `entidadId` (uuid) +
 * `accion` que YA pasó por el saneo de `registrarEnBitacora` (nunca secretos).
 */

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { obtenerSuscripcionPorTenant } from './consultas';
import { derivarSaludCourier, type NivelSaludCourier } from './panel-couriers';
import type { EstadoSuscripcion, Periodicidad } from './tipos';
import { obtenerResumenSaludMlPorTenant } from '@/modules/integraciones/ml';
import type { ResumenSaludMlTenant } from '@/modules/integraciones/ml';
import { ESTADOS_TERMINALES_PEDIDO } from '@/modules/operacion/metricas';

/**
 * `accion` de `bitacora_auditoria` consideradas "alertas" para el drill-down:
 * curadas a mano de entre las acciones que YA se registran en el sistema (ver
 * grep de `accion:` en `src/modules`), eligiendo solo las que representan un
 * problema/situación que amerita revisión humana — no cualquier acción de
 * negocio normal (crear un plan, emitir un DTE, etc. NO son alertas).
 *
 * Deliberadamente NO incluye `dinero.payout_ejecutado` (se registra tanto en
 * éxito como en fallo — el resultado va en `detalle.estado_payout`, no en la
 * `accion` — filtrar por accion no distinguiría fallo de éxito sin inspeccionar
 * `detalle`, lo que deja de ser "barato").
 *
 * Extender esta lista es seguro y barato (no requiere migración): agregar un
 * valor nuevo solo amplía el filtro `IN` sobre un índice ya existente.
 */
const ACCIONES_ALERTA_TENANT: readonly string[] = [
  // Conexiones ML del seller.
  'notificacion.conexion_caida',
  'conexion_ml.error_callback',
  'conexion_ml.colision_detectada',
  // Operación.
  'operacion.conductor_caido',
  'operacion.notificacion_incidencia_sin_gestion',
  // Dinero / cobranza de plataforma.
  'dinero.alerta_morosidad',
  'dinero.alerta_folios_proximos',
  'plataforma.mandato_fallido',
  'plataforma.pago_suscripcion_monto_discrepante',
];

/** Filas por defecto de "alertas recientes" — acotado, es un resumen, no un log completo. */
const LIMITE_ALERTAS = 15;

/** Alerta curada del tenant — proyección mínima de una fila de bitácora. */
export interface AlertaTenant {
  id: number;
  creadoEn: string;
  accion: string;
  entidadTipo: string;
  entidadId: string | null;
}

/** Backlog operativo del tenant — solo agregados, sin PII de pedidos/incidencias. */
export interface BacklogOperativoTenant {
  /** Pedidos con estado fuera de `ESTADOS_TERMINALES_PEDIDO` (pipeline activo). */
  pedidosPendientes: number;
  /** Incidencias con estado `abierta` o `en_gestion`. */
  incidenciasSinGestion: number;
}

/** Estado de suscripción/morosidad del tenant, reusando el semáforo del panel multi-courier. */
export interface SuscripcionResumenTenant {
  suscripcionId: string;
  estado: EstadoSuscripcion;
  planNombre: string;
  periodicidad: Periodicidad;
  periodosVencidos: number;
  salud: NivelSaludCourier;
}

/** Drill-down completo de observabilidad de un tenant, para `/admin/couriers/[tenantId]`. */
export interface ObservabilidadTenant {
  tenantId: string;
  nombreFantasia: string | null;
  conexionesMl: ResumenSaludMlTenant;
  backlogOperativo: BacklogOperativoTenant;
  alertasRecientes: AlertaTenant[];
  /** `null` si el tenant aún no tiene suscripción asignada (onboarding incompleto). */
  suscripcion: SuscripcionResumenTenant | null;
}

async function contarPedidosPendientes(
  supabase: ReturnType<typeof crearClienteServiceRole>,
  tenantId: string,
): Promise<number> {
  const { count, error } = await supabase
    .schema('operacion')
    .from('pedidos')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .not('estado', 'in', `(${ESTADOS_TERMINALES_PEDIDO.join(',')})`);

  if (error) throw new Error(`Error al contar pedidos pendientes del tenant: ${error.message}`);
  return count ?? 0;
}

async function contarIncidenciasSinGestion(
  supabase: ReturnType<typeof crearClienteServiceRole>,
  tenantId: string,
): Promise<number> {
  const { count, error } = await supabase
    .schema('operacion')
    .from('incidencias')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .in('estado', ['abierta', 'en_gestion']);

  if (error) throw new Error(`Error al contar incidencias sin gestión del tenant: ${error.message}`);
  return count ?? 0;
}

async function contarPeriodosVencidos(
  supabase: ReturnType<typeof crearClienteServiceRole>,
  tenantId: string,
): Promise<number> {
  const { count, error } = await supabase
    .schema('plataforma')
    .from('periodos_suscripcion')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('estado', 'vencido');

  if (error) throw new Error(`Error al contar períodos vencidos del tenant: ${error.message}`);
  return count ?? 0;
}

async function obtenerAlertasRecientes(
  supabase: ReturnType<typeof crearClienteServiceRole>,
  tenantId: string,
): Promise<AlertaTenant[]> {
  const { data, error } = await supabase
    .schema('identidad')
    .from('bitacora_auditoria')
    .select('id, creado_en, accion, entidad_tipo, entidad_id')
    .eq('tenant_id', tenantId)
    .in('accion', ACCIONES_ALERTA_TENANT)
    .order('creado_en', { ascending: false })
    .limit(LIMITE_ALERTAS);

  if (error) throw new Error(`Error al leer alertas recientes del tenant: ${error.message}`);

  return (data ?? []).map((f) => ({
    id: f.id as number,
    creadoEn: f.creado_en as string,
    accion: f.accion as string,
    entidadTipo: f.entidad_tipo as string,
    entidadId: (f.entidad_id as string | null) ?? null,
  }));
}

async function obtenerNombreFantasiaTenant(
  supabase: ReturnType<typeof crearClienteServiceRole>,
  tenantId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .schema('identidad')
    .from('tenants')
    .select('nombre_fantasia')
    .eq('id', tenantId)
    .maybeSingle();

  if (error) throw new Error(`Error al leer el nombre del tenant: ${error.message}`);
  return (data?.nombre_fantasia as string | null) ?? null;
}

/**
 * Drill-down de observabilidad de un tenant: salud de sus conexiones ML,
 * backlog operativo, alertas recientes y estado de suscripción/morosidad.
 * Solo lectura, `service_role` (el schema `plataforma` es deny-all para
 * `authenticated` — solo el backstage admin, detrás de sesión super-admin,
 * llama a esto).
 */
export async function obtenerObservabilidadTenant(tenantId: string): Promise<ObservabilidadTenant> {
  const supabase = crearClienteServiceRole();

  const [suscripcion, conexionesMl, pedidosPendientes, incidenciasSinGestion, alertasRecientes] =
    await Promise.all([
      obtenerSuscripcionPorTenant(tenantId),
      obtenerResumenSaludMlPorTenant(tenantId),
      contarPedidosPendientes(supabase, tenantId),
      contarIncidenciasSinGestion(supabase, tenantId),
      obtenerAlertasRecientes(supabase, tenantId),
    ]);

  // La morosidad solo tiene sentido si hay suscripción — evita una query de
  // más cuando el tenant aún no tiene una asignada (mismo criterio que
  // `panel-couriers.ts`: sin suscripciones, no se dispara la query de morosidad).
  const periodosVencidos = suscripcion ? await contarPeriodosVencidos(supabase, tenantId) : 0;

  const nombreFantasia = suscripcion
    ? suscripcion.nombreFantasiaTenant
    : await obtenerNombreFantasiaTenant(supabase, tenantId);

  return {
    tenantId,
    nombreFantasia,
    conexionesMl,
    backlogOperativo: { pedidosPendientes, incidenciasSinGestion },
    alertasRecientes,
    suscripcion: suscripcion
      ? {
          suscripcionId: suscripcion.id,
          estado: suscripcion.estado,
          planNombre: suscripcion.plan.nombre,
          periodicidad: suscripcion.periodicidad,
          periodosVencidos,
          salud: derivarSaludCourier(suscripcion.estado, periodosVencidos),
        }
      : null,
  };
}
