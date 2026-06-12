/**
 * Adaptador de Fintoc para el puerto de conciliación de pagos (cobranza).
 * =============================================================================
 *
 * PROPÓSITO: leer los movimientos bancarios de la cuenta conectada del courier
 * (Fintoc Movements API) y validar la firma de los webhooks de Fintoc, todo
 * detrás del puerto `PuertoConciliacionPagos`. El núcleo (`dinero`) nunca ve un
 * `Movement` crudo de Fintoc — solo el `MovimientoPago` normalizado.
 *
 * ---------------------------------------------------------------------------
 * CONTRATO REAL VERIFICADO (junio 2026)
 * ---------------------------------------------------------------------------
 * Movimientos — VALIDADO EN VIVO contra la API real en modo prueba
 * (`scripts/validacion-pagos-fintoc.mjs`, ver `docs/arquitectura/cobranza-fintoc.md`
 * §5b). Hechos confirmados en vivo:
 *  - Base: `https://api.fintoc.com/v1`.
 *  - Auth: la secret key de la ORGANIZACIÓN va DIRECTA en el header
 *    `Authorization` (SIN `Bearer`). → header `Authorization: <secret_key>`.
 *  - `GET /v1/accounts/{account_id}/movements?link_token=...&per_page=N` lista
 *    movimientos. `Movement`: `id`, `description`, `amount` (entero CLP,
 *    positivo = entra), `currency`, `post_date`, `transaction_date`, `type`
 *    (`'transfer' | 'other'`), `sender_account` (NULLABLE — solo ~81/300 lo
 *    traen), `recipient_account`, `comment`, `reference_id`, `transfer_id`,
 *    `document_number`, `pending`, `status`.
 *  - `sender_account` (cuando viene): `holder_id` = RUT SIN puntos ni guion,
 *    `holder_name`, `number`, `institution`.
 *
 * DISTINCIÓN DE SECRETOS (clave, no confundir):
 *  - La **secret key de la organización** (`sk_test_…`/`sk_live_…`) es la
 *    credencial de AUTENTICACIÓN: va en el header `Authorization`. Es una sola
 *    para toda la org del fundador (no por-tenant) → la resuelve la fábrica
 *    desde env/config y se inyecta en el constructor.
 *  - El **`link_token`** identifica A QUÉ CUENTA del courier consultar: va como
 *    query param `link_token=...`. ES por-tenant (cada courier conecta su banco)
 *    → llega ya descifrado en `listarMovimientos({ linkToken })`. NO autentica.
 *
 * Firma de webhook — VERIFICADA CONTRA DOC OFICIAL (no observable en sandbox):
 *  Fuente: https://docs.fintoc.com/docs/webhooks-validating (y el SDK oficial
 *  `fintoc-com/fintoc-node`, clase `WebhookSignature`). Esquema:
 *   - Header `Fintoc-Signature`, formato `t=<timestamp>,v1=<hmac_hex>`.
 *   - Mensaje firmado = `"<timestamp>.<raw_body>"` (timestamp + '.' + cuerpo
 *     CRUDO de la request, NO el JSON re-serializado).
 *   - HMAC-SHA256 con el secreto del Webhook Endpoint; digest en hex.
 *   - Tolerancia anti-replay sobre el timestamp (default 300 s en el SDK).
 *  → A diferencia de ML marketplace (que NO firma), aquí la validación es
 *    obligatoria. NO es el HMAC de Mercado Pago (otro esquema): este firma
 *    `timestamp.raw_body` y publica `t=,v1=` en `Fintoc-Signature`.
 *
 * REGLAS DE DEPENDENCIAS (adaptador = hoja del grafo):
 *  - Solo importa de `../tipos`, `../puerto`, `../errores` y `../../resiliencia`
 *    (utilidad compartida de backoff) + `node:crypto` (HMAC).
 *  - NO importa de `dinero`, `operacion` ni ningún módulo de negocio.
 *
 * SEGURIDAD:
 *  - La secret key de la org y el `link_token` NUNCA se loguean, no se incluyen
 *    en errores ni se exponen en resultados. El `link_token` viaja solo en el
 *    query string construido en el último momento; jamás aparece en un mensaje
 *    de error (las URLs en errores se reportan SIN query string).
 *  - El secreto de webhook nunca se incluye en `ErrorFirmaWebhookInvalida`.
 *  - La comparación de firmas es de tiempo constante (`timingSafeEqual`).
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  ListarMovimientosArgs,
  PuertoConciliacionPagos,
  ValidarFirmaWebhookArgs,
} from "../puerto";
import { ErrorPagosProveedor } from "../errores";
import { normalizarRut, type MovimientoPago, type TipoMovimientoPago } from "../tipos";
import { reintentarConBackoff, type ErrorReintentable } from "../../resiliencia";

/** Base de la API de Fintoc (verificada en vivo). */
export const FINTOC_BASE_URL = "https://api.fintoc.com/v1";

