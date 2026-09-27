/**
 * Lectura del payload `link.created` de Fintoc (canal ad-hoc del widget).
 * =============================================================================
 *
 * Es la ÚNICA vez que el `link_token` existe. Cita literal de la doc
 * (docs.fintoc.com/reference/link-object): «This attribute will only be returned
 * when creating a Link. After that, this field will always be null», y «the Link
 * Token is not saved by Fintoc, and can never be retrieved again».
 *
 * ⚠️ EL PARSEO ES DELIBERADAMENTE TOLERANTE. La página de la doc que describe el
 * cuerpo exacto de esta notificación está detrás del login del dashboard, así que
 * el anidamiento no se pudo verificar en la fuente oficial. Se buscan las cuatro
 * formas plausibles (`link_token` en la raíz, bajo `data`, bajo `link`, bajo
 * `data.link`) porque equivocarse aquí no es un bug recuperable: si no se
 * encuentra el token, se perdió para siempre. Cuando se confirme la forma real,
 * se puede estrechar — no antes.
 *
 * SEGURIDAD: el `link_token` devuelto va directo a `cifrarSecreto`. Nunca se
 * loguea, no se incluye en errores y no vuelve al cliente.
 */

/** Tipo de evento de la notificación de creación de Link. */
export const TIPO_EVENTO_LINK_CREADO = "link.created";

export interface LinkCreadoLeido {
  /** SECRETO — cifrar de inmediato. */
  linkToken: string;
  /** Alias legible y NO sensible de la cuenta (institución + últimos 4). */
  cuentaBancoAlias: string | null;
}

interface FormaLink {
  link_token?: unknown;
  institution?: { name?: string } | null;
  accounts?: Array<{
    number?: string | null;
    institution?: { name?: string } | string | null;
  }> | null;
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null;
}

/** Candidatos donde puede vivir el objeto Link, en orden de preferencia. */
function candidatos(payload: unknown): FormaLink[] {
  if (!esObjeto(payload)) return [];
  const data = payload.data;
  const link = payload.link;
  const dataLink = esObjeto(data) ? data.link : undefined;
  return [payload, data, link, dataLink].filter(esObjeto) as FormaLink[];
}

/**
 * Detecta si el payload es la notificación de creación de Link. La notificación
 * del canal ad-hoc puede venir SIN `type` (es el Link a secas), así que traer un
 * `link_token` también cuenta como señal.
 */
export function esPayloadLinkCreado(payload: unknown): boolean {
  if (!esObjeto(payload)) return false;
  const tipo = payload.type;
  if (typeof tipo === "string") {
    if (tipo === TIPO_EVENTO_LINK_CREADO || tipo === "link_created") return true;
    // Un `type` distinto y explícito manda: no es esto.
    return false;
  }
  return candidatos(payload).some((c) => typeof c.link_token === "string" && c.link_token !== "");
}

/**
 * Extrae `link_token` + alias del payload, o `null` si no viene el token.
 *
 * Devolver `null` (en vez de lanzar) es a propósito: quien llama responde 200
 * para que Fintoc no reintente en bucle, pero NO consume el ticket — una
 * notificación sin token no es la que traía el secreto.
 */
export function leerLinkCreado(payload: unknown): LinkCreadoLeido | null {
  for (const candidato of candidatos(payload)) {
    const token = candidato.link_token;
    if (typeof token === "string" && token.trim() !== "") {
      return { linkToken: token, cuentaBancoAlias: construirAliasCuenta(candidato) };
    }
  }
  return null;
}

/**
 * Alias legible y NO sensible de la cuenta conectada, para la tarjeta de "banco
 * conectado": institución + número enmascarado. Nunca incluye el `link_token` ni
 * el RUT del titular.
 */
export function construirAliasCuenta(link: {
  institution?: { name?: string } | null;
  accounts?: Array<{
    number?: string | null;
    institution?: { name?: string } | string | null;
  }> | null;
}): string | null {
  const cuenta = link.accounts?.[0] ?? null;
  const institucion =
    link.institution?.name ??
    (typeof cuenta?.institution === "string" ? cuenta.institution : cuenta?.institution?.name) ??
    null;
  const numero = cuenta?.number ?? null;
  const numeroEnmascarado = numero ? `••••${numero.slice(-4)}` : null;

  const partes = [institucion, numeroEnmascarado].filter(Boolean);
  return partes.length > 0 ? partes.join(" ") : null;
}
