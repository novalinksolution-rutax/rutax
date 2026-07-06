/**
 * Adaptador FINTOC de payout SALIENTE (Fintoc Transfers — open banking).
 * =============================================================================
 *
 * Es el código de MAYOR RIESGO del proyecto: mueve dinero real. Por eso vive
 * aislado tras `PuertoPayout`, con idempotencia determinística y la credencial
 * fuera de todo log/error/URL.
 *
 * ---------------------------------------------------------------------------
 * CONTRATO VERIFICADO CONTRA LA DOC OFICIAL DE FINTOC (junio 2026)
 * ---------------------------------------------------------------------------
 * Fuentes (índice `https://docs.fintoc.com/llms.txt`):
 *  - https://docs.fintoc.com/reference/create-transfer-outbound.md
 *  - https://docs.fintoc.com/reference/idempotent-requests.md
 *  - https://docs.fintoc.com/reference/transfer-object.md
 *
 * Hechos confirmados en la doc:
 *  - Crear transferencia SALIENTE: `POST https://api.fintoc.com/v2/transfers`
 *    (¡v2!, y el recurso saliente se llama "transfer", no "payout"; "payout" es
 *    otro recurso del flujo de payment-initiation). El esqueleto deja `baseUrl`
 *    inyectable para apuntar a v2.
 *  - Auth: header `Authorization` con la secret key de la organización. Además
 *    Fintoc exige `Fintoc-JWS-Signature` para firmar el cuerpo (seguridad de
 *    transferencias salientes). YA IMPLEMENTADO (ver `firmarCuerpo`): JWS
 *    DESACOPLADA (detached) con RS256 sobre el cuerpo JSON EXACTO que se envía.
 *
 * ---------------------------------------------------------------------------
 * FIRMA JWS DE TRANSFERENCIAS SALIENTES (verificado contra la doc, junio 2026)
 * ---------------------------------------------------------------------------
 * Fuentes:
 *  - https://docs.fintoc.com/docs/setting-up-jws-keys
 *  - https://docs.fintoc.com/docs/outbound-transfers
 *
 * Hechos confirmados:
 *  - El courier genera un par RSA 2048 (`openssl genrsa 2048`) y SUBE la clave
 *    PÚBLICA al dashboard de Fintoc (API Keys → "Add JWS Key"). La clave PRIVADA
 *    (PEM) la guarda el courier y la usamos para firmar; va cifrada en
 *    `identidad.secretos_cifrados` (la resuelve la fábrica, igual que la cuenta
 *    origen) y NUNCA se loguea ni entra en errores/URLs.
 *  - Algoritmo: RS256 (RSASSA-PKCS1-v1_5 sobre SHA-256) → `crypto` nativo con
 *    `createSign('RSA-SHA256')`. Sin librerías externas.
 *  - Header protegido JWS: { alg:"RS256", nonce:<random>, ts:<unix>,
 *    crit:["ts","nonce"] }. NO lleva `kid` (Fintoc resuelve la clave por la org).
 *    `nonce` único anti-replay (Fintoc rechaza nonce repetido); `ts` dentro de
 *    una ventana de ±2 min de los servidores de Fintoc. Ambos marcados `crit`.
 *  - Serialización: JWS DESACOPLADA (detached) — el header `Fintoc-JWS-Signature`
 *    lleva `base64url(protected) || "." || base64url(firma)`, OMITIENDO el
 *    payload (el cuerpo viaja aparte en el body HTTP). La firma se calcula sobre
 *    `base64url(protected) || "." || base64url(cuerpoJSON)`, pero el segmento
 *    central (payload) se VACÍA en el valor del header. Es la firma detached del
 *    RFC 7515 (Apéndice F), que es lo que Fintoc valida.
 *  - CRÍTICO: el cuerpo JSON usado para firmar DEBE ser byte-a-byte el mismo que
 *    se envía en el body. Por eso `crearPayout` serializa UNA sola vez y pasa esa
 *    misma cadena tanto a `firmarCuerpo` como al body de `peticion`.
 *
 * TODO confirmar contra el sandbox de Fintoc antes de habilitar pagos reales:
 *  - Que Fintoc acepta la forma DETACHED `protected..firma` (vs. firmar el
 *    payload base64url embebido). La doc describe JWS detached con `crit`,
 *    consistente con esta implementación; validar el primer 200 en sandbox.
 *  - La ventana exacta de `ts` (la doc indica ~2 min) y el formato de `nonce`.
 *  - Idempotencia: header `Idempotency-Key`. La doc recomienda UUID aleatorio,
 *    PERO para anti-doble-pago usamos la llave DETERMINÍSTICA `payout-${liq}`:
 *    un reintento reusa la MISMA llave → Fintoc devuelve el resultado cacheado
 *    de la primera request (mismo status y body) en vez de transferir de nuevo.
 *    CAVEAT verificado: Fintoc poda las llaves de idempotencia tras ≥24h. Pasada
 *    esa ventana, la misma llave generaría una NUEVA transferencia → por eso la
 *    barrera DURA anti-doble-pago es el `UNIQUE (tenant_id, liquidacion_id)` de
 *    `dinero.payouts_conductor`, no solo este header.
 *  - Body: `amount` (entero, unidad mínima; CLP no tiene decimales → el entero
 *    CLP va directo), `currency: "CLP"`, `account_id` (cuenta ORIGEN del
 *    courier), `counterparty` { `account_number`, `institution_id`, `holder_id`
 *    (requerido en Chile), `account_type` ("checking_account" | "sight_account"),
 *    `holder_name` (opcional) }, `comment` (referencia visible), `metadata`.
 *
 * GATE SANDBOX/REAL (lo resuelve la fábrica, no este adaptador):
 *  - La fábrica solo construye este adaptador en modo "real activo" cuando
 *    `PAYOUT_SANDBOX_MODE=false` Y el tenant tiene `payout_real_habilitado=true`.
 *    En cualquier otro caso devuelve el `StubPayoutAdapter`. Como segunda red de
 *    seguridad, este adaptador EXIGE `account_id` origen y secret key; si faltan,
 *    lanza `ErrorPayoutConfig` (no reintentable) en vez de intentar transferir.
 *
 * SEGURIDAD:
 *  - La secret key va SOLO en el header `Authorization`. NUNCA se loguea, ni va
 *    en errores, URLs ni en el `ResultadoPayout`. Los mensajes de error usan
 *    rutas saneadas (sin query) y solo texto de negocio del cuerpo de error.
 *  - La firma de webhook reusa el esquema verificado del adaptador de cobranza
 *    (`Fintoc-Signature: t=<ts>,v1=<hmac>`, HMAC-SHA256 sobre `<ts>.<raw_body>`,
 *    comparación de tiempo constante, tolerancia anti-replay).
 *
 * REGLAS DE DEPENDENCIAS (adaptador = hoja del grafo): solo importa del puerto,
 * los errores del puerto, la utilidad de resiliencia y `node:crypto`.
 */

