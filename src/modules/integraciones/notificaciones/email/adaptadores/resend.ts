/**
 * Adaptador REAL de email vía Resend (`api.resend.com`).
 * =============================================================================
 * Llamado por REST directo (`fetch`) — deliberadamente SIN agregar el SDK
 * `resend` como dependencia nueva: la API es un único POST JSON, no amerita una
 * librería (mismo criterio que `FintocPayoutAdapter`/adaptador de cobranza, que
 * tampoco usan un SDK de Fintoc).
 *
 * GATE SANDBOX/REAL: lo resuelve `fabrica-email.ts` (`obtenerPuertoEmail`), NO
 * este adaptador — este solo se instancia cuando el gate YA está abierto
 * (`EMAIL_SANDBOX_MODE=false` + `RESEND_API_KEY` presente).
 *
 * SEGURIDAD:
 *  - La API key viaja SOLO en el header `Authorization: Bearer <key>`. NUNCA se
 *    loguea, ni aparece en errores ni en el `ResultadoEnvioEmail`.
 *  - `enviarEmail` NUNCA lanza: cualquier fallo (red, 4xx/5xx del proveedor) se
 *    normaliza a `{ enviado:false, modo:'real', errorDescripcion }` SANEADO
 *    (sin la key). El llamador (job Inngest) decide si reintentar.
 *
 * REGLAS DE DEPENDENCIAS (adaptador = hoja del grafo): solo importa del puerto.
 */

import type { EnviarEmailArgs, PuertoEmail, ResultadoEnvioEmail } from '../puerto-email';

const RESEND_BASE_URL = 'https://api.resend.com';
const TIMEOUT_MS = 8000;

export interface ResendEmailConfig {
  /** API key de Resend. NUNCA se loguea ni se expone. */
  apiKey: string;
  /** Remitente, formato `"Rutax <no-responder@dominio.cl>"` o dirección simple. */
  remitente: string;
  /**
   * Buzón al que va la respuesta si el destinatario contesta. Opcional.
   *
   * Vive en la CONFIG y no en `EnviarEmailArgs` a propósito: es una decisión de
   * plataforma (todo el correo automático sale de `no-responder@` y se responde
   * al buzón de administración), no algo que cada llamador deba recordar. Sin
   * esto, una respuesta al remitente se pierde en silencio.
   */
  responderA?: string;
}

interface RespuestaResendOk {
  id: string;
}

interface RespuestaResendError {
  message?: string;
  name?: string;
}

/** Extrae un mensaje de error saneado del cuerpo de respuesta de Resend (nunca incluye la key). */
function extraerErrorResend(cuerpo: unknown): string | null {
  if (!cuerpo || typeof cuerpo !== 'object') return null;
  const c = cuerpo as RespuestaResendError;
  return c.message ?? c.name ?? null;
}

export class ResendEmailAdapter implements PuertoEmail {
  private readonly apiKey: string;
  private readonly remitente: string;
  private readonly responderA?: string;
  private readonly baseUrl: string;

  constructor(config: ResendEmailConfig, baseUrl: string = RESEND_BASE_URL) {
    this.apiKey = config.apiKey;
    this.remitente = config.remitente;
    this.responderA = config.responderA;
    this.baseUrl = baseUrl;
  }

  async enviarEmail(args: EnviarEmailArgs): Promise<ResultadoEnvioEmail> {
    try {
      const respuesta = await fetch(`${this.baseUrl}/emails`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.remitente,
          to: [args.para],
          subject: args.asunto,
          html: args.html,
          ...(args.texto ? { text: args.texto } : {}),
          ...(this.responderA ? { reply_to: this.responderA } : {}),
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!respuesta.ok) {
        const cuerpo = await respuesta.json().catch(() => null);
        const errorDescripcion =
          extraerErrorResend(cuerpo) ?? `Resend respondió ${respuesta.status}`;
        return { enviado: false, modo: 'real', errorDescripcion };
      }

      const cuerpo = (await respuesta.json()) as RespuestaResendOk;
      return { enviado: true, modo: 'real', proveedorId: cuerpo.id };
    } catch {
      // Red/timeout — nunca exponer la api key. El llamador decide si reintentar.
      return { enviado: false, modo: 'real', errorDescripcion: 'error de red al contactar Resend' };
    }
  }
}
