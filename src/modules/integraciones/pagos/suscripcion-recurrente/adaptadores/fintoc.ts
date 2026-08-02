/**
 * Adaptador FINTOC de AUTO-COBRO RECURRENTE — enrola mandato + cobra por período.
 * =============================================================================
 * Cobra Rutax→courier de forma recurrente usando Fintoc Pagos Recurrentes. Usa la
 * MISMA secret key de ORGANIZACIÓN que payout/checkout (`FINTOC_SECRET_KEY`) —
 * una sola cuenta Fintoc de la plataforma cobra a todos los couriers.
 *
 * MODELO: mandato (checkout `flow=setup`) + cobro EXPLÍCITO por período
 * (`payment_intents`), NO la auto-facturación de Fintoc. Rutax dispara el cobro
 * cuando cierra el período; no delega el calendario a Fintoc (ver puerto).
 *
 * VERIFICACIÓN CONTRA DOC OFICIAL (jul 2026) — qué se confirmó y qué queda TODO:
 *  · Enrolar (checkout session): CONFIRMADO que existe
 *    POST .../checkout_sessions (soporta `payment`, `subscription` y `setup`).
 *    Guía "Accept recurring payments" muestra `POST /v2/checkout_sessions` con
 *    `flow`, `amount`, `currency`, `success_url`, `cancel_url`,
 *    `payment_method_types` y `metadata`; devuelve `id` + `redirect_url`.
 *    (https://docs.fintoc.com/docs/accept-recurring-payments)
 *  · Cobrar (payment intent contra método guardado): CONFIRMADO que existe
 *    POST .../payment_intents "charges a saved payment method" (índice de la
 *    API reference). Los NOMBRES EXACTOS de los campos para PAC (`payment_method`
 *    vs `payment_method_id`, si exige `subscription`) NO están 100% confirmados en
 *    la doc pública → TODO: confirmar contra el primer 2xx del sandbox.
 *  · Cancelar: CONFIRMADO POST .../subscriptions/{id}/cancel ("Cancel a
 *    subscription immediately"). Para un mandato tipo payment_method de `setup`
 *    puede no requerir llamada (basta dejar de cobrar) → cancelación defensiva.
 *  · Auth: header `Authorization: <secret_key>` DIRECTA (sin "Bearer"), igual que
 *    payout/checkout (verificado en cobranza).
 *  · Idempotencia: header `Idempotency-Key` (verificado en el adaptador de payout;
 *    misma cuenta/API). TODO: confirmar que Fintoc lo respeta en `payment_intents`.
 *  · Versión de path: la guía de recurrentes muestra `/v2/checkout_sessions` y los
 *    payouts usan `/v2`, pero el índice de la API reference (llms.txt) lista estos
 *    recursos bajo `/v1`. Discrepancia real de la doc → base URL centralizada y
 *    overridable; TODO: fijar la versión con la primera llamada real en sandbox.
 *
 * SEGURIDAD: la secret key y el `mandatoToken` van SOLO donde deben (header
 * `Authorization` / cuerpo del cargo). NUNCA se loguean, ni en errores/URLs ni en
 * el resultado. Los mensajes de error usan la ruta saneada.
 *
 * REGLA DE DEPENDENCIAS (adaptador = hoja): solo importa del puerto, sus errores
 * y la utilidad de resiliencia compartida.
 */

import type {
  CancelarMandatoArgs,
  CobrarPeriodoArgs,
  PuertoSuscripcionRecurrente,
  RegistrarMandatoArgs,
  ResultadoCancelarMandato,
  ResultadoCobrarPeriodo,
  ResultadoRegistrarMandato,
} from '../puerto-suscripcion-recurrente';
import { ErrorSuscripcionConfig, ErrorSuscripcionOperativo } from '../errores';
import { reintentarConBackoff, type ErrorReintentable } from '../../../resiliencia';

/**
 * Base de la API de Fintoc para recursos de suscripción recurrente. Ver el bloque
 * "Versión de path" arriba: hay discrepancia v1/v2 en la doc; se centraliza aquí y
 * es overridable por el constructor (tests / ajuste de devops sin re-desplegar).
 */
export const FINTOC_SUSCRIPCION_BASE_URL = 'https://api.fintoc.com/v2';