/** Tolerancia anti-replay del timestamp del webhook, en segundos (default SDK). */
const TOLERANCIA_FIRMA_SEGUNDOS = 300;

// ---------------------------------------------------------------------------
// Forma (parcial) del Movement de Fintoc — verificada en vivo. Interna: nunca
// cruza la frontera del adaptador (el núcleo solo ve `MovimientoPago`).
// ---------------------------------------------------------------------------

interface FintocSenderAccount {
  /** RUT del titular, SIN puntos ni guion (p. ej. "745931278"). NULLABLE. */
  holder_id?: string | null;
  holder_name?: string | null;
  number?: string | null;
  institution?: { id?: string; name?: string } | string | null;
}

interface FintocMovement {
  id: string;
  description?: string | null;
  /** Entero CLP. Positivo = entra dinero a la cuenta del courier. */
  amount: number;
  currency?: string | null;
  post_date?: string | null;
  transaction_date?: string | null;
  type?: string | null; // 'transfer' | 'other' | …
  sender_account?: FintocSenderAccount | null;
  recipient_account?: unknown;
  comment?: string | null;
  reference_id?: string | null;
  transfer_id?: string | null;
  document_number?: string | null;
  pending?: boolean | null;
  status?: string | null;
}

// ---------------------------------------------------------------------------
// Error HTTP de Fintoc — clasifica reintentables (429/5xx) igual que Openfactura.
// ---------------------------------------------------------------------------

/**
 * Error de transporte/HTTP contra Fintoc. Marca como `reintentable` los 429
 * (límite de tasa) y 5xx (transitorios); los 4xx restantes son definitivos.
 * `mensajeProveedor` se asume YA saneado (sin secret key ni link_token).
 */
class ErrorHttpFintoc extends Error implements Partial<ErrorReintentable> {
  readonly status: number;
  readonly reintentable?: true;
  readonly retryAfterMs?: number;
  readonly mensajeProveedor?: string;

  constructor(
    mensaje: string,
    status: number,
    opts?: { retryAfterMs?: number; mensajeProveedor?: string },
  ) {
    super(mensaje);
    this.name = "ErrorHttpFintoc";
    this.status = status;
    if (opts?.mensajeProveedor) this.mensajeProveedor = opts.mensajeProveedor;
    if (status === 429 || status >= 500) {
      this.reintentable = true;
      if (opts?.retryAfterMs !== undefined) this.retryAfterMs = opts.retryAfterMs;
    }
  }
}

/**
 * Extrae un mensaje operativo SANEADO del cuerpo de error de Fintoc, cuyo shape
 * típico es `{ error: { type, message, code, doc_url } }`. Solo toma texto de
 * negocio (mensaje + código) — nunca el cuerpo crudo completo ni headers. La
 * secret key y el link_token jamás viajan en el body. Devuelve `null` si no
 * tiene esa forma.
 */
function extraerErrorFintoc(cuerpo: unknown): string | null {
  if (!cuerpo || typeof cuerpo !== "object" || !("error" in cuerpo)) return null;
  const err = (cuerpo as { error?: unknown }).error;
  if (!err || typeof err !== "object") return null;
  const e = err as { message?: string; code?: string; type?: string };
  const partes = [e.code ? `[${e.code}]` : undefined, e.message ?? e.type].filter(Boolean);
  return partes.length > 0 ? partes.join(" ") : null;
}

