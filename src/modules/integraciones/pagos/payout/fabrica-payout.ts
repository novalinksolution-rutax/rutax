/**
 * Fábrica del puerto de PAYOUTS SALIENTES.
 * =============================================================================
 *
 * Patrón idéntico a `obtenerPuertoDte` / `crearPuertoConciliacionPagos`: resuelve
 * config + credenciales y devuelve el adaptador concreto; el núcleo (`dinero`)
 * trabaja solo contra `PuertoPayout`.
 *
 * GATE SANDBOX/REAL (molde del DTE — el corazón de seguridad de F19):
 *   Se devuelve el adaptador REAL (Fintoc) que mueve plata SOLO si se cumplen
 *   AMBAS condiciones:
 *     1. `PAYOUT_SANDBOX_MODE=false` (bandera de PLATAFORMA, la fija `devops`).
 *     2. `courier_config_payout.payout_real_habilitado = true` (opt-in del
 *        TENANT, default false en la migración).
 *   Si falta CUALQUIERA → se devuelve el `StubPayoutAdapter` (registra, NO
 *   transfiere). Es exactamente el molde de `DTE_SANDBOX_MODE` +
 *   `emision_dte_real_habilitada`.
 *
 *   Además, el método `manual` SIEMPRE usa `ManualPayoutAdapter`
 *   (independiente del gate): no transfiere por API, el courier paga por fuera y
 *   registra el comprobante.
 *
 * MODELO DE SECRETOS (NO inventar mecanismo nuevo — sigue ML/DTE/cobranza):
 *   - La secret key de la ORG Fintoc es de PLATAFORMA (env `FINTOC_SECRET_KEY`),
 *     no por-tenant — igual que en cobranza.
 *   - Las `credenciales_payout` POR-TENANT (`account_id` origen y la clave de
 *     firma JWS `payout_clave_firma_privada`) viven cifradas en
 *     `identidad.secretos_cifrados` (tipo `credenciales_payout`) como un único
 *     JSON cifrado `{ account_id, payout_clave_firma_privada }` y se descifran EN
 *     EL PUNTO DE USO con el módulo `secretos`. Nunca se loguean. La clave de
 *     firma es la PRIVADA del par RSA que el courier enrola (pública) en Fintoc.
 */

import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { descifrarSecreto } from "../../secretos";
import { comoReferenciaSecreto } from "../../secretos/tipos";
import type { PuertoPayout } from "./puerto-payout";
import { ErrorPayoutConfig } from "./errores";
import { StubPayoutAdapter } from "./adaptadores/stub";
import { ManualPayoutAdapter } from "./adaptadores/manual";
import { FintocPayoutAdapter, FINTOC_PAYOUT_BASE_URL } from "./adaptadores/fintoc";

/** Método de pago saliente — espejo del CHECK de `courier_config_payout.metodo_default`. */
export type MetodoPayout = "fintoc" | "manual" | "nomina";

/**
 * ¿El modo sandbox de PLATAFORMA está activo? Default SÍ (sandbox): solo el
 * valor literal `"false"` lo desactiva. Ausente, vacío o cualquier otro valor →
 * sandbox. Es la misma semántica de seguridad-por-defecto que `DTE_SANDBOX_MODE`.
 */
export function payoutSandboxActivo(): boolean {
  return process.env.PAYOUT_SANDBOX_MODE !== "false";
}

/** Lee la secret key de la organización Fintoc desde el entorno (de plataforma). */
function leerSecretKeyOrg(): string | null {
  return process.env.FINTOC_SECRET_KEY ?? process.env.FINTOC_SECRET_KEY_TEST ?? null;
}

/** Forma interna de la fila de config de payout del tenant. */
interface FilaConfigPayout {
  tenant_id: string;
  payout_real_habilitado: boolean;
  metodo_default: MetodoPayout;
  porcentaje_retencion: number;
}

async function leerConfigPayout(tenantId: string): Promise<FilaConfigPayout> {
  const supabase = crearClienteServiceRole();
  const { data, error } = await supabase
    .schema("identidad")
    .from("courier_config_payout")
    .select("tenant_id, payout_real_habilitado, metodo_default, porcentaje_retencion")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    // Solo el mensaje de BD — sin secretos en el texto.
    throw new ErrorPayoutConfig(`error al leer configuración de payout: ${error.message}`);
  }
  if (!data) {
    throw new ErrorPayoutConfig(
      "no existe configuración de payout — el courier debe completar la configuración de pagos a conductores",
    );
  }
  return data as unknown as FilaConfigPayout;
}

/**
 * Datos del adaptador necesarios para construir el puerto, resueltos por la
 * fábrica. Permite inyectar config y credenciales en tests sin tocar la BD.
 */
export interface ResolverPayoutOpts {
  /** Override de config (tests). Si se omite, se lee de `courier_config_payout`. */
  config?: FilaConfigPayout;
  /**
   * `account_id` origen del courier YA DESCIFRADO (tests / punto de uso). Si se
   * omite y el método es `fintoc` real, la fábrica lo descifra de
   * `credenciales_payout`.
   */
  accountIdOrigen?: string | null;
  /**
   * Clave PRIVADA de firma JWS (PEM) YA DESCIFRADA (tests / punto de uso). Si se
   * omite y el método es `fintoc` real, la fábrica la descifra de
   * `credenciales_payout` (`payout_clave_firma_privada`). NUNCA se loguea.
   */
  clavePrivadaFirmaPem?: string | null;
  /** Base URL inyectable para tests; default = producción Fintoc v2. */
  baseUrl?: string;
}

