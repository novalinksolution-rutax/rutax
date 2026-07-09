/**
 * Middleware de observabilidad para Inngest (API v4 basada en clases).
 * =====================================================================
 * Captura, en UN SOLO punto, el fallo FINAL de cualquier job (reintentos
 * agotados o error no reintentable) y lo envía a la observabilidad central
 * (Sentry/logs). Cubre "alertas por ejecuciones fallidas" de la auditoría para
 * TODOS los procesos automáticos (ingesta, cierre de períodos, liquidaciones,
 * facturación, conciliación, refresco de credenciales…) sin tocar cada job.
 *
 * Se engancha en `onRunError`, que Inngest llama SOLO cuando la función lanza
 * (no por cada step ni por cada reintento memoizado). Con `isFinalAttempt`
 * filtramos los reintentos transitorios —esos los maneja y muestra Inngest—
 * y reportamos únicamente el fallo real, con tenant y runId de correlación.
 */

import { Middleware } from 'inngest';
import { capturarExcepcion } from '@/lib/observabilidad';

export class MiddlewareObservabilidad extends Middleware.BaseMiddleware {
  readonly id = 'observabilidad';

  async onRunError(arg: Middleware.OnRunErrorArgs): Promise<void> {
    try {
      // Solo el fallo definitivo: los reintentos transitorios los reintenta y
      // muestra Inngest; no queremos ruido de un error que luego se recupera.
      if (!arg.isFinalAttempt) return;

      const ctx = arg.ctx as unknown as {
        runId?: string;
        attempt?: number;
        event?: { name?: string; data?: { tenantId?: unknown } };
      };
      const tenantId =
        typeof ctx.event?.data?.tenantId === 'string' ? ctx.event.data.tenantId : undefined;

      await capturarExcepcion(arg.error, {
        origen: `job:${leerId(arg.fn)}`,
        tenantId,
        correlacionId: ctx.runId,
        etiquetas: {
          evento: ctx.event?.name ?? 'desconocido',
          ...(typeof ctx.attempt === 'number' ? { attempt: String(ctx.attempt) } : {}),
        },
      });
    } catch {
      // La observabilidad NUNCA interfiere con la ejecución del job.
    }
  }
}

/** Lee el id del job de forma defensiva (`fn.id()` o `fn.name`). */
function leerId(fn: { id?: (prefix?: string) => string; name?: string }): string {
  try {
    if (typeof fn.id === 'function') return fn.id();
  } catch {
    // sigue al fallback
  }
  return typeof fn.name === 'string' && fn.name ? fn.name : 'desconocido';
}
