/**
 * Telemetría de ejecución de jobs — funciones puras usadas por el middleware.
 * =====================================================================
 * Registra una fila por run de CUALQUIER job (crons y jobs por evento) en
 * `infra.ejecuciones_job` vía la RPC `public.job_run_registrar`. Cubre "última
 * ejecución exitosa / duración / elementos procesados / alerta por fallo" de la
 * auditoría (§2.7 / §3.2 / QW3) para TODOS los procesos automáticos. El
 * super-admin lo ve en `admin/salud`.
 *
 * Vive SEPARADO del middleware (no como una segunda clase `BaseMiddleware`) a
 * propósito: registrar un segundo middleware en el cliente Inngest recompone los
 * `stepOutputTransform` de la v4 y colapsa el tipo de salida de `step.run` a
 * `{}`, rompiendo el typecheck de jobs ya existentes. Manteniendo UN solo
 * middleware (`MiddlewareObservabilidad`) que llama a estas funciones, la
 * inferencia de tipos no cambia. Ver `middleware-observabilidad.ts`.
 *
 * Invariantes (iguales a observabilidad):
 * - NUNCA lanza: la telemetría jamás puede tumbar el job que observa.
 * - Todo lo que se persiste pasa por `redactarSensible` — nunca tokens/PII.
 */

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { redactarSensible } from '@/lib/observabilidad/redaccion';

/** Tope de tamaño del `resumen` persistido (el output del job, ya redactado). */
export const RESUMEN_MAX_CHARS = 8192;

interface CtxTelemetria {
  runId?: string;
  attempt?: number;
  event?: { name?: string; data?: { tenantId?: unknown } };
}

/**
 * Escribe/actualiza la fila de telemetría del run vía RPC. Nunca lanza. Redacta
 * el resumen y el error antes de que salgan del proceso.
 *
 * @param estado 'ejecutando' (onRunStart) | 'ok' (onRunComplete) | 'error' (onRunError final).
 */
export async function registrarTelemetriaRun(
  estado: 'ejecutando' | 'ok' | 'error',
  ctx: unknown,
  fn: unknown,
  datos?: { resumen?: unknown; error?: unknown },
): Promise<void> {
  try {
    const c = ctx as CtxTelemetria;
    const runId = typeof c.runId === 'string' ? c.runId : null;
    if (!runId) return; // sin runId no hay clave; nada que registrar

    const tenantId =
      typeof c.event?.data?.tenantId === 'string' ? c.event.data.tenantId : null;

    const supabase = crearClienteServiceRole();
    await supabase.rpc('job_run_registrar', {
      p_run_id: runId,
      p_estado: estado,
      p_job_id: leerIdJob(fn),
      p_evento: c.event?.name ?? null,
      p_tenant_id: tenantId,
      p_intento: typeof c.attempt === 'number' ? c.attempt : null,
      p_resumen: datos?.resumen !== undefined ? acotarResumen(datos.resumen) : null,
      p_error: datos?.error !== undefined ? mensajeErrorTelemetria(datos.error) : null,
    });
  } catch {
    // La telemetría JAMÁS propaga su propio fallo al job.
  }
}

/** Redacta y acota el output del job a un jsonb seguro y de tamaño limitado. */
export function acotarResumen(output: unknown): unknown {
  // Los jobs devuelven objetos (conteos, ids); envolvemos primitivos para que
  // el jsonb sea siempre un objeto navegable en el tablero.
  const base = output !== null && typeof output === 'object' ? output : { valor: output };
  const redactado = redactarSensible(base);
  try {
    const json = JSON.stringify(redactado);
    if (json.length > RESUMEN_MAX_CHARS) {
      return { truncado: true, tamano: json.length };
    }
    return redactado;
  } catch {
    return { no_serializable: true };
  }
}

/** Extrae el mensaje del error, redactado. */
export function mensajeErrorTelemetria(error: unknown): string {
  const msg =
    error instanceof Error ? error.message : typeof error === 'string' ? error : String(error);
  const red = redactarSensible(msg);
  return typeof red === 'string' ? red : '[redactado]';
}

/** Lee el id del job de forma defensiva (`fn.id()` o `fn.name`). */
export function leerIdJob(fn: unknown): string {
  const f = fn as { id?: (prefix?: string) => string; name?: string };
  try {
    if (typeof f.id === 'function') return f.id();
  } catch {
    // sigue al fallback
  }
  return typeof f.name === 'string' && f.name ? f.name : 'desconocido';
}
