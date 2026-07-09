/**
 * Observabilidad — captura centralizada de errores y alertas.
 * =====================================================================
 * Único punto por el que pasan las excepciones y las alertas de negocio del
 * sistema (auditoría §2.7 / §4.5: "captura centralizada de excepciones",
 * "alertas por ejecuciones fallidas", "redacción de secretos").
 *
 * DSN-gated, sin dependencia nueva:
 * - Si `SENTRY_DSN` está definido, se envía el evento a Sentry vía su endpoint
 *   de "envelope" (HTTP directo, sin el SDK pesado — así no tocamos el build de
 *   Next). Migrar a `@sentry/nextjs` luego es local: solo cambia el transporte,
 *   los call-sites siguen usando `capturarExcepcion`/`capturarMensaje`.
 * - Si no hay DSN (dev/CI o antes de configurar Sentry), se hace log
 *   estructurado a stdout — que Vercel captura igual.
 *
 * Invariantes:
 * - NUNCA lanza: la observabilidad jamás puede tumbar el flujo que observa.
 * - Todo el contexto pasa por `redactarSensible` antes de salir del proceso.
 * - Fire-and-forget con timeout corto: no bloquea el request ni el job.
 */

import { redactarSensible } from './redaccion';

export type NivelObservabilidad = 'error' | 'warning' | 'info';

export interface ContextoObservabilidad {
  /** Etiqueta del origen: 'job:dinero/cerrarPeriodo', 'request', 'action:emitirFactura'. */
  origen: string;
  /** Tenant afectado, si aplica — clave de triaje multi-tenant. */
  tenantId?: string;
  /** ID de correlación (runId de Inngest, request id) para cruzar señales. */
  correlacionId?: string;
  /** Etiquetas indexables adicionales (valores cortos). */
  etiquetas?: Record<string, string>;
  /** Datos extra libres — se redactan antes de salir. */
  extra?: Record<string, unknown>;
}

const TIMEOUT_ENVIO_MS = 2000;

interface DsnPartes {
  origin: string;
  projectId: string;
  publicKey: string;
}

/** Parsea un DSN de Sentry `https://<publicKey>@<host>/<projectId>`. */
function parsearDsn(dsn: string): DsnPartes | null {
  try {
    const u = new URL(dsn);
    const publicKey = u.username;
    const projectId = u.pathname.replace(/^\/+/, '');
    if (!publicKey || !projectId) return null;
    return { origin: `${u.protocol}//${u.host}`, projectId, publicKey };
  } catch {
    return null;
  }
}

function dsnActivo(): DsnPartes | null {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return null;
  return parsearDsn(dsn);
}

function entorno(): string {
  return (
    process.env.SENTRY_ENVIRONMENT ??
    process.env.VERCEL_ENV ??
    process.env.NODE_ENV ??
    'development'
  );
}

interface EventoSentry {
  event_id: string;
  timestamp: number;
  platform: 'node';
  level: NivelObservabilidad;
  environment: string;
  logger: 'observabilidad';
  release?: string;
  transaction?: string;
  message?: string;
  exception?: { values: Array<{ type: string; value: string }> };
  tags: Record<string, string>;
  extra: Record<string, unknown>;
}

function idEvento(): string {
  // 32 hex sin guiones, como pide Sentry.
  try {
    return crypto.randomUUID().replace(/-/g, '');
  } catch {
    return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  }
}

function normalizarError(error: unknown): { type: string; value: string; stack?: string } {
  if (error instanceof Error) {
    return { type: error.name || 'Error', value: error.message, stack: error.stack };
  }
  if (typeof error === 'string') return { type: 'Error', value: error };
  try {
    return { type: 'Error', value: JSON.stringify(error) };
  } catch {
    return { type: 'Error', value: String(error) };
  }
}

