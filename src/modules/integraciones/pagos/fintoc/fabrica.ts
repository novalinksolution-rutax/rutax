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
import { ErrorConfigCobranzaAusente, ErrorPagosProveedor } from "../errores";
import { FintocAdapter, FINTOC_BASE_URL } from "./adaptador";

/**
 * Lee la secret key de la organización Fintoc desde el entorno. NO es por-tenant
 * (una sola org del fundador) — por eso no pasa por `secretos_cifrados`. Soporta
 * `sk_test_…` (modo prueba) y `sk_live_…` (producción); el modo lo determina el
 * prefijo de la propia key, no una bandera aparte.
 */
function leerSecretKeyOrg(): string {
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

/**
 * Resultado del canje del `exchange_token` del widget de Fintoc por un Link.
 * Es lo ÚNICO que vuelve a la Server Action de onboarding: el `linkToken` (que
 * ella cifra de inmediato con el módulo `secretos`) y metadatos NO sensibles del
 * primer account para mostrar un alias legible. NUNCA se loguea el `linkToken`.
 */
export interface CanjeExchangeTokenResultado {
  /** `link_token` de la cuenta conectada (SECRETO — cifrar y nunca exponer). */
  linkToken: string;
  /** Alias legible de la cuenta (institución + número enmascarado), o null. */
  cuentaBancoAlias: string | null;
}

/**
 * Canjea el `exchange_token` que devuelve el widget de Fintoc por el `Link`
 * permanente, vía la API de Fintoc (`POST /v1/links/exchange`). El núcleo/UI
 * NUNCA llama a Fintoc directo — esta función (módulo `integraciones`) es la
 * única puerta. La secret key de la org va en el body (contrato de Fintoc para
 * este endpoint) y JAMÁS se loguea ni se propaga a un error.
 *
 * Devuelve el `link_token` en claro SOLO para que la Server Action lo cifre de
 * inmediato con el módulo `secretos` y persista la referencia opaca; nunca se
 * persiste ni se loguea en claro.
 *
 * @param baseUrl inyectable para tests; default = producción de Fintoc.
 */
export async function canjearExchangeToken(
  exchangeToken: string,
  baseUrl: string = FINTOC_BASE_URL,
): Promise<CanjeExchangeTokenResultado> {
  const secretKey = leerSecretKeyOrg();

  const respuesta = await fetch(`${baseUrl}/links/exchange`, {
    method: "POST",
    headers: {
      // Auth verificada en vivo: secret key DIRECTA, sin prefijo "Bearer".
      Authorization: secretKey,
      accept: "application/json",
      "content-type": "application/json",
    },
    // El endpoint de canje espera el secret key también en el body (contrato
    // Fintoc). No se loguea este body en ninguna parte.
    body: JSON.stringify({ exchange_token: exchangeToken, secret_key: secretKey }),
  });

  if (!respuesta.ok) {
    const cuerpo = (await respuesta.json().catch(() => null)) as
      | { error?: { message?: string; code?: string } }
      | null;
    const detalle =
      cuerpo?.error?.message ?? cuerpo?.error?.code ?? "sin detalle del proveedor";
    // El mensaje NO incluye el exchange_token ni la secret key.
    throw new ErrorPagosProveedor(respuesta.status, `Fintoc rechazó el canje del token: ${detalle}`);
  }

  const link = (await respuesta.json().catch(() => null)) as {
    link_token?: string;
    institution?: { name?: string } | null;
    accounts?: Array<{
      number?: string | null;
      holder_id?: string | null;
      institution?: { name?: string } | string | null;
    }> | null;
  } | null;

  if (!link?.link_token) {
    throw new ErrorPagosProveedor(
      502,
      "Fintoc no devolvió un link_token al canjear el token de conexión.",
    );
  }

  return {
    linkToken: link.link_token,
    cuentaBancoAlias: construirAliasCuenta(link),
  };
}

/**
 * Construye un alias legible y NO sensible de la cuenta conectada para mostrar
 * en la tarjeta de "banco conectado": institución + número enmascarado. Nunca
 * incluye el `link_token` ni el RUT completo del titular.
 */
function construirAliasCuenta(link: {
  institution?: { name?: string } | null;
  accounts?: Array<{
    number?: string | null;
    institution?: { name?: string } | string | null;
  }> | null;
}): string | null {
  const cuenta = link.accounts?.[0] ?? null;
  const institucion =
    link.institution?.name ??
    (typeof cuenta?.institution === "string"
      ? cuenta.institution
      : cuenta?.institution?.name) ??
    null;
  const numero = cuenta?.number ?? null;
  const numeroEnmascarado = numero ? `••••${numero.slice(-4)}` : null;

  const partes = [institucion, numeroEnmascarado].filter(Boolean);
  return partes.length > 0 ? partes.join(" ") : null;
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