import { createHmac, createSign, randomBytes, timingSafeEqual } from "node:crypto";
import type {
  ConsultarPayoutArgs,
  CrearPayoutArgs,
  EstadoExternoPayout,
  EstadoPayoutExterno,
  PuertoPayout,
  ResultadoPayout,
  ValidarFirmaWebhookPayoutArgs,
} from "../puerto-payout";
import { ErrorPayoutConfig, ErrorPayoutOperativo } from "../errores";
import { reintentarConBackoff, type ErrorReintentable } from "../../../resiliencia";

/** Base de la API de transferencias de Fintoc — v2 (verificado en doc). */
export const FINTOC_PAYOUT_BASE_URL = "https://api.fintoc.com/v2";

/** Tolerancia anti-replay del timestamp del webhook, en segundos (default SDK). */
const TOLERANCIA_FIRMA_SEGUNDOS = 300;

// ---------------------------------------------------------------------------
// Configuración del adaptador resuelta por la fábrica (nunca entra al núcleo).
// ---------------------------------------------------------------------------

export interface FintocPayoutConfig {
  /**
   * Secret key de la ORGANIZACIÓN Fintoc (auth). La resuelve la fábrica desde
   * env/secretos; NUNCA se loguea ni se expone.
   */
  secretKeyOrg: string | null;
  /**
   * `account_id` de la cuenta ORIGEN del courier desde la que sale el dinero.
   * Es por-tenant (cada courier paga desde su cuenta). `null` si no configurado.
   */
  accountIdOrigen: string | null;
  /**
   * Clave PRIVADA de firma JWS del courier, en PEM (RSA 2048). Es POR-TENANT: el
   * courier la genera y enrola su pública en Fintoc. La resuelve la fábrica desde
   * los secretos cifrados; NUNCA se loguea, ni va en errores/URLs. `null` si el
   * courier aún no la enroló → `crearPayout` lanza `ErrorPayoutConfig`.
   */
  clavePrivadaFirmaPem: string | null;
}

