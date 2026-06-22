/**
 * Sesión del backstage de plataforma (super-admin de Rutax) — SOLO SERVIDOR.
 * =============================================================================
 *
 * Reemplaza el mecanismo previo de "secreto en la URL" (`?secret=...`), que
 * violaba la regla dura de CLAUDE.md ("credenciales NUNCA en URLs ni en logs"):
 * la URL quedaba en logs de Vercel, historial del navegador y header `Referer`,
 * y el secreto se incrustaba en el HTML entregado al cliente.
 *
 * Modelo nuevo (sin cambios de esquema, sin nuevas variables de entorno):
 * - El fundador autentica con `SUPER_ADMIN_SECRET` vía un formulario POST
 *   (`acciones-sesion.ts`), nunca por query param.
 * - La sesión se mantiene en una cookie `httpOnly` + `Secure` + `SameSite=Strict`
 *   cuyo valor es un TOKEN DERIVADO `HMAC-SHA256(SUPER_ADMIN_SECRET, …)`, NO el
 *   secreto crudo: aunque la cookie se filtrara, no revela el secreto maestro.
 * - Toda validación es de tiempo constante (`timingSafeEqual`).
 * - El secreto crudo solo se lee server-side desde `process.env` para pasarlo a
 *   las funciones de `plataforma` que aún lo exigen — nunca viaja al cliente.
 *
 * Evolución natural (fuera de alcance de este fix, requiere provisioning):
 * migrar a sesión Supabase real de un usuario `super_admin`
 * (`esSuperAdminDePlataforma`) en vez de un secreto compartido.
 *
 * Este módulo importa `next/headers` y `node:crypto` → es server-only por
 * construcción (importarlo desde un Client Component lanzaría en build).
 */

import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";

/** Nombre de la cookie de sesión del backstage. */
export const COOKIE_ADMIN = "rutax_admin_session";

/** Vigencia de la sesión admin (8 horas). */
export const MAX_AGE_ADMIN_SEGUNDOS = 60 * 60 * 8;

/** Etiqueta versionada del token (permite invalidar todas las sesiones subiendo el sufijo). */
const ETIQUETA_TOKEN = "rutax-admin-session-v1";

/**
 * Token de sesión derivado del secreto maestro. `null` si `SUPER_ADMIN_SECRET`
 * no está configurado (fail-closed: sin secreto no hay forma de autenticar).
 */
export function tokenSesionAdmin(): string | null {
  const secreto = process.env.SUPER_ADMIN_SECRET;
  if (!secreto) return null;
  return createHmac("sha256", secreto).update(ETIQUETA_TOKEN).digest("hex");
}

/** Comparación de tiempo constante de dos strings (false si difieren en largo). */
function igualesTiempoConstante(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Valida el SECRETO CRUDO ingresado en el formulario de login contra
 * `SUPER_ADMIN_SECRET`. Tiempo constante. Fail-closed si el env falta.
 */
export function validarSecretoAdmin(secretoIngresado: string | null | undefined): boolean {
  const esperado = process.env.SUPER_ADMIN_SECRET;
  if (!esperado || !secretoIngresado) return false;
  return igualesTiempoConstante(secretoIngresado, esperado);
}

/** Valida el TOKEN de la cookie contra el token derivado esperado. */
function validarTokenAdmin(token: string | null | undefined): boolean {
  const esperado = tokenSesionAdmin();
  if (!esperado || !token) return false;
  return igualesTiempoConstante(token, esperado);
}

/** `true` si la request trae una cookie de sesión admin válida. */
export async function tieneSesionAdmin(): Promise<boolean> {
  const store = await cookies();
  return validarTokenAdmin(store.get(COOKIE_ADMIN)?.value);
}

/**
 * Exige sesión admin válida y devuelve el SECRETO CRUDO (leído de env, nunca de
 * la cookie) para pasarlo a las funciones de `plataforma` que aún lo requieren.
 * Lanza `Error('No autorizado')` si la sesión no es válida — el secreto crudo
 * nunca sale del servidor.
 */
export async function exigirSecretoAdmin(): Promise<string> {
  const store = await cookies();
  if (!validarTokenAdmin(store.get(COOKIE_ADMIN)?.value)) {
    throw new Error("No autorizado");
  }
  const secreto = process.env.SUPER_ADMIN_SECRET;
  if (!secreto) throw new Error("No autorizado");
  return secreto;
}