/**
 * Método de pago del mandato. PAC (débito automático) es el canónico en Chile
 * para cobro recurrente; se deja `card` como alternativa. TODO: confirmar el
 * literal exacto que Fintoc espera en `payment_method_types` para PAC.
 */
const TIPOS_METODO_PAGO_DEFAULT = ['pac'];

/** Forma (parcial) de una checkout session de Fintoc — interna, no cruza la frontera. */
interface FintocCheckoutSession {
  id?: string | null;
  redirect_url?: string | null;
  url?: string | null;
  mode?: string | null;
  status?: string | null;
}

/** Forma (parcial) de un payment intent de Fintoc — interna, no cruza la frontera. */
interface FintocPaymentIntent {
  id?: string | null;
  status?: string | null;
  error?: unknown;
}

/** Config del adaptador. La secret key es de ORG (misma que payout/checkout). */
export interface FintocSuscripcionConfig {
  secretKeyOrg: string | null;
  /** Base de la app para construir `success_url`/`cancel_url` del enrolamiento. */
  appBaseUrl?: string | null;
}

class ErrorHttpFintocSuscripcion extends Error implements Partial<ErrorReintentable> {
  readonly status: number;
  readonly reintentable?: true;
  readonly retryAfterMs?: number;
  readonly mensajeProveedor?: string;

  constructor(mensaje: string, status: number, opts?: { retryAfterMs?: number; mensajeProveedor?: string }) {
    super(mensaje);
    this.name = 'ErrorHttpFintocSuscripcion';
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
  if (!cuerpo || typeof cuerpo !== 'object' || !('error' in cuerpo)) return null;
  const err = (cuerpo as { error?: unknown }).error;
  if (!err || typeof err !== 'object') return null;
  const e = err as { message?: string; code?: string; type?: string };
  const partes = [e.code ? `[${e.code}]` : undefined, e.message ?? e.type].filter(Boolean);
  return partes.length > 0 ? partes.join(' ') : null;
}

/**
 * Interpreta el `mandatoToken` opaco: puede ser un id simple (payment method) o un
 * JSON compacto `{ payment_method_id?, subscription_id? }`. Nunca se loguea.
 */
function interpretarMandatoToken(token: string): { paymentMethodId: string | null; subscriptionId: string | null } {
  const t = (token ?? '').trim();
  if (t.startsWith('{')) {
    try {
      const parsed = JSON.parse(t) as { payment_method_id?: unknown; subscription_id?: unknown };
      return {
        paymentMethodId: typeof parsed.payment_method_id === 'string' ? parsed.payment_method_id : null,
        subscriptionId: typeof parsed.subscription_id === 'string' ? parsed.subscription_id : null,
      };
    } catch {
      // Token malformado: se trata como id simple (defensivo).
    }
  }
  // Heurística por prefijo Fintoc: `sub_` = subscription, resto = payment method.
  if (t.startsWith('sub_')) return { paymentMethodId: null, subscriptionId: t };
  return { paymentMethodId: t || null, subscriptionId: null };
}

export class FintocSuscripcionRecurrenteAdapter implements PuertoSuscripcionRecurrente {
  private readonly secretKeyOrg: string | null;
  private readonly appBaseUrl: string;
  private readonly baseUrl: string;

  constructor(config: FintocSuscripcionConfig, baseUrl: string = FINTOC_SUSCRIPCION_BASE_URL) {
    this.secretKeyOrg = config.secretKeyOrg;
    this.appBaseUrl =
      config.appBaseUrl ??
      process.env.APP_BASE_URL ??
      process.env.NEXT_PUBLIC_APP_URL ??
      'https://app.rutax.cl';
    this.baseUrl = baseUrl;
  }

  // -------------------------------------------------------------------------
  // 1. Enrolar el mandato (POST /checkout_sessions, flow=setup).
  // -------------------------------------------------------------------------