// ---------------------------------------------------------------------------
// Adaptador concreto
// ---------------------------------------------------------------------------

export class FintocAdapter implements PuertoConciliacionPagos {
  /**
   * Secret key de la ORGANIZACIÓN (no el link_token) — credencial de auth.
   * La resuelve la fábrica desde env/config; NUNCA se loguea ni se expone.
   */
  private readonly secretKeyOrg: string | null;
  private readonly baseUrl: string;

  /**
   * @param secretKeyOrg secret key de la org Fintoc (`sk_…`) para autenticar.
   *   `null` solo en escenarios donde el adaptador se usa exclusivamente para
   *   validar firmas de webhook (que no requieren llamar a Fintoc); cualquier
   *   método que sí golpee la API lanza si es `null`.
   * @param baseUrl host de Fintoc; default producción. Inyectable para tests.
   */
  constructor(secretKeyOrg: string | null, baseUrl: string = FINTOC_BASE_URL) {
    this.secretKeyOrg = secretKeyOrg;
    this.baseUrl = baseUrl;
  }

  // -------------------------------------------------------------------------
  // 1. Listar movimientos de la cuenta conectada del courier.
  // -------------------------------------------------------------------------

  async listarMovimientos(args: ListarMovimientosArgs): Promise<MovimientoPago[]> {
    const secretKey = this.exigirSecretKey();

    // `link_token` identifica la cuenta; primero recuperamos el Link para
    // obtener el `account_id`, luego listamos sus movimientos. Ambas llamadas
    // pasan el `link_token` como query param (verificado en vivo). El token va
    // en la URL SOLO al construir el fetch; nunca en mensajes de error.
    const link = await this.peticion<{ accounts?: Array<{ id: string }> }>(
      `/links/${encodeURIComponent(args.linkToken)}`,
      secretKey,
      // Etiqueta de ruta SANEADA para errores — sin el token real.
      "/links/{link_token}",
    );

    const cuentas = Array.isArray(link.accounts) ? link.accounts : [];
    if (cuentas.length === 0) return [];

    const desdeIso = this.aFechaIso(args.desde);
    const movimientos: MovimientoPago[] = [];

    for (const cuenta of cuentas) {
      const qs = new URLSearchParams({
        link_token: args.linkToken,
        per_page: "300",
        // Fintoc filtra por fecha con `since` (ISO date); acota la ventana de
        // backfill al reconectar y evita traer el historial completo.
        since: desdeIso,
      });
      const ruta = `/accounts/${encodeURIComponent(cuenta.id)}/movements?${qs.toString()}`;
      const rutaSaneada = `/accounts/${cuenta.id}/movements`;

      const lista = await this.peticion<FintocMovement[] | { data?: FintocMovement[] }>(
        ruta,
        secretKey,
        rutaSaneada,
      );
      const crudos = Array.isArray(lista) ? lista : (lista.data ?? []);
      for (const m of crudos) movimientos.push(this.mapearMovimiento(m));
    }

    return movimientos;
  }

  // -------------------------------------------------------------------------
  // 2. Validar la firma `Fintoc-Signature` del webhook.
  //    Fuente del esquema: https://docs.fintoc.com/docs/webhooks-validating
  // -------------------------------------------------------------------------

  validarFirmaWebhook(args: ValidarFirmaWebhookArgs): boolean {
    const partes = this.parsearHeaderFirma(args.firmaHeader);
    if (!partes) return false;
    const { timestamp, firmaRecibida } = partes;

    // Anti-replay: el timestamp debe estar dentro de la tolerancia.
    const ahoraSeg = Math.floor(Date.now() / 1000);
    if (Math.abs(ahoraSeg - timestamp) > TOLERANCIA_FIRMA_SEGUNDOS) {
      return false;
    }

    // Mensaje firmado = "<timestamp>.<raw_body>" (verificado contra doc oficial).
    const mensaje = `${timestamp}.${args.cuerpoCrudo}`;
    const firmaEsperada = createHmac("sha256", args.secretoWebhook)
      .update(mensaje, "utf8")
      .digest("hex");

    return this.comparacionTiempoConstante(firmaEsperada, firmaRecibida);
  }

