/**
 * Parsing del webhook de PAYOUT SALIENTE de Fintoc (`transfer.outbound.*`).
 * =============================================================================
 *
 * Confirmación instantánea de payouts a conductores: hoy los payouts solo se
 * confirman por sondeo horario; este webhook los confirma al instante. La forma
 * CRUDA de Fintoc vive y muere AQUÍ (dentro del adaptador) — el núcleo (`dinero`)
 * solo ve los tipos de dominio de `../puerto-payout`.
 *
 * ---------------------------------------------------------------------------
 * VERIFICADO CONTRA LA DOC OFICIAL DE FINTOC (jul 2026)
 * ---------------------------------------------------------------------------
 * Fuentes (índice `https://docs.fintoc.com/llms.txt`):
 *  - https://docs.fintoc.com/reference/types-of-events.md
 *  - https://docs.fintoc.com/docs/outbound-transfers.md
 *  - https://docs.fintoc.com/reference/transfer-object.md
 *  - https://docs.fintoc.com/docs/webhooks-validating.md
 *
 * Hechos confirmados y su consecuencia de diseño:
 *  - Eventos de transferencia SALIENTE: `transfer.outbound.succeeded`,
 *    `transfer.outbound.failed` y — AQUÍ ESTÁ LA INCONSISTENCIA DE LA DOC — el
 *    tercero aparece como `transfer.outbound.returned` en `types-of-events` y como
 *    `transfer.outbound.rejected` en `outbound-transfers`. Por eso NO conmutamos
 *    por el `type` del evento: conmutamos por `data.status`, que es estable.
 *  - `status` del transfer (7 valores, transfer-object.md): `pending`,
 *    `succeeded`, `failed`, `rejected`, `returned`, `return_pending`,
 *    `reject_failed`. `rejected` (declinado por la institución, final) y
 *    `returned` (aceptado y luego revertido) se tratan como el MISMO estado
 *    interno `rechazado` (ambos = el payout no quedó firme). `reject_failed` y
 *    cualquier valor no listado → `desconocido` (se registra, no dispara acción).
 *  - `return_reason`: `null` salvo cuando `status === 'returned'` (código de
 *    retorno, p. ej. SPEI). No es dato sensible; se sanea igual por prudencia.
 *  - `receipt_url`: URL del comprobante, si está disponible.
 *  - Envelope del evento: `{ id: 'evt_...', type, mode, created_at, data }` donde
 *    `data` es el recurso (el transfer). Se acepta también `data.object` por
 *    robustez ante variaciones del payload documentadas.
 *  - `counterparty` (datos bancarios del conductor) EXISTE en el transfer pero
 *    NUNCA se persiste: el sanitizador lo excluye explícitamente.
 *
 * REGLAS DE DEPENDENCIAS (hoja del grafo): solo importa del puerto y del módulo
 * compartido de firma. NO importa de `dinero` ni de ningún módulo de negocio.
 */

import type {
  EstadoExternoEventoPayout,
  EventoWebhookPayout,
} from "../puerto-payout";
import { verificarFirmaWebhookFintoc } from "../../firma-webhook-fintoc";

/** Prefijo de los eventos de transferencia saliente en Fintoc. */
const PREFIJO_EVENTO_OUTBOUND = "transfer.outbound.";

/** Tope defensivo de longitud para el motivo saneado (evita blobs en la BD). */
const MAX_LARGO_MOTIVO = 500;

// ---------------------------------------------------------------------------
// Forma (parcial) del recurso Transfer de Fintoc — INTERNA, nunca cruza la
// frontera del adaptador. `counterparty` se declara para documentar que EXISTE
// en el crudo y que lo excluimos a propósito; jamás se lee su contenido.
// ---------------------------------------------------------------------------

interface FintocTransferWebhook {
  id?: unknown;
  status?: unknown;
  currency?: unknown;
  amount?: unknown;
  return_reason?: unknown;
  receipt_url?: unknown;
  /** Datos bancarios del conductor. NUNCA se persiste (se documenta y se ignora). */
  counterparty?: unknown;
}

