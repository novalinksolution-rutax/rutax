/**
 * Fábrica del puerto de AUTO-COBRO RECURRENTE (suscripción Rutax → courier).
 * =============================================================================
 * Gate SEGURO POR DEFECTO, molde de `fabrica-payout.ts` (sandbox + opt-in):
 *
 *   Se devuelve el adaptador REAL (Fintoc, que cobra de verdad) SOLO si se
 *   cumplen las TRES condiciones:
 *     1. `SUSCRIPCION_RECURRENTE_SANDBOX_MODE === 'false'` (bandera de PLATAFORMA,
 *        la fija `devops`).
 *     2. `autoCobroHabilitado === true` — opt-in del TENANT. El backend lo lee de
 *        `plataforma.suscripciones.auto_cobro_habilitado` (default false) y lo pasa
 *        como argumento; la fábrica NO toca la BD (mantiene el aislamiento del
 *        adaptador y su testeabilidad sin Supabase).
 *     3. `FINTOC_SECRET_KEY` presente (la secret key de la ORG Fintoc, la misma
 *        que payout/checkout).
 *   Si falta CUALQUIERA → `StubSuscripcionRecurrenteAdapter` (NO cobra). Es el
 *   mismo molde de `DTE_SANDBOX_MODE`+opt-in y `PAYOUT_SANDBOX_MODE`+opt-in.
 *
 * La secret key es de ORGANIZACIÓN (`FINTOC_SECRET_KEY`): una sola cuenta Fintoc
 * de Rutax cobra a todos los couriers. El opt-in, en cambio, es POR-TENANT (cada
 * courier autoriza el auto-cobro por separado).
 */

import type { PuertoSuscripcionRecurrente } from './puerto-suscripcion-recurrente';
import { StubSuscripcionRecurrenteAdapter } from './adaptadores/stub';
import { FintocSuscripcionRecurrenteAdapter, FINTOC_SUSCRIPCION_BASE_URL } from './adaptadores/fintoc';

/**
 * ¿El modo sandbox del auto-cobro recurrente está activo? Default SÍ (sandbox):
 * solo el literal `"false"` lo desactiva. Ausente, vacío o cualquier otro valor →
 * sandbox. Misma semántica de seguridad-por-defecto que `PAYOUT_SANDBOX_MODE`.
 */
export function suscripcionRecurrenteSandboxActivo(): boolean {
  return process.env.SUSCRIPCION_RECURRENTE_SANDBOX_MODE !== 'false';
}

/** Lee la secret key de la organización Fintoc desde el entorno (de plataforma). */
function leerSecretKeyOrg(): string | null {
  return process.env.FINTOC_SECRET_KEY ?? process.env.FINTOC_SECRET_KEY_TEST ?? null;
}

export interface ResolverSuscripcionRecurrenteOpts {
  /** Opt-in del tenant (`plataforma.suscripciones.auto_cobro_habilitado`). Lo pasa el backend. */
  autoCobroHabilitado: boolean;
  /** Fuerza el adaptador real (tests). Si se omite, aplica el gate por env + opt-in. */
  forzarReal?: boolean;
  /** Secret key inyectable (tests). Si se omite, se lee del entorno. */
  secretKeyOrg?: string | null;
  /** Base de la app inyectable (tests) para `success_url`/`cancel_url`. */
  appBaseUrl?: string | null;
  /** Base URL de Fintoc inyectable (tests). */
  baseUrl?: string;
}

/**
 * Devuelve el adaptador de auto-cobro recurrente aplicando el gate sandbox +
 * opt-in. Con el gate incompleto (sandbox, sin opt-in del tenant, o sin secret
 * key) devuelve el stub, que NO cobra. Fail-safe: cualquier condición faltante →
 * stub.
 */
export function obtenerPuertoSuscripcionRecurrente(
  opts: ResolverSuscripcionRecurrenteOpts,
): PuertoSuscripcionRecurrente {
  const secretKeyOrg = opts.secretKeyOrg !== undefined ? opts.secretKeyOrg : leerSecretKeyOrg();

  const gateRealAbierto =
    opts.forzarReal ??
    (!suscripcionRecurrenteSandboxActivo() && opts.autoCobroHabilitado === true && !!secretKeyOrg);

  if (!gateRealAbierto) {
    return new StubSuscripcionRecurrenteAdapter();
  }

  return new FintocSuscripcionRecurrenteAdapter(
    { secretKeyOrg, appBaseUrl: opts.appBaseUrl ?? null },
    opts.baseUrl ?? FINTOC_SUSCRIPCION_BASE_URL,
  );
}
