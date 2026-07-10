/**
 * Consultas de lectura del TABLERO DE SALUD del super-admin (auditoría §2.7/QW3).
 * =============================================================================
 * Alimenta `app/admin/salud`. Dos fuentes:
 *  - Telemetría de jobs: vía la RPC `salud_jobs_resumen` (el schema `infra` no
 *    se expone a PostgREST; la RPC es la única superficie de lectura).
 *  - Backlog del motor entrega→dinero: conteos sobre `dinero` con service_role.
 *
 * Solo LEE — sin side effects. Se ejecuta detrás de la sesión super-admin.
 */

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { ESTADOS_NO_TERMINALES_CONCILIACION } from '@/modules/dinero/conciliacion-clasificacion';

const TZ = 'America/Santiago';

function hoyEnSantiago(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Estado de salud del último run de un job (una fila por job_id). */
export interface SaludJob {
  jobId: string;
  evento: string | null;
  estado: 'ejecutando' | 'ok' | 'error';
  tenantId: string | null;
  iniciadoEn: string | null;
  finalizadoEn: string | null;
  duracionMs: number | null;
  error: string | null;
  ultimoOkEn: string | null;
  ejecuciones24h: number;
  errores24h: number;
}

/** Contadores de backlog/integridad del motor entrega→dinero. */
export interface BacklogSistema {
  /** Períodos de cobro vencidos aún 'abierto' (el cierre diario no los cerró). */
  periodosAbiertosVencidos: number;
  /** Excepciones de conciliación en estado no-terminal (pendientes de gestión). */
  conciliacionesPendientes: number;
  /** De las pendientes, cuántas ya pasaron su fecha límite (SLA incumplido). */
  conciliacionesVencidas: number;
  /** Líneas de cobro huérfanas pendientes (tipo linea_cobro_sin_pedido_entregado). */
  lineasHuerfanasPendientes: number;
}

/**
 * Resumen de salud de todos los jobs con telemetría (última ejecución, última
 * exitosa y conteos 24h), ordenado por lo que requiere atención primero.
 */
export async function obtenerSaludJobs(): Promise<SaludJob[]> {
  const supabase = crearClienteServiceRole();
  const { data, error } = await supabase.rpc('salud_jobs_resumen');
  if (error) throw new Error(`Error al leer salud de jobs: ${error.message}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as Record<string, any>[]).map((f) => ({
    jobId: f.job_id,
    evento: f.evento ?? null,
    estado: f.estado,
    tenantId: f.tenant_id ?? null,
    iniciadoEn: f.iniciado_en ?? null,
    finalizadoEn: f.finalizado_en ?? null,
    duracionMs: f.duracion_ms != null ? Number(f.duracion_ms) : null,
    error: f.error ?? null,
    ultimoOkEn: f.ultimo_ok_en ?? null,
    ejecuciones24h: Number(f.ejecuciones_24h ?? 0),
    errores24h: Number(f.errores_24h ?? 0),
  }));
}

/** Contadores de backlog/integridad para las tarjetas superiores del tablero. */
export async function obtenerBacklogSistema(): Promise<BacklogSistema> {
  const supabase = crearClienteServiceRole();
  const hoy = hoyEnSantiago();
  const noTerminales = [...ESTADOS_NO_TERMINALES_CONCILIACION];

  const [periodos, pendientes, vencidas, huerfanas] = await Promise.all([
    supabase
      .schema('dinero')
      .from('periodos_cobro')
      .select('id', { count: 'exact', head: true })
      .eq('estado', 'abierto')
      .lt('fecha_fin', hoy),
    supabase
      .schema('dinero')
      .from('eventos_conciliacion')
      .select('id', { count: 'exact', head: true })
      .in('estado', noTerminales),
    supabase
      .schema('dinero')
      .from('eventos_conciliacion')
      .select('id', { count: 'exact', head: true })
      .in('estado', noTerminales)
      .lt('fecha_limite', hoy),
    supabase
      .schema('dinero')
      .from('eventos_conciliacion')
      .select('id', { count: 'exact', head: true })
      .eq('tipo_diferencia', 'linea_cobro_sin_pedido_entregado')
      .in('estado', noTerminales),
  ]);

  const err = periodos.error ?? pendientes.error ?? vencidas.error ?? huerfanas.error;
  if (err) throw new Error(`Error al leer backlog del sistema: ${err.message}`);

  return {
    periodosAbiertosVencidos: periodos.count ?? 0,
    conciliacionesPendientes: pendientes.count ?? 0,
    conciliacionesVencidas: vencidas.count ?? 0,
    lineasHuerfanasPendientes: huerfanas.count ?? 0,
  };
}