function construirEvento(params: {
  nivel: NivelObservabilidad;
  contexto: ContextoObservabilidad;
  mensaje?: string;
  error?: { type: string; value: string; stack?: string };
}): EventoSentry {
  const { nivel, contexto, mensaje, error } = params;

  const tags: Record<string, string> = { origen: contexto.origen };
  if (contexto.tenantId) tags.tenant_id = contexto.tenantId;
  if (contexto.correlacionId) tags.correlacion_id = contexto.correlacionId;
  for (const [k, v] of Object.entries(contexto.etiquetas ?? {})) {
    if (typeof v === 'string') tags[k] = v;
  }

  const extra = (redactarSensible({
    ...(contexto.extra ?? {}),
    ...(error?.stack ? { stack: error.stack } : {}),
  }) ?? {}) as Record<string, unknown>;

  return {
    event_id: idEvento(),
    timestamp: Date.now() / 1000,
    platform: 'node',
    level: nivel,
    environment: entorno(),
    logger: 'observabilidad',
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    transaction: contexto.origen,
    ...(error ? { exception: { values: [{ type: error.type, value: error.value }] } } : {}),
    ...(mensaje ? { message: mensaje } : {}),
    tags,
    extra,
  };
}

/** Envía el evento a Sentry vía endpoint de envelope. Silencioso ante fallos. */
async function enviarASentry(dsn: DsnPartes, evento: EventoSentry): Promise<boolean> {
  const url = `${dsn.origin}/api/${dsn.projectId}/envelope/?sentry_key=${dsn.publicKey}&sentry_version=7`;
  const cabecera = JSON.stringify({ event_id: evento.event_id, sent_at: new Date().toISOString() });
  const item = JSON.stringify({ type: 'event' });
  const cuerpo = `${cabecera}\n${item}\n${JSON.stringify(evento)}\n`;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-sentry-envelope' },
      body: cuerpo,
      signal: AbortSignal.timeout(TIMEOUT_ENVIO_MS),
      keepalive: true,
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/** Log estructurado a stdout (fallback sin DSN, o si el envío a Sentry falla). */
function logEstructurado(evento: EventoSentry): void {
  const linea = {
    nivel: evento.level,
    origen: evento.tags.origen,
    tenant_id: evento.tags.tenant_id,
    correlacion_id: evento.tags.correlacion_id,
    mensaje: evento.message ?? evento.exception?.values[0]?.value,
    tipo: evento.exception?.values[0]?.type,
    extra: evento.extra,
  };
  const salida = safeStringify(linea);
  if (evento.level === 'error') console.error('[observabilidad]', salida);
  else if (evento.level === 'warning') console.warn('[observabilidad]', salida);
  else console.info('[observabilidad]', salida);
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

async function despachar(evento: EventoSentry): Promise<void> {
  const dsn = dsnActivo();
  if (!dsn) {
    logEstructurado(evento);
    return;
  }
  const ok = await enviarASentry(dsn, evento);
  if (!ok) logEstructurado(evento); // el envío falló → al menos queda en los logs.
}

/**
 * Reporta una excepción. Nunca lanza. Aplica redacción a todo el contexto.
 * Úsalo en el borde de jobs, server actions y route handlers críticos.
 */
export async function capturarExcepcion(
  error: unknown,
  contexto: ContextoObservabilidad,
): Promise<void> {
  try {
    const err = normalizarError(error);
    const evento = construirEvento({ nivel: 'error', contexto, error: err });
    await despachar(evento);
  } catch {
    // La observabilidad JAMÁS propaga su propio fallo.
  }
}

/**
 * Reporta un mensaje/alerta de negocio (p. ej. "hay N discrepancias de
 * conciliación pendientes"). Nunca lanza.
 */
export async function capturarMensaje(
  mensaje: string,
  nivel: NivelObservabilidad,
  contexto: ContextoObservabilidad,
): Promise<void> {
  try {
    const evento = construirEvento({ nivel, contexto, mensaje });
    await despachar(evento);
  } catch {
    // idem.
  }
}