// ---------------------------------------------------------------------------
// Forma (parcial) del Transfer de Fintoc — interna, nunca cruza la frontera.
// ---------------------------------------------------------------------------

interface FintocTransfer {
  id: string;
  status?: string | null; // 'succeeded' | 'pending' | 'failed' | 'rejected' | …
  receipt_url?: string | null;
  error?: { message?: string; code?: string } | null;
}

// ---------------------------------------------------------------------------
// Error HTTP de Fintoc — clasifica reintentables (429/5xx) como en cobranza.
// ---------------------------------------------------------------------------

class ErrorHttpFintocPayout extends Error implements Partial<ErrorReintentable> {
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
    this.name = "ErrorHttpFintocPayout";
    this.status = status;
    if (opts?.mensajeProveedor) this.mensajeProveedor = opts.mensajeProveedor;
    if (status === 429 || status >= 500) {
      this.reintentable = true;
      if (opts?.retryAfterMs !== undefined) this.retryAfterMs = opts.retryAfterMs;
    }
  }
}

/** Extrae un mensaje operativo SANEADO del cuerpo de error de Fintoc. */
function extraerErrorFintoc(cuerpo: unknown): string | null {
  if (!cuerpo || typeof cuerpo !== "object" || !("error" in cuerpo)) return null;
  const err = (cuerpo as { error?: unknown }).error;
  if (!err || typeof err !== "object") return null;
  const e = err as { message?: string; code?: string; type?: string };
  const partes = [e.code ? `[${e.code}]` : undefined, e.message ?? e.type].filter(Boolean);
  return partes.length > 0 ? partes.join(" ") : null;
}

/** Mapea el `tipoCuenta` del dominio al enum de Fintoc (Chile). */
function mapearTipoCuenta(tipo: string): string {
  const t = tipo.toLowerCase();
  if (t.includes("vista") || t.includes("sight")) return "sight_account";
  // 'corriente' / 'checking' / default → cuenta corriente.
  return "checking_account";
}

/** RUT sin puntos ni guion, mayúscula (`holder_id` que Fintoc espera en Chile). */
function rutSinFormato(rut: string): string {
  return rut.replace(/[^0-9kK]/g, "").toUpperCase();
}

/** Codifica un buffer en base64url (RFC 4648 §5, sin padding) para la JWS. */
function base64url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---------------------------------------------------------------------------
// Adaptador concreto
// ---------------------------------------------------------------------------

export class FintocPayoutAdapter implements PuertoPayout {
  private readonly secretKeyOrg: string | null;
  private readonly accountIdOrigen: string | null;
  private readonly clavePrivadaFirmaPem: string | null;
  private readonly baseUrl: string;