  // -------------------------------------------------------------------------
  // 3. Normalizar el payload del evento de transferencia entrante.
  // -------------------------------------------------------------------------

  normalizarEventoTransferencia(payloadWebhook: unknown): MovimientoPago {
    // El evento de Fintoc es un envelope `{ id, type, mode, data: {...} }` donde
    // `data` es el recurso (la transferencia/movimiento). Aceptamos tanto el
    // envelope como el objeto crudo, por robustez ante variaciones del payload.
    let recurso: unknown = payloadWebhook;
    if (
      payloadWebhook &&
      typeof payloadWebhook === "object" &&
      "data" in payloadWebhook &&
      (payloadWebhook as { data?: unknown }).data &&
      typeof (payloadWebhook as { data?: unknown }).data === "object"
    ) {
      recurso = (payloadWebhook as { data: unknown }).data;
    }

    if (!recurso || typeof recurso !== "object" || typeof (recurso as { id?: unknown }).id !== "string") {
      throw new ErrorPagosProveedor(
        422,
        "evento de webhook sin objeto de movimiento reconocible (falta `data.id`)",
      );
    }

    return this.mapearMovimiento(recurso as FintocMovement);
  }

  // -------------------------------------------------------------------------
  // Helpers privados
  // -------------------------------------------------------------------------

  /**
   * Mapea un `Movement` crudo de Fintoc al `MovimientoPago` del dominio.
   * Incluye la normalización de RUT y `type: 'transfer' → 'transferencia'`.
   * Es la frontera: a partir de aquí el núcleo nunca ve la forma de Fintoc.
   */
  private mapearMovimiento(m: FintocMovement): MovimientoPago {
    const tipo: TipoMovimientoPago = m.type === "transfer" ? "transferencia" : "otro";
    const montoClp = typeof m.amount === "number" ? m.amount : 0;

    // `sender_account` es NULLABLE (~81/300 movimientos lo traen). Si no vino,
    // contraparte queda en null — NO se infiere (el matching cae a sin_atribuir).
    const sender = m.sender_account ?? null;
    const contraparteRutNormalizado = sender ? normalizarRut(sender.holder_id) : null;
    const contraparteNombre = sender?.holder_name ?? null;

    // Fecha del movimiento en ISO date. Preferimos `post_date`; si no, la fecha
    // de transacción. Si ninguna vino (sandbox a veces no las puebla), cae a
    // la fecha actual en ISO date (no inventa un día arbitrario distinto).
    const fechaMovimiento = this.aFechaIso(
      m.post_date ?? m.transaction_date ?? new Date(),
    );

    return {
      movimientoExternoId: m.id,
      montoClp,
      esEntrante: montoClp > 0,
      tipo,
      fechaMovimiento,
      contraparteRutNormalizado,
      contraparteNombre,
      glosa: m.comment ?? m.description ?? null,
      estado: m.status ?? "desconocido",
      // El payload crudo se preserva para auditoría/reproceso. No contiene
      // secretos (el link_token y el secreto de webhook no viajan en un Movement).
      payloadCrudo: m as unknown as Record<string, unknown>,
    };
  }

  /**
   * Parsea el header `Fintoc-Signature` (`t=<ts>,v1=<hex>`). Devuelve `null` si
   * el formato no calza (header ausente, sin `t` o sin `v1`, timestamp no
   * numérico) — el llamador trata `null`/`false` como firma inválida.
   */
  private parsearHeaderFirma(
    header: string,
  ): { timestamp: number; firmaRecibida: string } | null {
    if (!header || typeof header !== "string") return null;
    let timestamp: number | null = null;
    let firmaRecibida: string | null = null;

    for (const segmento of header.split(",")) {
      const i = segmento.indexOf("=");
      if (i === -1) continue;
      const clave = segmento.slice(0, i).trim();
      const valor = segmento.slice(i + 1).trim();
      if (clave === "t") {
        const n = Number(valor);
        if (Number.isFinite(n)) timestamp = n;
      } else if (clave === "v1") {
        firmaRecibida = valor;
      }
    }

    if (timestamp === null || !firmaRecibida) return null;
    return { timestamp, firmaRecibida };
  }

