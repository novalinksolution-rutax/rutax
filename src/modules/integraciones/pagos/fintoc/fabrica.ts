/**
 * Fábrica del puerto de conciliación de pagos (Fintoc).
 * =============================================================================
 *
 * Patrón idéntico a `obtenerPuertoDte` / `intercambiarCodigoPorTokens` de ML:
 * la fábrica resuelve credenciales y devuelve el adaptador concreto; el núcleo
 * de `dinero` trabaja solo contra `PuertoConciliacionPagos`.
 *
 * MODELO DE SECRETOS (NO inventar un mecanismo nuevo — sigue ML/DTE):
 *  - La **secret key de la ORGANIZACIÓN** Fintoc (`sk_…`) NO es por-tenant: una
 *    sola org (la del fundador) lee todas las cuentas conectadas. Igual que el
 *    `client_id`/`client_secret` de la app de ML, vive como variable de entorno
 *    de plataforma (`FINTOC_SECRET_KEY`), no en `secretos_cifrados`. `devops` la
 *    rota; nunca se loguea.
 *  - El **`link_token`** y el **secreto de webhook** SÍ son por-tenant: viven
 *    cifrados en `identidad.secretos_cifrados`, referenciados desde
 *    `identidad.courier_config_cobranza` (`link_token_ref`, `secreto_webhook_ref`).
 *    Se descifran con el módulo `secretos` (tipos `token_link_fintoc` /
 *    `secreto_webhook_fintoc`) EN EL PUNTO DE USO y se pasan descifrados al
 *    método del puerto (`listarMovimientos({ linkToken })`,
 *    `validarFirmaWebhook({ secretoWebhook })`) — el patrón exacto de ML, donde
 *    quien llama pasa el secreto descifrado al puerto.
 *
 * Por eso esta fábrica:
 *  - `crearPuertoConciliacionPagos(tenantId)` → adaptador con la secret key de
 *    la org (auth). El `tenantId` se acepta por simetría con `obtenerPuertoDte`
 *    y para futura selección de proveedor/modo por tenant, pero la secret key de
 *    org es compartida.
 *  - `resolverLinkTokenTenant(tenantId)` / `resolverSecretoWebhookTenant(tenantId)`
 *    → helpers que descifran el secreto POR-TENANT cuando el llamador (job de
 *    ingesta / endpoint de webhook, ambos de `backend`) lo necesita. Devuelven
 *    el valor en claro SOLO para uso inmediato — nunca se loguea ni se persiste.
 */

import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { descifrarSecreto } from "../../secretos";
import { comoReferenciaSecreto } from "../../secretos/tipos";
import type { PuertoConciliacionPagos } from "../puerto";
import { ErrorConfigCobranzaAusente } from "../errores";
import { FintocAdapter, FINTOC_BASE_URL } from "./adaptador";

/**
 * Lee la secret key de la organización Fintoc desde el entorno. NO es por-tenant
 * (una sola org del fundador) — por eso no pasa por `secretos_cifrados`. Soporta
 * `sk_test_…` (modo prueba) y `sk_live_…` (producción); el modo lo determina el
 * prefijo de la propia key, no una bandera aparte.
 */
export function leerSecretKeyOrg(): string {
  const key =
    process.env.FINTOC_SECRET_KEY ??
    process.env.FINTOC_SECRET_KEY_TEST ??
    null;
  if (!key) {
    throw new Error(
      "Falta la secret key de la organización Fintoc (FINTOC_SECRET_KEY). " +
        "Configúrala vía el gestor de secretos del despliegue — nunca se loguea su valor.",
    );
  }
  return key;
}

/**
 * Devuelve el adaptador de pagos para el tenant. La secret key de la org (auth)
 * se resuelve desde el entorno; los secretos por-tenant (link_token, secreto de
 * webhook) los resuelve el llamador con los helpers de abajo y los pasa
 * descifrados a los métodos del puerto (patrón ML).
 *
 * `baseUrl` es inyectable para tests; default = producción de Fintoc.
 */
export function crearPuertoConciliacionPagos(
  tenantId: string,
  baseUrl: string = FINTOC_BASE_URL,
): PuertoConciliacionPagos {
  // `tenantId` se acepta por simetría con `obtenerPuertoDte` (y futura selección
  // de proveedor/modo por tenant). La secret key de la org es compartida.
  void tenantId;
  return new FintocAdapter(leerSecretKeyOrg(), baseUrl);
}

/** Forma interna de la fila de config de cobranza. */
interface FilaConfigCobranza {
  tenant_id: string;
  link_token_ref: string | null;
  secreto_webhook_ref: string | null;
  estado_conexion: string;
}

async function leerConfigCobranza(tenantId: string): Promise<FilaConfigCobranza> {
  const supabase = crearClienteServiceRole();
  const { data, error } = await supabase
    .schema("identidad")
    .from("courier_config_cobranza")
    .select("tenant_id, link_token_ref, secreto_webhook_ref, estado_conexion")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    throw new ErrorConfigCobranzaAusente(
      tenantId,
      // Solo el mensaje de BD — sin secretos en el texto.
      `error al leer configuración de cobranza: ${error.message}`,
    );
  }
  if (!data) {
    throw new ErrorConfigCobranzaAusente(
      tenantId,
      "no existe configuración de cobranza — el courier debe conectar su banco (Fintoc)",
    );
  }
  return data as unknown as FilaConfigCobranza;
}

/**
 * Descifra y devuelve el `link_token` del tenant (cuenta bancaria conectada).
 * El valor en claro es SOLO para uso inmediato en `listarMovimientos` — nunca
 * se loguea, no se persiste y no se incluye en errores.
 */
export async function resolverLinkTokenTenant(tenantId: string): Promise<string> {
  const fila = await leerConfigCobranza(tenantId);
  if (!fila.link_token_ref) {
    throw new ErrorConfigCobranzaAusente(
      tenantId,
      "la conexión de cobranza no tiene link_token — el courier debe (re)conectar su banco",
    );
  }
  return descifrarSecretoTexto(fila.link_token_ref, tenantId, "link_token");
}

/**
 * Descifra y devuelve el secreto de webhook del tenant (valida `Fintoc-Signature`).
 * El valor en claro es SOLO para uso inmediato en `validarFirmaWebhook`.
 */
export async function resolverSecretoWebhookTenant(tenantId: string): Promise<string> {
  const fila = await leerConfigCobranza(tenantId);
  if (!fila.secreto_webhook_ref) {
    throw new ErrorConfigCobranzaAusente(
      tenantId,
      "la conexión de cobranza no tiene secreto de webhook configurado",
    );
  }
  return descifrarSecretoTexto(fila.secreto_webhook_ref, tenantId, "secreto_webhook");
}

/**
 * Descifra una referencia de secreto y verifica que sea texto. NO propaga el
 * error original de descifrado (podría incluir fragmentos del valor cifrado);
 * lanza un error operativo propio sin datos sensibles.
 */
async function descifrarSecretoTexto(
  referencia: string,
  tenantId: string,
  etiqueta: string,
): Promise<string> {
  try {
    const resultado = await descifrarSecreto(comoReferenciaSecreto(referencia));
    if (typeof resultado.valor !== "string") {
      throw new Error("no es texto");
    }
    return resultado.valor;
  } catch {
    throw new ErrorConfigCobranzaAusente(
      tenantId,
      `no se pudo descifrar el secreto de cobranza (${etiqueta}) — ` +
        "verifica la clave de cifrado del despliegue",
    );
  }
}