/**
 * Devuelve el adaptador de payout para el tenant aplicando el gate sandbox/real.
 *
 * - `metodo_default = 'manual'` o `'nomina'` → `ManualPayoutAdapter` (sin API).
 *   (`nomina` se trata como manual en el MVP: el courier paga vía su sistema de
 *   remuneraciones y registra el comprobante; sin adaptador de nómina aún.)
 * - `metodo_default = 'fintoc'`:
 *     · gate completo (sandbox OFF + opt-in del tenant ON) → `FintocPayoutAdapter`.
 *     · gate incompleto → `StubPayoutAdapter` (NO transfiere). Seguridad por defecto.
 */
export async function obtenerPuertoPayout(
  tenantId: string,
  opts: ResolverPayoutOpts = {},
): Promise<PuertoPayout> {
  const config = opts.config ?? (await leerConfigPayout(tenantId));
  const baseUrl = opts.baseUrl ?? FINTOC_PAYOUT_BASE_URL;

  // El método manual/nómina nunca pasa por API: el courier paga por fuera.
  if (config.metodo_default === "manual" || config.metodo_default === "nomina") {
    return new ManualPayoutAdapter();
  }

  // Método fintoc: aplica el gate sandbox/opt-in. Si NO está completo → stub.
  const gateRealAbierto = !payoutSandboxActivo() && config.payout_real_habilitado === true;
  if (!gateRealAbierto) {
    return new StubPayoutAdapter();
  }

  // Gate real abierto: construir el adaptador Fintoc con secretos resueltos.
  // Tanto `account_id` como la clave de firma viven en el MISMO JSON cifrado;
  // se descifran de una sola vez salvo que el test los inyecte explícitamente.
  const secretKeyOrg = leerSecretKeyOrg();

  const debeDescifrar =
    opts.accountIdOrigen === undefined || opts.clavePrivadaFirmaPem === undefined;
  const credenciales = debeDescifrar
    ? await resolverCredencialesPayout(tenantId)
    : { accountId: null, clavePrivadaFirmaPem: null };

  const accountIdOrigen =
    opts.accountIdOrigen !== undefined ? opts.accountIdOrigen : credenciales.accountId;
  const clavePrivadaFirmaPem =
    opts.clavePrivadaFirmaPem !== undefined
      ? opts.clavePrivadaFirmaPem
      : credenciales.clavePrivadaFirmaPem;

  return new FintocPayoutAdapter(
    { secretKeyOrg, accountIdOrigen, clavePrivadaFirmaPem },
    baseUrl,
  );
}

/** Forma interna de la fila que referencia las credenciales cifradas del payout. */
interface FilaCredencialesPayout {
  credenciales_payout_ref: string | null;
}

/** Credenciales de payout del tenant ya descifradas — SOLO para uso inmediato. */
interface CredencialesPayoutDescifradas {
  /** `account_id` de la cuenta ORIGEN del courier. `null` si no configurada. */
  accountId: string | null;
  /** Clave PRIVADA de firma JWS en PEM. `null` si el courier no la enroló. */
  clavePrivadaFirmaPem: string | null;
}

/**
 * Descifra las `credenciales_payout` del tenant y extrae el `account_id` origen
 * y la clave privada de firma JWS (`payout_clave_firma_privada`). Las
 * credenciales se guardan como UN solo JSON cifrado
 * `{ account_id, payout_clave_firma_privada }`. El valor en claro es SOLO para
 * uso inmediato — nunca se loguea ni se persiste.
 *
 * NOTA: la columna de referencia (`credenciales_payout_ref`) la añadirá `backend`
 * al cablear la pantalla de configuración de pagos; mientras no exista, esta
 * función devuelve `null`/`null` y el adaptador Fintoc lanza `ErrorPayoutConfig`
 * (no reintentable), lo correcto: no se transfiere sin cuenta origen NI sin la
 * clave de firma exigida por Fintoc para transferencias salientes.
 */
async function resolverCredencialesPayout(
  tenantId: string,
): Promise<CredencialesPayoutDescifradas> {
  const vacio: CredencialesPayoutDescifradas = { accountId: null, clavePrivadaFirmaPem: null };

  const supabase = crearClienteServiceRole();
  const { data, error } = await supabase
    .schema("identidad")
    .from("courier_config_payout")
    .select("credenciales_payout_ref")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  // Si la columna aún no existe o no hay referencia → vacío (adaptador lanzará config).
  if (error || !data) return vacio;
  const fila = data as unknown as FilaCredencialesPayout;
  if (!fila.credenciales_payout_ref) return vacio;

  try {
    const resultado = await descifrarSecreto(comoReferenciaSecreto(fila.credenciales_payout_ref));
    if (typeof resultado.valor !== "string") return vacio;
    const parsed = JSON.parse(resultado.valor) as {
      account_id?: unknown;
      payout_clave_firma_privada?: unknown;
    };
    return {
      accountId: typeof parsed.account_id === "string" ? parsed.account_id : null,
      clavePrivadaFirmaPem:
        typeof parsed.payout_clave_firma_privada === "string"
          ? parsed.payout_clave_firma_privada
          : null,
    };
  } catch {
    // No propagar el error de descifrado (podría incluir fragmentos del cifrado).
    throw new ErrorPayoutConfig(
      "no se pudieron descifrar las credenciales de payout — verifica la clave de cifrado del despliegue",
    );
  }
}
