/**
 * Middleware de observabilidad + telemetría para Inngest (API v4, clases).
 * =====================================================================
 * ÚNICO middleware transversal del cliente Inngest. Dos responsabilidades, un
 * solo punto (no invade cada job):
 *
 *  1. TELEMETRÍA de ejecución (auditoría §2.7/§3.2/QW3): una fila por run en
 *     `infra.ejecuciones_job` (inicio, fin, duración, resumen) para el tablero
 *     de salud del super-admin. La lógica vive en `telemetria-jobs.ts`.
 *  2. ALERTA a la observabilidad central (Sentry/logs) del fallo FINAL de un
 *     job — reintentos agotados o error no reintentable.
 *
 * Es UN solo middleware a propósito: registrar un segundo `BaseMiddleware` en el
 * cliente recompone los `stepOutputTransform` de la v4 y colapsa el tipo de
 * salida de `step.run` a `{}`, rompiendo el typecheck de jobs existentes. Al
 * concentrar ambas responsabilidades aquí, la inferencia de tipos no cambia.
 *
 * Hooks (Inngest ejecuta un run a lo largo de varias requests; el middleware se
 * instancia por request, así que el estado del run vive en la BD vía la RPC
 * upsert, no en la instancia):
 *  - onRunStart    → telemetría 'ejecutando'.
 *  - onRunComplete → telemetría 'ok' + resumen (output del job).
 *  - onRunError    → SOLO fallo final: telemetría 'error' + alerta a Sentry.
 *
 * Con `isFinalAttempt` filtramos los reintentos transitorios —esos los maneja y
 * muestra Inngest— y solo reportamos el fallo real, con tenant y runId de
 * correlación. Ninguna de las dos responsabilidades puede lanzar hacia el job.
 */

import { Middleware } from 'inngest';
import { capturarExcepcion } from '@/lib/observabilidad';
import { registrarTelemetriaRun, leerIdJob } from './telemetria-jobs';

export class MiddlewareObservabilidad extends Middleware.BaseMiddleware {
  readonly id = 'observabilidad';

  async onRunStart(arg: Middleware.OnRunStartArgs): Promise<void> {
    await registrarTelemetriaRun('ejecutando', arg.ctx, arg.fn);
  }

  async onRunComplete(arg: Middleware.OnRunCompleteArgs): Promise<void> {
    await registrarTelemetriaRun('ok', arg.ctx, arg.fn, { resumen: arg.output });
  }

  async onRunError(arg: Middleware.OnRunErrorArgs): Promise<void> {
    // Solo el fallo definitivo: los reintentos transitorios los reintenta y
    // muestra Inngest; no queremos ruido de un error que luego se recupera.
    if (!arg.isFinalAttempt) return;

    // 1) Telemetría durable: marca el run como 'error' (para el tablero).
    await registrarTelemetriaRun('error', arg.ctx, arg.fn, { error: arg.error });

    // 2) Alerta a la observabilidad central (Sentry/logs).
    try {
      const ctx = arg.ctx as unknown as {
        runId?: string;
        attempt?: number;
        event?: { name?: string; data?: { tenantId?: unknown } };
      };
      const tenantId =
        typeof ctx.event?.data?.tenantId === 'string' ? ctx.event.data.tenantId : undefined;

      await capturarExcepcion(arg.error, {
        origen: `job:${leerIdJob(arg.fn)}`,
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