  constructor(config: FintocPayoutConfig, baseUrl: string = FINTOC_PAYOUT_BASE_URL) {
    this.secretKeyOrg = config.secretKeyOrg;
    this.accountIdOrigen = config.accountIdOrigen;
    this.clavePrivadaFirmaPem = config.clavePrivadaFirmaPem;
    this.baseUrl = baseUrl;
  }

  // -------------------------------------------------------------------------
  // 1. Crear transferencia saliente (POST /v2/transfers).
  // -------------------------------------------------------------------------

  async crearPayout(args: CrearPayoutArgs): Promise<ResultadoPayout> {
    const secretKey = this.exigirSecretKey();
    const accountId = this.exigirAccountId();
    // Las transferencias salientes EXIGEN firma JWS: sin la clave privada del
    // courier no se debe intentar transferir (no reintentable).
    const clavePrivada = this.exigirClaveFirma();

    // Cuerpo según el contrato verificado de Fintoc. CLP es entero (sin
    // decimales) → `montoLiquidoClp` va directo como `amount`.
    const cuerpo = {
      amount: args.montoLiquidoClp,
      currency: "CLP",
      account_id: accountId,
      counterparty: {
        account_number: args.destinatario.numeroCuenta,
        institution_id: args.destinatario.banco,
        holder_id: rutSinFormato(args.destinatario.rut),
        account_type: mapearTipoCuenta(args.destinatario.tipoCuenta),
        holder_name: args.destinatario.nombreCuenta,
      },
      // Referencia visible para el destinatario y de conciliación.
      comment: args.referencia,
      metadata: { idempotency_key: args.idempotencyKey },
    };

    // CRÍTICO: serializar UNA sola vez. La MISMA cadena se firma y se envía como
    // body — cualquier diferencia byte-a-byte invalidaría la firma JWS detached.
    const cuerpoSerializado = JSON.stringify(cuerpo);

    try {
      const jwsSignature = this.firmarCuerpo(cuerpoSerializado, clavePrivada);

      const transfer = await this.peticion<FintocTransfer>(
        "/transfers",
        "POST",
        secretKey,
        "/transfers",
        {
          // Idempotencia anti-doble-pago: llave DETERMINÍSTICA `payout-${liq}`.
          // Fintoc deduplica del lado externo dentro de su ventana de retención.
          "Idempotency-Key": args.idempotencyKey,
          // Firma JWS detached del cuerpo (seguridad de transferencias salientes).
          "Fintoc-JWS-Signature": jwsSignature,
        },
        cuerpoSerializado,
      );

      const estado = this.mapearEstadoCreacion(transfer.status);
      if (estado === "rechazado") {
        return {
          estado: "rechazado",
          payoutExternoId: transfer.id,
          errorDescripcion:
            extraerErrorFintoc({ error: transfer.error }) ?? "el proveedor rechazó la transferencia",
        };
      }

      return {
        estado: "enviado",
        payoutExternoId: transfer.id,
        comprobanteRef: transfer.receipt_url ?? undefined,
      };
    } catch (error) {
      // `ErrorPayoutConfig` (falta credencial/cuenta) NO se traga: es no
      // reintentable y debe propagarse para que el job no reintente.
      if (error instanceof ErrorPayoutConfig) throw error;

      // Errores operativos (429/5xx/red) → `estado:'fallido'` para que el job
      // reintente con la MISMA idempotencyKey (sin doble transferencia).
      if (error instanceof ErrorPayoutOperativo) {
        return {
          estado: "fallido",
          errorDescripcion: error.mensajeProveedor,
        };
      }
      // Cualquier otro error inesperado: fallido y saneado (sin secretos).
      return { estado: "fallido", errorDescripcion: "error inesperado al instruir el payout" };
    }
  }

  // -------------------------------------------------------------------------
  // 2. Consultar estado del transfer (GET /v2/transfers/{id}).
  // -------------------------------------------------------------------------

