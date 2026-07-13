/**
 * Normalización PURA del webhook de AUTO-COBRO RECURRENTE (Fintoc).
 * =============================================================================
 * Espejo de `checkout/normalizar-evento.ts`: traduce el evento crudo de Fintoc a
 * la forma del dominio. Sin I/O, sin BD, sin secretos. Quien llama DEBE haber
 * validado la firma antes (helper compartido `verificarFirmaWebhookFintoc`) —
 * esto solo traduce forma.
 *
 * EVENTOS RELEVANTES (verificados contra doc oficial jul 2026):
 *  - `checkout_session.finished` (flujo setup/subscription) → mandato activado.
 *    Guía "Accept recurring payments": el evento referencia `subscription` y
 *    `payment_method` creados en el enrolamiento.
 *    (https://docs.fintoc.com/docs/accept-recurring-payments)
 *  - `subscription.canceled` → mandato caído (el banco/Fintoc canceló). Se trata
 *    como `mandato_fallido`: el mandato ya no puede cobrar → requiere re-vinculación.
 *  - `invoice.payment_succeeded` / `payment_intent.succeeded` → cobro exitoso.
 *  - `invoice.payment_failed` / `payment_intent.failed` / `.rejected` → cobro fallido.
 *  (https://docs.fintoc.com/reference/types-of-events)
 *
 * CORRELACIÓN por `metadata` que NOSOTROS fijamos al crear el mandato/cobro
 * (`tenant_id`, `suscripcion_id` en el mandato; `periodo_id`, `tenant_id` en el
 * cobro). Defensiva ante campos ausentes: si un evento auto-generado por Fintoc no
 * propaga nuestra metadata, los ids salen `null` y el backend correlaciona por el
 * id externo. Los motivos de error se sanean (sin secretos).
 *
 * TODO(confirmar en sandbox): la forma EXACTA de `data.object` — dónde vive el id
 * del payment method vs. subscription en `checkout_session.finished`, y si la
 * `metadata` del mandato se propaga al objeto del cobro. Por eso la extracción es
 * defensiva y multi-ruta. Confirmar con el primer 200 real antes de habilitar.
 */

/** Evento normalizado del dominio de auto-cobro recurrente. */
export type EventoRecurrenteNormalizado =
  | { tipo: 'mandato_activado'; mandatoExternoId: string; tenantId: string | null; suscripcionId: string | null }
  | { tipo: 'mandato_fallido'; mandatoExternoId: string; tenantId: string | null; suscripcionId: string | null }
  | { tipo: 'cobro_exitoso'; cobroExternoId: string; periodoId: string | null; tenantId: string | null; montoClp: number }
  | { tipo: 'cobro_fallido'; cobroExternoId: string; periodoId: string | null; tenantId: string | null; motivoSaneado: string | null }
  | { tipo: 'ignorado'; razon: string };

function esObjeto(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object';
}

/** Lee un string de una ruta de propiedades anidadas (o null). */
function leerString(obj: Record<string, unknown>, ...ruta: string[]): string | null {
  let actual: unknown = obj;
  for (const clave of ruta) {
    if (!esObjeto(actual)) return null;
    actual = actual[clave];
  }
  return typeof actual === 'string' && actual ? actual : null;
}

/** Extrae un id que puede venir como string o como objeto `{ id }` en una clave. */
function leerIdFlexible(object: Record<string, unknown>, clave: string): string | null {
  const v = object[clave];
  if (typeof v === 'string' && v) return v;
  if (esObjeto(v) && typeof v['id'] === 'string' && v['id']) return v['id'] as string;
  // Variante `<clave>_id`.
  return leerString(object, `${clave}_id`);
}

/** Busca una clave de metadata en el objeto o en su subscription/payment_intent anidado. */
function leerMetadata(object: Record<string, unknown>, clave: string): string | null {
  return (
    leerString(object, 'metadata', clave) ??
    leerString(object, 'subscription', 'metadata', clave) ??
    leerString(object, 'payment_intent', 'metadata', clave) ??
    leerString(object, 'invoice', 'metadata', clave)
  );
}

const EVENTOS_MANDATO_OK = new Set(['checkout_session.finished']);
const EVENTOS_MANDATO_CAIDO = new Set(['subscription.canceled', 'subscription.cancelled', 'mandate.failed']);
const EVENTOS_COBRO_OK = new Set(['invoice.payment_succeeded', 'payment_intent.succeeded']);
const EVENTOS_COBRO_FALLO = new Set([
  'invoice.payment_failed',
  'payment_intent.failed',
  'payment_intent.rejected',
]);

