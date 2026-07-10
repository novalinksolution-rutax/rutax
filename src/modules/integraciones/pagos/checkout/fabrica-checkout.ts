/**
 * Fábrica del puerto de CHECKOUT de suscripción.
 * =============================================================================
 * Molde del gate sandbox/real de `fabrica-payout.ts` / DTE:
 *
 *   Se devuelve el adaptador REAL (Fintoc, que genera un link de cobro real)
 *   SOLO si se cumplen AMBAS:
 *     1. `SUSCRIPCION_SANDBOX_MODE=false` (bandera de PLATAFORMA, la fija devops).
 *     2. `FINTOC_SECRET_KEY` presente (la secret key de la ORG Fintoc).
 *   En cualquier otro caso → `StubCheckoutAdapter` (link ficticio, NO cobra).
 *
 * A diferencia del payout, aquí NO hay opt-in por-tenant: el cobro de la
 * suscripción es una decisión de la PLATAFORMA (Rutax cobra a los couriers),
 * no de cada courier. El gate es solo la bandera de plataforma + la credencial.
 *
 * La secret key es de ORGANIZACIÓN (`FINTOC_SECRET_KEY`), la MISMA que usa el
 * payout — una sola cuenta Fintoc de Rutax cobra a todos los couriers.
 */

import type { PuertoCheckoutSuscripcion } from './puerto-checkout';
import { StubCheckoutAdapter } from './adaptadores/stub';
import { FintocCheckoutAdapter, FINTOC_CHECKOUT_BASE_URL } from './adaptadores/fintoc';

/**
 * ¿El modo sandbox de la suscripción está activo? Default SÍ (sandbox): solo el
 * literal `"false"` lo desactiva. Misma semántica de seguridad-por-defecto que
 * `PAYOUT_SANDBOX_MODE` / `DTE_SANDBOX_MODE`.
 */
export function suscripcionSandboxActivo(): boolean {
  return process.env.SUSCRIPCION_SANDBOX_MODE !== 'false';
}

/** Lee la secret key de la organización Fintoc desde el entorno (de plataforma). */
function leerSecretKeyOrg(): string | null {
  return process.env.FINTOC_SECRET_KEY ?? process.env.FINTOC_SECRET_KEY_TEST ?? null;
}

export interface ResolverCheckoutOpts {
  /** Fuerza el adaptador real (tests). Si se omite, aplica el gate por env. */
  forzarReal?: boolean;
  /** Secret key inyectable (tests). */
  secretKeyOrg?: string | null;
  /** Base URL inyectable (tests). */
  baseUrl?: string;
}

/**
 * Devuelve el adaptador de checkout aplicando el gate sandbox/real. Con el gate
 * cerrado (sandbox o sin secret key) devuelve el stub, que NO cobra.
 */
export function obtenerPuertoCheckout(opts: ResolverCheckoutOpts = {}): PuertoCheckoutSuscripcion {
  const secretKeyOrg = opts.secretKeyOrg !== undefined ? opts.secretKeyOrg : leerSecretKeyOrg();
  const gateRealAbierto = opts.forzarReal ?? (!suscripcionSandboxActivo() && !!secretKeyOrg);

  if (!gateRealAbierto) {
    return new StubCheckoutAdapter();
  }

  return new FintocCheckoutAdapter(secretKeyOrg, opts.baseUrl ?? FINTOC_CHECKOUT_BASE_URL);
}