  async registrarMandato(args: RegistrarMandatoArgs): Promise<ResultadoRegistrarMandato> {
    const secretKey = this.exigirSecretKey();

    // `flow=setup`: guarda el método de pago/mandato SIN iniciar la
    // auto-facturación de Fintoc. Rutax cobra explícitamente por período después.
    const cuerpo: Record<string, unknown> = {
      flow: 'setup',
      currency: 'CLP',
      payment_method_types: TIPOS_METODO_PAGO_DEFAULT,
      success_url: `${this.appBaseUrl.replace(/\/$/, '')}/suscripcion/enrolamiento/exito`,
      cancel_url: `${this.appBaseUrl.replace(/\/$/, '')}/suscripcion/enrolamiento/cancelado`,
      // Fintoc conserva y devuelve la metadata en el webhook → correlación.
      metadata: args.metadata,
    };
    if (args.emailCliente) cuerpo.customer_data = { email: args.emailCliente };

    const sesion = await this.peticion<FintocCheckoutSession>(
      '/checkout_sessions',
      'POST',
      secretKey,
      '/checkout_sessions',
      undefined,
      JSON.stringify(cuerpo),
    );

    const url = sesion.redirect_url ?? sesion.url ?? null;
    if (!sesion.id || !url) {
      throw new ErrorSuscripcionOperativo('Fintoc no devolvió id/url de la sesión de enrolamiento');
    }

    return {
      // Id de correlación temporal: el id definitivo del mandato (payment method /
      // subscription) llega en el webhook `checkout_session.finished`.
      mandatoExternoId: sesion.id,
      urlEnrolamiento: url,
      modo: sesion.mode === 'live' ? 'live' : 'test',
    };
  }

  // -------------------------------------------------------------------------
  // 2. Cobrar un período (POST /payment_intents contra el método guardado).
  // -------------------------------------------------------------------------

  async cobrarPeriodo(args: CobrarPeriodoArgs): Promise<ResultadoCobrarPeriodo> {
    const secretKey = this.exigirSecretKey();
    const { paymentMethodId, subscriptionId } = interpretarMandatoToken(args.mandatoToken);

    if (!paymentMethodId && !subscriptionId) {
      // Sin referencia de mandato no se puede cobrar: no reintentable.
      throw new ErrorSuscripcionConfig('mandato de auto-cobro ausente o inválido — el courier debe re-vincular');
    }

    // TODO(confirmar en sandbox): nombres exactos de campos para cargar un método
    // guardado PAC. La API reference confirma que `payment_intents` "charges a
    // saved payment method"; el literal (`payment_method` vs `payment_method_id`)
    // y si exige `subscription` se fija con el primer 2xx real. Se envían ambas
    // variantes de correlación de forma conservadora — Fintoc ignora las de más.
    const cuerpo: Record<string, unknown> = {
      amount: args.montoClp, // CLP entero, unidad mínima
      currency: 'CLP',
      reference: args.referencia,
      metadata: args.metadata,
    };
    if (paymentMethodId) cuerpo.payment_method = paymentMethodId;
    if (subscriptionId) cuerpo.subscription = subscriptionId;

    try {
      const intent = await this.peticion<FintocPaymentIntent>(
        '/payment_intents',
        'POST',
        secretKey,
        '/payment_intents',
        // Idempotencia anti-doble-cobro: llave DETERMINÍSTICA `susc-cobro-${periodoId}`.
        { 'Idempotency-Key': args.idempotencyKey },
        JSON.stringify(cuerpo),
      );

      const estado = this.mapearEstadoCobro(intent.status);
      if (estado === 'rechazado') {
        return {
          estado: 'rechazado',
          cobroExternoId: intent.id ?? undefined,
          errorDescripcion: extraerErrorFintoc({ error: intent.error }) ?? 'el proveedor rechazó el cobro',
        };
      }

      return { estado: 'enviado', cobroExternoId: intent.id ?? undefined };
    } catch (error) {
      // Config (mandato ausente) NO se traga: no reintentable, debe propagarse.
      if (error instanceof ErrorSuscripcionConfig) throw error;
      // Operativo (429/5xx/red) → `fallido` para que el job reintente con la
      // MISMA idempotencyKey (sin doble cobro).
      if (error instanceof ErrorSuscripcionOperativo) {
        return { estado: 'fallido', errorDescripcion: error.message };
      }
      return { estado: 'fallido', errorDescripcion: 'error inesperado al instruir el cobro' };
    }
  }