  async consultarPayout(args: ConsultarPayoutArgs): Promise<EstadoPayoutExterno> {
    const secretKey = this.exigirSecretKey();
    const transfer = await this.peticion<FintocTransfer>(
      `/transfers/${encodeURIComponent(args.payoutExternoId)}`,
      "GET",
      secretKey,
      "/transfers/{id}",
    );

    return {
      payoutExternoId: transfer.id ?? args.payoutExternoId,
      estado: this.mapearEstadoConsulta(transfer.status),
      descripcion: extraerErrorFintoc({ error: transfer.error }),
      comprobanteRef: transfer.receipt_url ?? null,
    };
  }

  // -------------------------------------------------------------------------
  // 3. Validar firma del webhook (reusa el esquema verificado de cobranza).
  // -------------------------------------------------------------------------

  validarFirmaWebhook(args: ValidarFirmaWebhookPayoutArgs): boolean {
    const partes = this.parsearHeaderFirma(args.firma);
    if (!partes) return false;
    const { timestamp, firmaRecibida } = partes;

    const ahoraSeg = Math.floor(Date.now() / 1000);
    if (Math.abs(ahoraSeg - timestamp) > TOLERANCIA_FIRMA_SEGUNDOS) return false;

    const mensaje = `${timestamp}.${args.cuerpo}`;
    const firmaEsperada = createHmac("sha256", args.secreto).update(mensaje, "utf8").digest("hex");
    return this.comparacionTiempoConstante(firmaEsperada, firmaRecibida);
  }

  // -------------------------------------------------------------------------
  // Helpers privados
  // -------------------------------------------------------------------------

  /** `succeeded`/`pending`/`processing` → enviado; `rejected`/`failed` → rechazado. */
  private mapearEstadoCreacion(status: string | null | undefined): "enviado" | "rechazado" {
    if (status === "rejected" || status === "failed") return "rechazado";
    return "enviado";
  }

  private mapearEstadoConsulta(status: string | null | undefined): EstadoExternoPayout {
    if (status === "succeeded") return "confirmado";
    if (status === "rejected" || status === "failed") return "rechazado";
    return "pendiente";
  }

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