  /**
   * Comparación de hex de tiempo constante. Si las longitudes difieren,
   * `timingSafeEqual` lanzaría — se cubre devolviendo `false` (longitudes
   * distintas ⇒ firmas distintas). Nunca se filtra la firma esperada vía timing.
   */
  private comparacionTiempoConstante(esperada: string, recibida: string): boolean {
    const a = Buffer.from(esperada, "utf8");
    const b = Buffer.from(recibida, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  /** Normaliza una fecha (Date o string ISO/fecha de Fintoc) a `YYYY-MM-DD`. */
  private aFechaIso(valor: Date | string): string {
    const d = valor instanceof Date ? valor : new Date(valor);
    if (Number.isNaN(d.getTime())) {
      // Entrada no parseable → hoy (defensivo; el matching no depende de la hora).
      return new Date().toISOString().slice(0, 10);
    }
    return d.toISOString().slice(0, 10);
  }

  /** Lanza si no hay secret key de org configurada (falla rápido, sin exponerla). */
  private exigirSecretKey(): string {
    if (!this.secretKeyOrg) {
      throw new ErrorPagosProveedor(
        401,
        "falta la secret key de la organización Fintoc (FINTOC_SECRET_KEY) — " +
          "configúrala vía el gestor de secretos del despliegue",
      );
    }
    return this.secretKeyOrg;
  }

  /**
   * Cliente HTTP de bajo nivel contra Fintoc, con backoff/reintentos
   * compartidos (`reintentarConBackoff`) y clasificación 429/5xx → reintentable.
   *
   * La secret key va SOLO en el header `Authorization` (directa, sin `Bearer` —
   * verificado en vivo). El `link_token` puede ir en `ruta` (query param), pero
   * `rutaSaneada` es la etiqueta SIN token que se usa en los mensajes de error.
   */
  private async peticion<T>(ruta: string, secretKey: string, rutaSaneada: string): Promise<T> {
    return reintentarConBackoff(async () => {
      const respuesta = await fetch(`${this.baseUrl}${ruta}`, {
        method: "GET",
        headers: {
          // Auth verificada en vivo: secret key DIRECTA, sin prefijo "Bearer".
          Authorization: secretKey,
          accept: "application/json",
        },
      });

      if (!respuesta.ok) {
        const retryAfterMs = this.leerRetryAfterMs(respuesta.headers);
        const cuerpoError = await respuesta.json().catch(() => null);
        const mensajeProveedor = extraerErrorFintoc(cuerpoError) ?? undefined;
        // El mensaje del error usa la ruta SANEADA (sin el link_token).
        throw new ErrorHttpFintoc(
          `Fintoc respondió ${respuesta.status} para GET ${rutaSaneada}`,
          respuesta.status,
          { retryAfterMs, mensajeProveedor },
        );
      }

      return (await respuesta.json()) as T;
    }).catch((error: unknown) => {
      if (error instanceof ErrorHttpFintoc) {
        const sufijo = error.mensajeProveedor
          ? `: ${error.mensajeProveedor}`
          : " (sin detalle del proveedor)";
        throw new ErrorPagosProveedor(error.status, `Fintoc${sufijo}`);
      }
      throw error;
    });
  }

  /** Lee `Retry-After` (segundos o fecha HTTP) → ms, para respetar al proveedor. */
  private leerRetryAfterMs(headers: Headers): number | undefined {
    const valor = headers.get("retry-after");
    if (!valor) return undefined;
    const segundos = Number(valor);
    if (!Number.isNaN(segundos)) return segundos * 1000;
    const fecha = Date.parse(valor);
    if (!Number.isNaN(fecha)) return Math.max(0, fecha - Date.now());
    return undefined;
  }
}