  // -------------------------------------------------------------------------
  // 3. Cancelar el mandato (POST /subscriptions/{id}/cancel — defensivo).
  // -------------------------------------------------------------------------

  async cancelarMandato(args: CancelarMandatoArgs): Promise<ResultadoCancelarMandato> {
    const secretKey = this.secretKeyOrg;
    if (!secretKey) return { ok: false };

    const { subscriptionId } = interpretarMandatoToken(args.mandatoToken);

    // Para un mandato de `flow=setup` (payment method) puede no existir un recurso
    // "subscription" que cancelar en Fintoc: basta con dejar de cobrar (estado
    // local `cancelado`). Solo si el token referencia una subscription intentamos
    // el cancel remoto confirmado (POST /subscriptions/{id}/cancel).
    if (!subscriptionId) return { ok: true };

    try {
      await this.peticion<{ id?: string }>(
        `/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,
        'POST',
        secretKey,
        '/subscriptions/{id}/cancel',
      );
      return { ok: true };
    } catch {
      // NUNCA propagar (podría arrastrar fragmentos sensibles); el caller decide.
      return { ok: false };
    }
  }

  // -------------------------------------------------------------------------
  // Helpers internos
  // -------------------------------------------------------------------------

  private exigirSecretKey(): string {
    if (!this.secretKeyOrg) {
      throw new ErrorSuscripcionConfig(
        'falta la secret key de la organización Fintoc (FINTOC_SECRET_KEY) — ' +
          'configúrala vía el gestor de secretos del despliegue',
      );
    }
    return this.secretKeyOrg;
  }

  /** Mapea el `status` del payment intent al estado inmediato del dominio. */
  private mapearEstadoCobro(status: string | null | undefined): 'enviado' | 'rechazado' {
    // Estados terminales de rechazo de negocio (NO reintentables).
    if (status === 'rejected' || status === 'failed' || status === 'canceled') return 'rechazado';
    // pending / processing / succeeded / requires_action / null → aceptado; la
    // confirmación definitiva llega por webhook (`payment_intent.succeeded/.failed`).
    return 'enviado';
  }

  private async peticion<T>(
    ruta: string,
    metodo: 'GET' | 'POST',
    secretKey: string,
    rutaSaneada: string,
    headersExtra?: Record<string, string>,
    cuerpo?: string,
  ): Promise<T> {
    return reintentarConBackoff(async () => {
      const respuesta = await fetch(`${this.baseUrl}${ruta}`, {
        method: metodo,
        headers: {
          Authorization: secretKey, // secret key DIRECTA, sin prefijo "Bearer"
          accept: 'application/json',
          ...(cuerpo ? { 'content-type': 'application/json' } : {}),
          ...(headersExtra ?? {}),
        },
        ...(cuerpo ? { body: cuerpo } : {}),
      });

      if (!respuesta.ok) {
        const retryAfterMs = this.leerRetryAfterMs(respuesta.headers);
        const cuerpoError = await respuesta.json().catch(() => null);
        const mensajeProveedor = extraerErrorFintoc(cuerpoError) ?? undefined;
        throw new ErrorHttpFintocSuscripcion(
          `Fintoc respondió ${respuesta.status} para ${metodo} ${rutaSaneada}`,
          respuesta.status,
          { retryAfterMs, mensajeProveedor },
        );
      }

      return (await respuesta.json()) as T;
    }).catch((error: unknown) => {
      if (error instanceof ErrorHttpFintocSuscripcion) {
        throw new ErrorSuscripcionOperativo(error.mensajeProveedor ?? 'error del proveedor de cobro', {
          codigoHttp: error.status,
        });
      }
      if (error instanceof ErrorSuscripcionConfig || error instanceof ErrorSuscripcionOperativo) throw error;
      throw new ErrorSuscripcionOperativo('fallo de red al contactar al proveedor de cobro');
    });
  }

  private leerRetryAfterMs(headers: Headers): number | undefined {
    const valor = headers.get('retry-after');
    if (!valor) return undefined;
    const segundos = Number(valor);
    if (!Number.isNaN(segundos)) return segundos * 1000;
    const fecha = Date.parse(valor);
    if (!Number.isNaN(fecha)) return Math.max(0, fecha - Date.now());
    return undefined;
  }
}