  private comparacionTiempoConstante(esperada: string, recibida: string): boolean {
    const a = Buffer.from(esperada, "utf8");
    const b = Buffer.from(recibida, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  /** Lanza `ErrorPayoutConfig` (no reintentable) si falta la secret key. */
  private exigirSecretKey(): string {
    if (!this.secretKeyOrg) {
      throw new ErrorPayoutConfig(
        "falta la secret key de la organización Fintoc (FINTOC_SECRET_KEY) — " +
          "configúrala vía el gestor de secretos del despliegue",
      );
    }
    return this.secretKeyOrg;
  }

  /** Lanza `ErrorPayoutConfig` (no reintentable) si falta la cuenta origen. */
  private exigirAccountId(): string {
    if (!this.accountIdOrigen) {
      throw new ErrorPayoutConfig(
        "falta la cuenta origen del courier (account_id) para emitir el payout — " +
          "el courier debe conectar/seleccionar su cuenta bancaria de pago",
      );
    }
    return this.accountIdOrigen;
  }

  /** Lanza `ErrorPayoutConfig` (no reintentable) si falta la clave de firma JWS. */
  private exigirClaveFirma(): string {
    if (!this.clavePrivadaFirmaPem) {
      // El mensaje describe QUÉ falta y cómo resolverlo — NUNCA incluye la clave.
      throw new ErrorPayoutConfig(
        "falta la clave de firma del payout (payout_clave_firma_privada) — debe enrolarse en Fintoc",
      );
    }
    return this.clavePrivadaFirmaPem;
  }

  /**
   * Firma el cuerpo de la transferencia y devuelve el valor del header
   * `Fintoc-JWS-Signature`: una JWS DESACOPLADA (detached) RS256.
   *
   * Forma del valor: `base64url(protected) || "." || base64url(firma)` — el
   * segmento del payload se OMITE (el cuerpo viaja en el body HTTP). La firma se
   * calcula sobre `base64url(protected) || "." || base64url(cuerpo)` (entrada de
   * firma del RFC 7515), pero ese payload no se incluye en el header.
   *
   * SEGURIDAD: la clave privada solo se usa aquí, en memoria; jamás se loguea ni
   * se incorpora a errores. Si la clave PEM es inválida, `createSign` lanza y el
   * error se captura aguas arriba como fallo saneado (sin exponer la clave).
   */
  private firmarCuerpo(cuerpo: string, clavePrivadaPem: string): string {
    const protectedHeader = {
      alg: "RS256",
      // `nonce` único anti-replay: 16 bytes aleatorios en base64url.
      nonce: base64url(randomBytes(16)),
      // `ts` en segundos Unix; Fintoc valida una ventana de ±~2 min.
      ts: Math.floor(Date.now() / 1000),
      // Extensiones críticas que Fintoc DEBE entender y validar.
      crit: ["ts", "nonce"],
    };

    const protectedB64 = base64url(Buffer.from(JSON.stringify(protectedHeader), "utf8"));
    const payloadB64 = base64url(Buffer.from(cuerpo, "utf8"));

    // Entrada de firma del RFC 7515: ASCII(protected) || "." || payload-base64url.
    const entradaFirma = `${protectedB64}.${payloadB64}`;
    const firma = createSign("RSA-SHA256")
      .update(entradaFirma, "utf8")
      .sign(clavePrivadaPem);

    // JWS DETACHED: se omite el payload del valor del header → `protected..firma`
    // colapsa a `protected.firma` (RFC 7515 Apéndice F).
    return `${protectedB64}.${base64url(firma)}`;
  }

  /**
   * Cliente HTTP de bajo nivel contra Fintoc, con backoff/reintentos y
   * clasificación 429/5xx → reintentable. La secret key va SOLO en el header
   * `Authorization`; los mensajes de error usan `rutaSaneada` (sin query/id).
   *
   * La firma `Fintoc-JWS-Signature` de transferencias salientes la calcula
   * `crearPayout` (ver `firmarCuerpo`) y la pasa en `headersExtra`; este cliente
   * solo la reenvía. Ni la secret key ni la clave de firma aparecen en logs/errores.
   */
  private async peticion<T>(
    ruta: string,
    metodo: "GET" | "POST",
    secretKey: string,
    rutaSaneada: string,
    headersExtra?: Record<string, string>,
    cuerpo?: string,
  ): Promise<T> {
    return reintentarConBackoff(async () => {
      const respuesta = await fetch(`${this.baseUrl}${ruta}`, {
        method: metodo,
        headers: {
          // Auth verificada en cobranza: secret key DIRECTA, sin prefijo "Bearer".
          Authorization: secretKey,
          accept: "application/json",
          ...(cuerpo ? { "content-type": "application/json" } : {}),
          ...headersExtra,
        },
        ...(cuerpo ? { body: cuerpo } : {}),
      });

      if (!respuesta.ok) {
        const retryAfterMs = this.leerRetryAfterMs(respuesta.headers);
        const cuerpoError = await respuesta.json().catch(() => null);
        const mensajeProveedor = extraerErrorFintoc(cuerpoError) ?? undefined;
        throw new ErrorHttpFintocPayout(
          `Fintoc respondió ${respuesta.status} para ${metodo} ${rutaSaneada}`,
          respuesta.status,
          { retryAfterMs, mensajeProveedor },
        );
      }

      return (await respuesta.json()) as T;
    }).catch((error: unknown) => {
      if (error instanceof ErrorHttpFintocPayout) {
        const detalle = error.mensajeProveedor ?? "sin detalle del proveedor";
        throw new ErrorPayoutOperativo(detalle, {
          codigoHttp: error.status,
          retryAfterMs: error.retryAfterMs,
        });
      }
      // Fallo de red/timeout sin status → operativo (reintentable).
      throw new ErrorPayoutOperativo("fallo de red al contactar al proveedor de payout");
    });
  }

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
