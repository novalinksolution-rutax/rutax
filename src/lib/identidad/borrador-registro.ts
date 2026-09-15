/**
 * Borrador firmado de "alta de empresa" — F1 (login sin contraseña del courier).
 * =============================================================================
 * El registro pasó de "un formulario → un tenant" a "un formulario → identidad
 * (Google o código) → tenant": entre el formulario de 5 campos y la vuelta de
 * Google (o la verificación del código OTP) no hay tenant que guardar los
 * datos — todavía no existe. Este módulo los hace sobrevivir ese ida-y-vuelta
 * en una COOKIE firmada, nunca en una tabla: es de un solo uso, expira sola y
 * no vale la pena una fila de base de datos para algo que dura minutos y que
 * nadie necesita auditar hasta que se confirma (eso lo hace `tenant.alta`,
 * dentro de `provisionarTenantParaAuthUser`).
 *
 * Mecanismo: MISMO molde que `src/modules/plataforma/soporte.ts` (cookie
 * `HMAC-SHA256`, `<cuerpo_base64url>.<firma_base64url>`, comparación en tiempo
 * constante) — no se reinventa el cálculo, solo se adapta el contenido.
 *
 * Secreto de firma: `SUPABASE_SERVICE_ROLE_KEY`. NO se introduce un secreto
 * nuevo (instrucción explícita de F1: "firma con un secreto ya existente o
 * documenta cuál usar"). Se descartó reusar `SUPER_ADMIN_SECRET` —el que firma
 * la cookie de soporte— porque ese secreto está documentado en `.env.example`
 * como "la puerta del área de administración" y algunos entornos de trabajo
 * (p. ej. alguien tocando solo `integraciones`) podrían no tenerlo puesto,
 * mientras que `SUPABASE_SERVICE_ROLE_KEY` es transversal: sin ella la app ya
 * no arranca (`crearClienteServiceRole` lo exige a rajatabla), así que nunca es
 * "el secreto que faltaba" de forma sorpresiva.
 *
 * ⚠️ `sameSite: "lax"`, NO `"strict"`. El camino Google sale del sitio (a
 * `accounts.google.com`) y vuelve con una navegación de nivel superior desde
 * OTRO origen — exactamente lo que `SameSite=Strict` retiene: el navegador NO
 * manda esa cookie en el `GET` de vuelta, y el borrador se perdería justo
 * cuando más se necesita. `Lax` sigue mandándola en navegación de nivel
 * superior entre sitios, y sigue bloqueándola en el escenario que `SameSite`
 * de verdad quiere evitar (un `fetch`/`<img>` de un tercero). El camino de
 * código OTP no cruza de origen, así que `lax` no le cuesta nada.
 *
 * Un solo uso: no hay una lista de nonces usados en servidor — "de un solo
 * uso" se implementa BORRANDO la cookie tras consumirla con éxito
 * (`limpiarBorrador`, invocado por el llamador). Si alguien capturara el valor
 * de la cookie (httpOnly, así que solo con acceso a la máquina/red del propio
 * visitante) podría reproducirla dentro de la ventana de 30 minutos — el mismo
 * nivel de exposición que cualquier cookie de sesión corta, y aceptable para
 * datos que de todos modos el propio dueño está a punto de declarar como
 * públicos de su empresa (nombre de fantasía, razón social, RUT).
 */

import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";

/** Nombre de la cookie del borrador. */
export const COOKIE_BORRADOR_REGISTRO = "rutax_registro_borrador";

/**
 * Duración de la ventana — tiempo de sobra para ir y volver de Google o para
 * escribir un código de 6 dígitos (que dura 10 minutos, ver `otp_expiry` en
 * `supabase/config.toml`), sin dejar un borrador vivo indefinidamente si el
 * visitante abandona el flujo.
 */
export const DURACION_BORRADOR_MINUTOS = 30;

/** Forma del borrador — SIEMPRE con RUT ya normalizado y términos aceptados. */
export interface BorradorTenant {
  nombreFantasia: string;
  razonSocial: string;
  /** Normalizado (`NNNNNNNN-DV`) — `guardarBorrador` nunca acepta uno inválido. */
  rut: string;
  nombreDueno: string;
  emailDueno: string;
  /** Siempre `true`: si no viene aceptado, `guardarBorrador` no escribe la cookie. */
  aceptaTerminos: true;
}

interface PayloadBorrador extends BorradorTenant {
  /** Epoch ms de expiración. */
  exp: number;
}

// -----------------------------------------------------------------------------
// Firma HMAC — mismo cálculo que soporte.ts.
// -----------------------------------------------------------------------------

function resolverSecretoFirma(): string {
  const secreto = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secreto) {
    throw new Error(
      "No se puede firmar el borrador de registro: falta SUPABASE_SERVICE_ROLE_KEY en este entorno.",
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
function firmarPayload(payload: PayloadBorrador): string {
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
      typeof bruto.nombreFantasia !== "string" ||
      typeof bruto.razonSocial !== "string" ||
      typeof bruto.rut !== "string" ||
      typeof bruto.nombreDueno !== "string" ||
      typeof bruto.emailDueno !== "string" ||
      bruto.aceptaTerminos !== true ||
      typeof bruto.exp !== "number"
    ) {
      return null;
    }
    return {
      nombreFantasia: bruto.nombreFantasia,
      razonSocial: bruto.razonSocial,
      rut: bruto.rut,
      nombreDueno: bruto.nombreDueno,
      emailDueno: bruto.emailDueno,
      aceptaTerminos: true,
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
 * (`guardarBorradorTenant` en `src/app/registro/actions.ts`) es responsable de
 * validar la FORMA de los datos (incluido el RUT y el consentimiento) antes de
 * llegar aquí — este módulo asume que `datos` ya está limpio.
 */
export async function guardarBorrador(datos: BorradorTenant): Promise<void> {
  const exp = Date.now() + DURACION_BORRADOR_MINUTOS * 60_000;
  const token = firmarPayload({ ...datos, exp });

  const almacenCookies = await cookies();
  almacenCookies.set(COOKIE_BORRADOR_REGISTRO, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: DURACION_BORRADOR_MINUTOS * 60,
  });
}

/**
 * Lee el borrador vigente, o `null` si no hay cookie, si la firma no calza, o
 * si venció (doble chequeo de expiración: el `maxAge` de la cookie ya la
 * habría borrado del navegador, pero el `exp` firmado adentro es la fuente de
 * verdad — no depende de que el navegador respete el `maxAge`).
 */
export async function leerBorrador(): Promise<BorradorTenant | null> {
  const almacenCookies = await cookies();
  const cookie = almacenCookies.get(COOKIE_BORRADOR_REGISTRO);
  if (!cookie?.value) return null;

  const payload = verificarYExtraerPayload(cookie.value);
  if (!payload || payload.exp <= Date.now()) return null;

  const { exp, ...datos } = payload;
  void exp;
  return datos;
}

/**
 * Borra la cookie del borrador — "de un solo uso" se cumple llamando esto tras
 * consumirlo con éxito (o al descubrir que ya no aplica: idempotencia,
 * conflicto). Best-effort: si se invoca desde un contexto de solo lectura
 * (Server Component), Next.js no permite mutar cookies y se ignora en
 * silencio — mismo criterio que `soporte.ts`/`lib/supabase/server.ts`.
 */
export async function limpiarBorrador(): Promise<void> {
  const almacenCookies = await cookies();
  try {
    almacenCookies.delete(COOKIE_BORRADOR_REGISTRO);
  } catch {
    // No-op — ver nota de arriba.
  }
}
