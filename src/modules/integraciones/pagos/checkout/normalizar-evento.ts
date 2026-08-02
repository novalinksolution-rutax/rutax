/**
 * Normalización PURA del webhook de pago de suscripción (Fintoc Payment Links).
 * =============================================================================
 * Traduce el evento crudo de Fintoc a la forma del dominio. Sin I/O, sin
 * secretos. Quien llama DEBE haber validado la firma antes (con el helper
 * compartido `verificarFirmaWebhookFintoc`) — esto solo traduce forma.
 *
 * Eventos que confirman/cierran un pago de link (doc oficial jul 2026,
 * https://docs.fintoc.com/reference/types-of-events):
 *  - `checkout_session.finished`   → el cliente completó el pago (estado final).
 *  - `payment_intent.succeeded`    → el pago finalizó con éxito.
 *  - `payment_intent.failed` / `.rejected` → pago fallido/rechazado.
 *  - `payment_intent.expired` / `checkout_session.expired` → expiró sin pagar.
 *
 * TODO(confirmar en sandbox de Fintoc): la forma EXACTA de `data.object` para
 * `checkout_session.finished` (dónde vive el id del payment_link y si `metadata`
 * del link se propaga al objeto del evento). Por eso la correlación es DEFENSIVA:
 * se intenta por `metadata.periodo_id` (que nosotros fijamos) y, en su defecto,
 * por el id del payment_link. Confirmar el primer 200 real antes de habilitar.
 */

/** Estado normalizado del pago tras el evento. */
export type EstadoPagoSuscripcion = 'pagado' | 'fallido' | 'expirado';

export interface EventoPagoSuscripcion {
  /** Id del EVENTO en Fintoc — barrera de idempotencia del webhook. */
  eventoExternoId: string;
  /** Id del payment_link (si el payload lo trae). Correlación de respaldo. */
  linkExternoId: string | null;
  /** `periodo_id` leído de la metadata que fijamos al crear el link. Correlación primaria. */
  periodoId: string | null;
  /** Estado normalizado. */
  estado: EstadoPagoSuscripcion;
  /** Monto informado por el evento, si viene (CLP entero). */
  montoClp: number | null;
  /** Subconjunto seguro del payload para auditoría — sin PII ni secretos. */
  payloadSanitizado: Record<string, unknown>;
}

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

/** Extrae el id del payment_link, que puede venir como string o como objeto {id}. */
function leerLinkId(object: Record<string, unknown>): string | null {
  const pl = object['payment_link'];
  if (typeof pl === 'string' && pl) return pl;
  if (esObjeto(pl) && typeof pl['id'] === 'string') return pl['id'] as string;
  // Algunos eventos referencian el link por `payment_link_id`.
  return leerString(object, 'payment_link_id');
}

/** Busca `metadata.periodo_id` en el objeto o en su payment_link anidado. */
function leerPeriodoId(object: Record<string, unknown>): string | null {
  return (
    leerString(object, 'metadata', 'periodo_id') ??
    leerString(object, 'payment_link', 'metadata', 'periodo_id')
  );
}

const EVENTOS_PAGADO = new Set(['checkout_session.finished', 'payment_intent.succeeded']);
const EVENTOS_FALLIDO = new Set(['payment_intent.failed', 'payment_intent.rejected']);
const EVENTOS_EXPIRADO = new Set(['payment_intent.expired', 'checkout_session.expired']);

/**
 * Normaliza el payload de un webhook de Fintoc a `EventoPagoSuscripcion`, o
 * `null` si el tipo de evento no es relevante para el cobro de suscripción.
 */
export function normalizarEventoPagoSuscripcion(payload: unknown): EventoPagoSuscripcion | null {
  if (!esObjeto(payload)) return null;

  const tipo = leerString(payload, 'type');
  const eventoExternoId = leerString(payload, 'id');
  if (!tipo || !eventoExternoId) return null;

  let estado: EstadoPagoSuscripcion;
  if (EVENTOS_PAGADO.has(tipo)) estado = 'pagado';
  else if (EVENTOS_FALLIDO.has(tipo)) estado = 'fallido';
  else if (EVENTOS_EXPIRADO.has(tipo)) estado = 'expirado';
  else return null; // evento no relevante → el handler responde 200 e ignora

  const object = esObjeto(payload['data']) && esObjeto((payload['data'] as Record<string, unknown>)['object'])
    ? ((payload['data'] as Record<string, unknown>)['object'] as Record<string, unknown>)
    : {};

  const linkExternoId = leerLinkId(object);
  const periodoId = leerPeriodoId(object);
  const montoRaw = object['amount'];
  const montoClp = typeof montoRaw === 'number' && Number.isFinite(montoRaw) ? Math.round(montoRaw) : null;

  return {
    eventoExternoId,
    linkExternoId,
    periodoId,
    estado,
    montoClp,
    // Solo metadatos de negocio — nada de PII del pagador ni secretos.
    payloadSanitizado: {
      tipo,
      evento_externo_id: eventoExternoId,
      link_externo_id: linkExternoId,
      periodo_id: periodoId,
      estado,
      monto_clp: montoClp,
    },
  };
}
