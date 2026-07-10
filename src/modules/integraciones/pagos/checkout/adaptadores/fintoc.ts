/**
 * Adaptador FINTOC de CHECKOUT de suscripción — crea Payment Links (cobro).
 * =============================================================================
 * Cobra Rutax→courier generando un link de pago hospedado de Fintoc. Usa la
 * MISMA secret key de ORGANIZACIÓN que los payouts (`FINTOC_SECRET_KEY`) — una
 * sola cuenta Fintoc de la plataforma cobra a todos los couriers.
 *
 * CONTRATO VERIFICADO CONTRA DOC OFICIAL (jul 2026):
 *  - POST https://api.fintoc.com/v1/payment_links
 *    (https://docs.fintoc.com/reference/payment-links-create)
 *  - Auth: header `Authorization: <secret_key>` (DIRECTA, sin "Bearer" — igual
 *    que el adaptador de payout, verificado en cobranza).
 *  - Body: `amount` (entero, unidad mínima; CLP no tiene decimales → CLP directo),
 *    `currency: "CLP"`, opcionales `checkout.description`, `customer_email`,
 *    `expires_after_seconds`, `metadata` (se conserva y vuelve en el webhook).
 *  - Respuesta 201: `id`, `url` (página de pago), `status` (active/expired/
 *    canceled), `mode` (live/test).
 *
 * SEGURIDAD: la secret key va SOLO en el header `Authorization`. NUNCA se loguea,
 * ni en errores/URLs ni en el resultado. Los mensajes de error usan la ruta
 * saneada, sin query ni identificadores sensibles.
 *
 * REGLA DE DEPENDENCIAS (adaptador = hoja): solo importa del puerto, sus errores
 * y la utilidad de resiliencia.
 */

import type {
  CrearLinkPagoArgs,
  PuertoCheckoutSuscripcion,
  ResultadoLinkPago,
} from '../puerto-checkout';
import { ErrorCheckoutConfig, ErrorCheckoutOperativo } from '../errores';
import { reintentarConBackoff, type ErrorReintentable } from '../../../resiliencia';

/** Base de la API de Payment Links de Fintoc — v1 (verificado en doc). */
export const FINTOC_CHECKOUT_BASE_URL = 'https://api.fintoc.com/v1';

/** Forma (parcial) del Payment Link de Fintoc — interna, no cruza la frontera. */
interface FintocPaymentLink {
  id: string;
  url?: string | null;
  status?: string | null;
  mode?: string | null;
}

class ErrorHttpFintocCheckout extends Error implements Partial<ErrorReintentable> {
  readonly status: number;
  readonly reintentable?: true;
  readonly retryAfterMs?: number;
  readonly mensajeProveedor?: string;

  constructor(mensaje: string, status: number, opts?: { retryAfterMs?: number; mensajeProveedor?: string }) {
    super(mensaje);
    this.name = 'ErrorHttpFintocCheckout';
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

export class FintocCheckoutAdapter implements PuertoCheckoutSuscripcion {
  private readonly secretKeyOrg: string | null;
  private readonly baseUrl: string;

  constructor(secretKeyOrg: string | null, baseUrl: string = FINTOC_CHECKOUT_BASE_URL) {
    this.secretKeyOrg = secretKeyOrg;
    this.baseUrl = baseUrl;
  }

  async crearLinkPago(args: CrearLinkPagoArgs): Promise<ResultadoLinkPago> {
    const secretKey = this.exigirSecretKey();

    const cuerpo: Record<string, unknown> = {
      amount: args.montoClp, // CLP entero, unidad mínima
      currency: 'CLP',
      checkout: { description: args.descripcion },
      metadata: args.metadata,
    };
    if (args.emailCliente) cuerpo.customer_email = args.emailCliente;
    if (args.expiraEnSegundos && args.expiraEnSegundos > 0) {
      cuerpo.expires_after_seconds = Math.floor(args.expiraEnSegundos);
    }

    const link = await this.peticion<FintocPaymentLink>('/payment_links', 'POST', secretKey, '/payment_links', JSON.stringify(cuerpo));

    if (!link.id || !link.url) {
      throw new ErrorCheckoutOperativo('Fintoc no devolvió id/url del payment link');
    }

    return {
      linkExternoId: link.id,
      url: link.url,
      modo: link.mode === 'live' ? 'live' : 'test',
    };
  }

  private exigirSecretKey(): string {
    if (!this.secretKeyOrg) {
      throw new ErrorCheckoutConfig(
        'falta la secret key de la organización Fintoc (FINTOC_SECRET_KEY) — ' +
          'configúrala vía el gestor de secretos del despliegue',
      );
    }
    return this.secretKeyOrg;
  }

  private async peticion<T>(
    ruta: string,
    metodo: 'GET' | 'POST',
    secretKey: string,
    rutaSaneada: string,
    cuerpo?: string,
  ): Promise<T> {
    return reintentarConBackoff(async () => {
      const respuesta = await fetch(`${this.baseUrl}${ruta}`, {
        method: metodo,
        headers: {
          Authorization: secretKey, // secret key DIRECTA, sin prefijo "Bearer"
          accept: 'application/json',
          ...(cuerpo ? { 'content-type': 'application/json' } : {}),
        },
        ...(cuerpo ? { body: cuerpo } : {}),
      });

      if (!respuesta.ok) {
        const retryAfterMs = this.leerRetryAfterMs(respuesta.headers);
        const cuerpoError = await respuesta.json().catch(() => null);
        const mensajeProveedor = extraerErrorFintoc(cuerpoError) ?? undefined;
        throw new ErrorHttpFintocCheckout(
          `Fintoc respondió ${respuesta.status} para ${metodo} ${rutaSaneada}`,
          respuesta.status,
          { retryAfterMs, mensajeProveedor },
        );
      }

      return (await respuesta.json()) as T;
    }).catch((error: unknown) => {
      if (error instanceof ErrorHttpFintocCheckout) {
        throw new ErrorCheckoutOperativo(error.mensajeProveedor ?? 'error del proveedor de cobro', {
          codigoHttp: error.status,
        });
      }
      if (error instanceof ErrorCheckoutConfig || error instanceof ErrorCheckoutOperativo) throw error;
      throw new ErrorCheckoutOperativo('fallo de red al contactar al proveedor de cobro');
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
