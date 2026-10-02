/**
 * Intención de registro del courier — cookie firmada.
 * =============================================================================
 * Reemplaza al borrador de empresa (`borrador-registro.ts`, retirado en el
 * registro v2). Ya no viaja ningún dato de la empresa por aquí: «Crea tu cuenta»
 * solo identifica a la persona (Google o código), y la empresa se pide después,
 * en `/registro/empresa`, con la sesión ya viva.
 *
 * Lo que SÍ guarda es lo único que no se puede reconstruir después: **qué
 * aviso de términos vio la persona al pulsar el botón, y cuándo**. Sin casilla,
 * el clic en «Continuar con Google» / «Enviar código» ES la aceptación, y su
 * evidencia (hallazgo H1 de seguridad-cumplimiento) es esta tripleta:
 *
 *   · `terminosVersion` / `privacidadVersion` — las que estaban vigentes
 *     (`src/lib/legal/versiones.ts`), leídas EN EL SERVIDOR; el cliente no las
 *     manda, así que no las puede falsear.
 *   · `aceptadoEn` — el instante del clic, también del servidor.
 *
 * Al crear la empresa se copian a `identidad.tenants.terminos_*`
 * (migración `20261001000002`) y esta cookie se borra.
 *
 * Además sirve de **señal de intención** para `/auth/callback`: hay intención y
 * la identidad no tiene perfil → `/registro/empresa`.
 *
 * Mecanismo: mismo molde que `borrador-invitacion.ts`/`soporte.ts` (HMAC-SHA256
 * con `SUPABASE_SERVICE_ROLE_KEY`, comparación en tiempo constante). `sameSite:
 * "lax"` y no `"strict"`: el camino Google vuelve con una navegación de nivel
 * superior desde otro origen, que `Strict` dejaría sin cookie.
 *
 * No es de un solo uso por nonce: se consume borrándola (`limpiarIntencion`)
 * al terminar el registro o al descubrir que ya no aplica.
 */

import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import { PRIVACIDAD, TERMINOS } from "@/lib/legal/versiones";

export const COOKIE_INTENCION_REGISTRO = "rutax_registro_intencion";

/**
 * Ventana de la intención. Cubre ir y volver de Google, escribir el código
 * (dura 10 min) y llenar «Tu empresa» sin apuro. Si vence, `/registro/empresa`
 * lo sabe y vuelve a mostrar el aviso de términos junto a «Continuar».
 */
export const DURACION_INTENCION_MINUTOS = 60;

export interface IntencionRegistro {
  terminosVersion: string;
  privacidadVersion: string;
  /** ISO 8601 del instante del clic. */
  aceptadoEn: string;
}

interface PayloadIntencion extends IntencionRegistro {
  exp: number;
}

function resolverSecretoFirma(): string {
  const secreto = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secreto) {
    throw new Error(
      "No se puede firmar la intención de registro: falta SUPABASE_SERVICE_ROLE_KEY en este entorno.",
    );
  }
  return secreto;
}

function compararTiempoConstante(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function firmarPayload(payload: PayloadIntencion): string {
  const cuerpo = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const firma = createHmac("sha256", resolverSecretoFirma()).update(cuerpo).digest("base64url");
  return `${cuerpo}.${firma}`;
}

/** `null` ante cualquier irregularidad (fail-closed, nunca lanza). */
function verificarYExtraerPayload(token: string): PayloadIntencion | null {
  if (!token || typeof token !== "string") return null;
  const separador = token.indexOf(".");
  if (separador === -1) return null;

  const cuerpo = token.slice(0, separador);
  const firmaRecibida = token.slice(separador + 1);
  if (!cuerpo || !firmaRecibida) return null;

  let secreto: string;
  try {
    secreto = resolverSecretoFirma();
  } catch {
    return null;
  }

  const firmaEsperada = createHmac("sha256", secreto).update(cuerpo).digest("base64url");
  if (!compararTiempoConstante(firmaEsperada, firmaRecibida)) return null;

  try {
    const bruto = JSON.parse(Buffer.from(cuerpo, "base64url").toString("utf8")) as Partial<PayloadIntencion>;
    if (
      typeof bruto.terminosVersion !== "string" ||
      !bruto.terminosVersion ||
      typeof bruto.privacidadVersion !== "string" ||
      !bruto.privacidadVersion ||
      typeof bruto.aceptadoEn !== "string" ||
      Number.isNaN(Date.parse(bruto.aceptadoEn)) ||
      typeof bruto.exp !== "number"
    ) {
      return null;
    }
    return {
      terminosVersion: bruto.terminosVersion,
      privacidadVersion: bruto.privacidadVersion,
      aceptadoEn: bruto.aceptadoEn,
      exp: bruto.exp,
    };
  } catch {
    return null;
  }
}

/** Firma y guarda la intención en una cookie httpOnly. */
export async function guardarIntencion(datos: IntencionRegistro): Promise<void> {
  const exp = Date.now() + DURACION_INTENCION_MINUTOS * 60_000;
  const token = firmarPayload({ ...datos, exp });

  const almacenCookies = await cookies();
  almacenCookies.set(COOKIE_INTENCION_REGISTRO, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: DURACION_INTENCION_MINUTOS * 60,
  });
}

/** La intención vigente, o `null` (sin cookie, firma que no calza, vencida). */
export async function leerIntencion(): Promise<IntencionRegistro | null> {
  const almacenCookies = await cookies();
  const cookie = almacenCookies.get(COOKIE_INTENCION_REGISTRO);
  if (!cookie?.value) return null;

  const payload = verificarYExtraerPayload(cookie.value);
  if (!payload || payload.exp <= Date.now()) return null;

  const { exp, ...datos } = payload;
  void exp;
  return datos;
}

/**
 * Borra la cookie. Best-effort: desde un Server Component Next no permite
 * mutar cookies y se ignora en silencio (mismo criterio que el resto).
 */
export async function limpiarIntencion(): Promise<void> {
  const almacenCookies = await cookies();
  try {
    almacenCookies.delete(COOKIE_INTENCION_REGISTRO);
  } catch {
    // No-op.
  }
}

/**
 * La intención «de ahora»: las versiones vigentes de los documentos legales
 * (las del servidor, no las que diga el cliente) y el instante actual.
 */
export function construirIntencionActual(ahora: Date = new Date()): IntencionRegistro {
  return {
    terminosVersion: TERMINOS.version,
    privacidadVersion: PRIVACIDAD.version,
    aceptadoEn: ahora.toISOString(),
  };
}

/**
 * Guarda la intención SOLO si no hay una vigente. El instante que importa es el
 * del primer clic: reenviar el código o volver a pulsar el botón no es una
 * aceptación nueva, y reescribirla movería la evidencia.
 */
export async function asegurarIntencion(): Promise<IntencionRegistro> {
  const previa = await leerIntencion();
  if (previa) return previa;
  const nueva = construirIntencionActual();
  await guardarIntencion(nueva);
  return nueva;
}
