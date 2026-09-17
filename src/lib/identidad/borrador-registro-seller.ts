/**
 * Borrador firmado de "intent=registro-seller" — RF-010 rediseño (alta de
 * seller por autoservicio).
 * =============================================================================
 * Mismo problema que resolvió F1 para el alta de empresa (ver
 * `borrador-registro.ts`) y F3 para la aceptación de invitación (ver
 * `borrador-invitacion.ts`), ahora para el auto-registro de sellers: entre
 * que el visitante hace clic en "Continuar con Google" desde la landing
 * pública de un enlace de courier y que Google lo devuelve al callback, hace
 * falta que el `tenantId` del enlace (y el propio token, para poder volver a
 * la landing si algo falla) sobrevivan ese viaje.
 *
 * MISMO molde que `borrador-registro.ts`/`borrador-invitacion.ts` (cookie
 * `HMAC-SHA256`, `<cuerpo_base64url>.<firma_base64url>`, comparación en
 * tiempo constante, firmada con `SUPABASE_SERVICE_ROLE_KEY`) — no se
 * reinventa el cálculo, solo se adapta el contenido.
 *
 * Nombre de cookie PROPIO (`rutax_registro_seller`), nunca el de los otros
 * dos borradores: son tres flujos distintos que en teoría pueden convivir en
 * el mismo navegador.
 *
 * `sameSite: "lax"` por la misma razón que los otros dos borradores: el
 * camino Google sale del sitio y vuelve con una navegación de nivel superior
 * desde OTRO origen — `SameSite=Strict` no mandaría esta cookie en ese `GET`
 * de vuelta.
 *
 * Un solo uso: se cumple BORRANDO la cookie tras consumirla con éxito
 * (`limpiarBorrador`, invocado por el llamador) — el callback la lee y la
 * limpia en la MISMA respuesta, sin importar cuál de sus tres desenlaces
 * tome (arranca el wizard, entra idempotente, o rebota con error).
 */

import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";

/** Nombre de la cookie del borrador de intent de registro de seller. */
export const COOKIE_BORRADOR_REGISTRO_SELLER = "rutax_registro_seller";

/** Tiempo de sobra para ir y volver de Google sin dejar el intent vivo indefinidamente. */
export const DURACION_BORRADOR_REGISTRO_SELLER_MINUTOS = 30;

/** Forma del borrador — el `tenantId` ya viene RESUELTO (la landing ya validó el token). */
export interface BorradorRegistroSeller {
  tenantId: string;
  /** El token del enlace — solo para poder redirigir de vuelta a la landing si algo falla. */
  enlaceToken: string;
}

interface PayloadBorrador extends BorradorRegistroSeller {
  /** Epoch ms de expiración. */
  exp: number;
}

// -----------------------------------------------------------------------------
// Firma HMAC — mismo cálculo que `borrador-registro.ts`/`borrador-invitacion.ts`.
// -----------------------------------------------------------------------------

function resolverSecretoFirma(): string {
  const secreto = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secreto) {
    throw new Error(
      "No se puede firmar el borrador de registro de seller: falta SUPABASE_SERVICE_ROLE_KEY en este entorno.",
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

function firmarPayload(payload: PayloadBorrador): string {
  const secreto = resolverSecretoFirma();
  const cuerpo = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const firma = createHmac("sha256", secreto).update(cuerpo).digest("base64url");
  return `${cuerpo}.${firma}`;
}

function verificarYExtraerPayload(token: string): PayloadBorrador | null {
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
    const bruto = JSON.parse(Buffer.from(cuerpo, "base64url").toString("utf8")) as Partial<PayloadBorrador>;
    if (
      typeof bruto.tenantId !== "string" ||
      typeof bruto.enlaceToken !== "string" ||
      typeof bruto.exp !== "number"
    ) {
      return null;
    }
    return { tenantId: bruto.tenantId, enlaceToken: bruto.enlaceToken, exp: bruto.exp };
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// API pública
// -----------------------------------------------------------------------------

/** Firma y guarda el borrador en una cookie httpOnly, ANTES de mandar a Google. */
export async function guardarBorrador(datos: BorradorRegistroSeller): Promise<void> {
  const exp = Date.now() + DURACION_BORRADOR_REGISTRO_SELLER_MINUTOS * 60_000;
  const token = firmarPayload({ ...datos, exp });

  const almacenCookies = await cookies();
  almacenCookies.set(COOKIE_BORRADOR_REGISTRO_SELLER, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: DURACION_BORRADOR_REGISTRO_SELLER_MINUTOS * 60,
  });
}

/** Lee el borrador vigente, o `null` si no hay cookie, si la firma no calza, o si venció. */
export async function leerBorrador(): Promise<BorradorRegistroSeller | null> {
  const almacenCookies = await cookies();
  const cookie = almacenCookies.get(COOKIE_BORRADOR_REGISTRO_SELLER);
  if (!cookie?.value) return null;

  const payload = verificarYExtraerPayload(cookie.value);
  if (!payload || payload.exp <= Date.now()) return null;

  const { exp, ...datos } = payload;
  void exp;
  return datos;
}

/** Borra la cookie del borrador — "de un solo uso". Best-effort en contextos de solo lectura. */
export async function limpiarBorrador(): Promise<void> {
  const almacenCookies = await cookies();
  try {
    almacenCookies.delete(COOKIE_BORRADOR_REGISTRO_SELLER);
  } catch {
    // No-op — ver nota de `borrador-registro.ts`.
  }
}
