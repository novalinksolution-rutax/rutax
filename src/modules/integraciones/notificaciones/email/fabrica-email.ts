/**
 * Fábrica del puerto de EMAIL.
 * =============================================================================
 * Patrón idéntico a `obtenerPuertoPayout`/`obtenerPuertoDte`: resuelve el gate
 * sandbox/real desde variables de entorno y devuelve el adaptador concreto; el
 * resto del sistema trabaja solo contra `PuertoEmail`.
 *
 * GATE SANDBOX/REAL (molde de `DTE_SANDBOX_MODE`/`PAYOUT_SANDBOX_MODE`):
 *   Se devuelve el adaptador REAL (Resend) SOLO si se cumplen AMBAS condiciones:
 *     1. `EMAIL_SANDBOX_MODE=false` (literal — cualquier otro valor, incluida
 *        su ausencia, mantiene sandbox: seguridad por defecto).
 *     2. `RESEND_API_KEY` presente (sin key no hay con qué autenticar).
 *   Si falta CUALQUIERA → `StubEmailAdapter` (no envía correo real).
 *
 *   A diferencia de DTE/payout, el email NO tiene un opt-in POR TENANT: es una
 *   config de PLATAFORMA (Rutax decide si el ambiente envía correo real o no),
 *   no algo que cada courier active — el destinatario es siempre el courier
 *   mismo (o su dueño/admin), nunca un tercero que requiera consentimiento
 *   granular adicional.
 */

import { StubEmailAdapter } from './adaptadores/stub';
import { ResendEmailAdapter } from './adaptadores/resend';
import type { PuertoEmail } from './puerto-email';

/** Remitente por defecto si `EMAIL_FROM_ADDRESS` no está configurado. */
const REMITENTE_DEFAULT = 'Rutax <no-responder@rutax.app>';

/**
 * ¿El modo sandbox de email está activo? Default SÍ (sandbox): solo el valor
 * literal `"false"` lo desactiva. Ausente, vacío o cualquier otro valor →
 * sandbox. Misma semántica de seguridad-por-defecto que `DTE_SANDBOX_MODE`/
 * `payoutSandboxActivo`.
 */
export function emailSandboxActivo(): boolean {
  return process.env.EMAIL_SANDBOX_MODE !== 'false';
}

/** Devuelve el adaptador de email aplicando el gate sandbox/real. */
export function obtenerPuertoEmail(): PuertoEmail {
  const apiKey = process.env.RESEND_API_KEY;
  const gateRealAbierto = !emailSandboxActivo() && Boolean(apiKey);

  if (!gateRealAbierto) {
    return new StubEmailAdapter();
  }

  return new ResendEmailAdapter({
    apiKey: apiKey as string,
    remitente: process.env.EMAIL_FROM_ADDRESS ?? REMITENTE_DEFAULT,
  });
}