// ---------------------------------------------------------------------------
// 1. Verificación de firma — standalone, SIN instancia de tenant/config.
//    El webhook de payout usa un secreto de ORG (no por-tenant): esto valida
//    ANTES de conocer el tenant. Reusa el core compartido (no duplica la firma).
// ---------------------------------------------------------------------------

export interface ValidarFirmaWebhookPayoutInput {
  /** Cuerpo CRUDO de la request (raw body, string UTF-8). */
  cuerpoCrudo: string;
  /** Valor del header `Fintoc-Signature` (`t=<ts>,v1=<hex>`). */
  firma: string;
  /** Secreto del Webhook Endpoint de PAYOUT (org-level), YA DESCIFRADO. */
  secreto: string;
}

/**
 * Verifica la firma `Fintoc-Signature` del webhook de payout saliente sobre
 * `<timestamp>.<cuerpoCrudo>` con HMAC-SHA256. Standalone: no necesita una
 * instancia del adaptador ni el tenant — el backend (fase 3) la llama con el
 * secreto de ORG antes de resolver a qué payout/tenant pertenece el evento.
 * `true` sii la firma calza y el timestamp está dentro de la tolerancia.
 */
export function validarFirmaWebhookPayout(input: ValidarFirmaWebhookPayoutInput): boolean {
  return verificarFirmaWebhookFintoc({
    cuerpoCrudo: input.cuerpoCrudo,
    firmaHeader: input.firma,
    secreto: input.secreto,
  });
}

// ---------------------------------------------------------------------------
// 2. Mapeo de `data.status` de Fintoc → estado interno del dominio.
//    Conmuta por STATUS (estable), NO por el `type` del evento (inconsistente).
// ---------------------------------------------------------------------------

/**
 * Traduce el `status` crudo del transfer de Fintoc al `EstadoExternoEventoPayout`
 * del dominio. `rejected` y `returned` colapsan al mismo `rechazado` (la doc los
 * usa de forma intercambiable para el mismo evento). Cualquier status no
 * reconocido (incl. `reject_failed`, `null`, no-string) → `desconocido`.
 */
export function mapearStatusFintocPayout(status: unknown): EstadoExternoEventoPayout {
  switch (status) {
    case "succeeded":
      return "confirmado";
    case "failed":
      return "fallido";
    case "rejected":
    case "returned":
      // Inconsistencia de la doc: ambos representan "el payout no quedó firme".
      return "rechazado";
    case "pending":
    case "return_pending":
      return "pendiente";
    default:
      // `reject_failed` y cualquier valor futuro/desconocido: registrar sin actuar.
      return "desconocido";
  }
}

// ---------------------------------------------------------------------------
// 3. Sanitizador puro del payload — SOLO campos no sensibles.
// ---------------------------------------------------------------------------

/**
 * Produce el subconjunto MÍNIMO y NO SENSIBLE del payload que el backend
 * persistirá en `dinero.eventos_payout_externos.payload_sanitizado`: SOLO
 * `{ eventoExternoId, transferExternoId, status, currency, amount, returnReason,
 * receiptUrl }`.
 *
 * NUNCA incluye `counterparty` (datos bancarios del conductor) ni ningún
 * token/secreto — aunque vengan en el crudo. `status` es el valor CRUDO de
 * Fintoc (para trazabilidad de auditoría), no el estado ya mapeado.
 *
 * Devuelve `null` si el payload no tiene la forma esperada de un evento de
 * transferencia saliente (sin id de evento o sin id de transfer).
 */
export function sanitizarPayloadEventoPayout(
  payloadCrudo: unknown,
): Record<string, unknown> | null {
  const parseado = extraerEventoOutbound(payloadCrudo);
  if (!parseado) return null;
  const { eventoExternoId, transferExternoId, recurso } = parseado;

  return {
    eventoExternoId,
    transferExternoId,
    status: aStringNullable(recurso.status),
    currency: aStringNullable(recurso.currency),
    amount: typeof recurso.amount === "number" ? recurso.amount : null,
    returnReason: sanearMotivo(recurso.return_reason),
    receiptUrl: aStringNullable(recurso.receipt_url),
  };
}

