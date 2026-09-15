/**
 * Borrador firmado de "aceptación de invitación" — F3 (login sin contraseña
 * de seller y equipo interno).
 * =============================================================================
 * Mismo problema que resolvió F1 para el alta de empresa (ver
 * `borrador-registro.ts`), ahora para la ACEPTACIÓN de invitación: entre que
 * el invitado hace clic en "Continuar con Google" y que Google lo devuelve al
 * callback, hace falta que el TOKEN de la invitación (y, si es un seller, su
 * opt-in de WhatsApp) sobrevivan ese viaje. El camino de código OTP no
 * necesita cruzar de origen, pero de todos modos pasa por acá para que la
 * Server Action y el callback compartan un solo mecanismo.
 *
 * MISMO molde que `borrador-registro.ts` (cookie `HMAC-SHA256`,
 * `<cuerpo_base64url>.<firma_base64url>`, comparación en tiempo constante,
 * firmada con `SUPABASE_SERVICE_ROLE_KEY`) — no se reinventa el cálculo, solo
 * se adapta el contenido.
 *
 * Nombre de cookie PROPIO (`rutax_invitacion`), NUNCA el de
 * `borrador-registro.ts` (`rutax_registro_borrador`): son dos flujos
 * distintos (alta de empresa vs. aceptación de invitación) que en teoría
 * pueden superponerse en el mismo navegador — reusar el nombre mezclaría un
 * borrador de registro con uno de invitación sin que ninguno de los dos lo
 * note.
 *
 * ⚠️ `sameSite: "lax"`, por la misma razón que `borrador-registro.ts`: el
 * camino Google sale del sitio (a `accounts.google.com`) y vuelve con una
 * navegación de nivel superior desde OTRO origen — `SameSite=Strict` no
 * mandaría esta cookie en ese `GET` de vuelta.
 *
 * Un solo uso: se cumple BORRANDO la cookie tras consumirla con éxito
 * (`limpiarBorrador`, invocado por el llamador) — igual criterio que
 * `borrador-registro.ts`.
 */

import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";

/** Nombre de la cookie del borrador de invitación. */
export const COOKIE_BORRADOR_INVITACION = "rutax_invitacion";

/**
 * Duración de la ventana — tiempo de sobra para ir y volver de Google o para
 * escribir un código de 6 dígitos (que dura 10 minutos, ver `otp_expiry` en
 * `supabase/config.toml`), sin dejar un borrador vivo indefinidamente.
 */
export const DURACION_BORRADOR_INVITACION_MINUTOS = 30;

/** Forma del borrador de invitación. */
export interface BorradorInvitacion {
  token: string;
  /**
   * Opt-in de WhatsApp del seller. Solo tiene sentido si la invitación es de
   * tipo `seller` — un interno del courier no representa a nadie a quien
   * Rutax le mande avisos de retiro. `undefined` cuando la pantalla no lo
   * mostró (no es seller, o el invitado no marcó nada).
   */
  optInWhatsApp?: boolean;
  /** Teléfono asociado al opt-in. Se ignora si `optInWhatsApp` no es `true`. */
  telefonoWhatsApp?: string;
}

interface PayloadBorradorInvitacion extends BorradorInvitacion {
  /** Epoch ms de expiración. */
  exp: number;
}

// -----------------------------------------------------------------------------
// Firma HMAC — mismo cálculo que `borrador-registro.ts`/`soporte.ts`.
// -----------------------------------------------------------------------------

function resolverSecretoFirma(): string {
  const secreto = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secreto) {
    throw new Error(
      "No se puede firmar el borrador de invitación: falta SUPABASE_SERVICE_ROLE_KEY en este entorno.",
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

/** Firma `payload` como `<cuerpo_base64url>.<hmac_base64url>`. */
function firmarPayload(payload: PayloadBorradorInvitacion): string {
  const secreto = resolverSecretoFirma();
  const cuerpo = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const firma = createHmac("sha256", secreto).update(cuerpo).digest("base64url");
  return `${cuerpo}.${firma}`;
}

/**
 * Verifica la firma de `token` y devuelve el payload si es válido; `null` en
 * cualquier otro caso (formato inválido, firma que no calza, secreto ausente,
 * JSON corrupto, o payload con forma inesperada). Fail-closed: nunca lanza.
 */
function verificarYExtraerPayload(token: string): PayloadBorradorInvitacion | null {
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
    const bruto = JSON.parse(Buffer.from(cuerpo, "base64url").toString("utf8")) as Partial<PayloadBorradorInvitacion>;
    if (typeof bruto.token !== "string" || typeof bruto.exp !== "number") {
      return null;
    }
    return {
      token: bruto.token,
      optInWhatsApp: bruto.optInWhatsApp === true ? true : undefined,
      telefonoWhatsApp: typeof bruto.telefonoWhatsApp === "string" ? bruto.telefonoWhatsApp : undefined,
      exp: bruto.exp,
    };
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// API pública
// -----------------------------------------------------------------------------

/**
 * Firma y guarda el borrador en una cookie httpOnly. El llamador
 * (`guardarBorradorInvitacion` en `src/app/invitacion/[token]/actions.ts`) es
 * responsable de validar que el token siga vigente antes de llegar aquí.
 */
export async function guardarBorrador(datos: BorradorInvitacion): Promise<void> {
  const exp = Date.now() + DURACION_BORRADOR_INVITACION_MINUTOS * 60_000;
  const token = firmarPayload({ ...datos, exp });

  const almacenCookies = await cookies();
  almacenCookies.set(COOKIE_BORRADOR_INVITACION, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: DURACION_BORRADOR_INVITACION_MINUTOS * 60,
  });
}

/**
 * Lee el borrador vigente, o `null` si no hay cookie, si la firma no calza, o
 * si venció.
 */
export async function leerBorrador(): Promise<BorradorInvitacion | null> {
  const almacenCookies = await cookies();
  const cookie = almacenCookies.get(COOKIE_BORRADOR_INVITACION);
  if (!cookie?.value) return null;

  const payload = verificarYExtraerPayload(cookie.value);
  if (!payload || payload.exp <= Date.now()) return null;

  const { exp, ...datos } = payload;
  void exp;
  return datos;
}

/**
 * Borra la cookie del borrador — "de un solo uso" se cumple llamando esto
 * tras consumirlo con éxito (o al descubrir que ya no aplica). Best-effort:
 * si se invoca desde un contexto de solo lectura, se ignora en silencio.
 */
export async function limpiarBorrador(): Promise<void> {
  const almacenCookies = await cookies();
  try {
    almacenCookies.delete(COOKIE_BORRADOR_INVITACION);
  } catch {
    // No-op — ver nota de arriba.
  }
}