/** Estados de una checkout session que indican enrolamiento fallido (no activado). */
const ESTADOS_SESION_FALLIDA = new Set(['failed', 'rejected', 'expired', 'canceled', 'cancelled']);

/**
 * Normaliza el payload de un webhook recurrente de Fintoc a
 * `EventoRecurrenteNormalizado`. Nunca lanza: cualquier entrada no reconocida cae
 * a `{ tipo: 'ignorado' }` para que el handler responda 200 e ignore.
 */
export function normalizarEventoRecurrente(payload: unknown): EventoRecurrenteNormalizado {
  if (!esObjeto(payload)) return { tipo: 'ignorado', razon: 'payload no es un objeto' };

  const tipo = leerString(payload, 'type');
  if (!tipo) return { tipo: 'ignorado', razon: 'evento sin type' };

  const object =
    esObjeto(payload['data']) && esObjeto((payload['data'] as Record<string, unknown>)['object'])
      ? ((payload['data'] as Record<string, unknown>)['object'] as Record<string, unknown>)
      : {};

  const tenantId = leerMetadata(object, 'tenant_id');
  const suscripcionId = leerMetadata(object, 'suscripcion_id');
  const periodoId = leerMetadata(object, 'periodo_id');

  // -- Mandato -------------------------------------------------------------
  if (EVENTOS_MANDATO_OK.has(tipo)) {
    // El id del mandato = subscription / payment_method creado; fallback al id de
    // la propia sesión (correlación por metadata cubre el resto).
    const mandatoExternoId =
      leerIdFlexible(object, 'subscription') ??
      leerIdFlexible(object, 'payment_method') ??
      leerString(object, 'id') ??
      '';
    if (!mandatoExternoId) return { tipo: 'ignorado', razon: 'checkout_session sin id de mandato' };

    const estadoSesion = leerString(object, 'status');
    if (estadoSesion && ESTADOS_SESION_FALLIDA.has(estadoSesion)) {
      return { tipo: 'mandato_fallido', mandatoExternoId, tenantId, suscripcionId };
    }
    return { tipo: 'mandato_activado', mandatoExternoId, tenantId, suscripcionId };
  }

  if (EVENTOS_MANDATO_CAIDO.has(tipo)) {
    const mandatoExternoId = leerIdFlexible(object, 'subscription') ?? leerString(object, 'id') ?? '';
    if (!mandatoExternoId) return { tipo: 'ignorado', razon: 'evento de mandato sin id' };
    return { tipo: 'mandato_fallido', mandatoExternoId, tenantId, suscripcionId };
  }

  // -- Cobro ---------------------------------------------------------------
  if (EVENTOS_COBRO_OK.has(tipo)) {
    const cobroExternoId =
      leerIdFlexible(object, 'payment_intent') ?? leerString(object, 'id') ?? '';
    if (!cobroExternoId) return { tipo: 'ignorado', razon: 'cobro exitoso sin id' };
    const montoRaw = object['amount'];
    const montoClp = typeof montoRaw === 'number' && Number.isFinite(montoRaw) ? Math.round(montoRaw) : 0;
    return { tipo: 'cobro_exitoso', cobroExternoId, periodoId, tenantId, montoClp };
  }

  if (EVENTOS_COBRO_FALLO.has(tipo)) {
    const cobroExternoId =
      leerIdFlexible(object, 'payment_intent') ?? leerString(object, 'id') ?? '';
    if (!cobroExternoId) return { tipo: 'ignorado', razon: 'cobro fallido sin id' };
    return {
      tipo: 'cobro_fallido',
      cobroExternoId,
      periodoId,
      tenantId,
      motivoSaneado: sanearMotivo(object),
    };
  }

  return { tipo: 'ignorado', razon: `tipo no relevante: ${tipo}` };
}

/**
 * Extrae un motivo de fallo SANEADO (código + mensaje corto de Fintoc), o null.
 * Nunca incluye datos sensibles: solo el error de negocio que Fintoc expone.
 */
function sanearMotivo(object: Record<string, unknown>): string | null {
  const err = object['error'];
  if (esObjeto(err)) {
    const e = err as { message?: unknown; code?: unknown; type?: unknown };
    const codigo = typeof e.code === 'string' ? `[${e.code}]` : undefined;
    const texto = typeof e.message === 'string' ? e.message : typeof e.type === 'string' ? e.type : undefined;
    const partes = [codigo, texto].filter(Boolean);
    if (partes.length > 0) return partes.join(' ');
  }
  // Algunos eventos traen el motivo como string plano (`failure_reason`/`decline_reason`).
  return (
    leerString(object, 'failure_reason') ??
    leerString(object, 'decline_reason') ??
    leerString(object, 'status_detail')
  );
}