// ---------------------------------------------------------------------------
// 4. Normalizador puro: payload crudo → EventoWebhookPayout del dominio.
// ---------------------------------------------------------------------------

/**
 * Normaliza el payload crudo de un evento `transfer.outbound.*` de Fintoc al
 * `EventoWebhookPayout` del dominio, o `null` si el payload no calza (no es un
 * evento de transferencia saliente, o le falta el id de evento/transfer). El
 * caller decide qué hacer con `null` (típicamente ignorar con 200).
 */
export function normalizarEventoWebhookPayoutFintoc(
  payloadCrudo: unknown,
): EventoWebhookPayout | null {
  const parseado = extraerEventoOutbound(payloadCrudo);
  if (!parseado) return null;
  const { eventoExternoId, transferExternoId, recurso } = parseado;

  return {
    eventoExternoId,
    transferExternoId,
    estadoExterno: mapearStatusFintocPayout(recurso.status),
    motivo: sanearMotivo(recurso.return_reason),
    comprobanteRef: aStringNullable(recurso.receipt_url),
    // El subconjunto seguro a persistir; recomputado desde el mismo crudo.
    payloadSanitizado: sanitizarPayloadEventoPayout(payloadCrudo) ?? {},
  };
}

// ---------------------------------------------------------------------------
// Helpers privados de parsing
// ---------------------------------------------------------------------------

interface EventoOutboundParseado {
  eventoExternoId: string;
  transferExternoId: string;
  recurso: FintocTransferWebhook;
}

/**
 * Valida que el crudo sea un evento `transfer.outbound.*` y extrae el id de
 * evento (`evt_...` del envelope), el recurso transfer y su id (`tr_...`).
 * Devuelve `null` si no es un evento de transferencia saliente reconocible.
 *
 * Robusto al shape: acepta `data` directo o `data.object` como recurso. Filtra
 * por el PREFIJO del `type` (identifica la familia del evento); el ESTADO se
 * mapea aparte desde `data.status` (no del `type`, por la inconsistencia).
 */
function extraerEventoOutbound(payloadCrudo: unknown): EventoOutboundParseado | null {
  if (!esObjeto(payloadCrudo)) return null;
  const envelope = payloadCrudo as Record<string, unknown>;

  // Id del evento (barrera de idempotencia). Debe ser un string no vacío.
  const eventoExternoId = aStringNoVacio(envelope.id);
  if (!eventoExternoId) return null;

  // Solo eventos de transferencia SALIENTE. Si `type` viene y no calza el
  // prefijo, no es nuestro evento (p. ej. inbound, link, etc.) → null.
  const tipo = envelope.type;
  if (typeof tipo !== "string" || !tipo.startsWith(PREFIJO_EVENTO_OUTBOUND)) {
    return null;
  }

  // Recurso: `data.object` si viene, si no `data` directo (robustez de shape).
  const data = esObjeto(envelope.data) ? (envelope.data as Record<string, unknown>) : null;
  if (!data) return null;
  const recurso = esObjeto(data.object) ? (data.object as Record<string, unknown>) : data;

  const transferExternoId = aStringNoVacio((recurso as FintocTransferWebhook).id);
  if (!transferExternoId) return null;

  return {
    eventoExternoId,
    transferExternoId,
    recurso: recurso as FintocTransferWebhook,
  };
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null;
}

function aStringNoVacio(valor: unknown): string | null {
  return typeof valor === "string" && valor.length > 0 ? valor : null;
}

function aStringNullable(valor: unknown): string | null {
  return typeof valor === "string" && valor.length > 0 ? valor : null;
}

/**
 * Sanea `return_reason`: si es string, lo recorta y acota a `MAX_LARGO_MOTIVO`;
 * cualquier otra cosa → `null`. Es un código/texto de retorno, no PII, pero se
 * acota por prudencia (evita blobs y entradas no-string en la columna).
 */
function sanearMotivo(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const limpio = valor.trim();
  if (limpio.length === 0) return null;
  return limpio.slice(0, MAX_LARGO_MOTIVO);
}
