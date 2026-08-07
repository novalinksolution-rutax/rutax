/**
 * Enlace de invitación — única fuente de verdad de la URL que canjea un token.
 * =============================================================================
 * La ruta `/invitacion/[token]` la consumen DOS caminos distintos y no deben
 * divergir nunca:
 *   - el correo de invitación (servidor, necesita URL absoluta), y
 *   - el botón "Copiar enlace" de `/sellers` (cliente, arma la URL con su
 *     propio `window.location.origin`, que siempre es el correcto).
 *
 * POR QUÉ `resolverUrlBaseApp` PUEDE DEVOLVER `null`:
 *   Un enlace de invitación con el dominio equivocado no falla ruidosamente —
 *   llega al destinatario y no funciona, que es exactamente el problema que
 *   este módulo existe para evitar. Por eso NO hay un dominio "por defecto"
 *   inventado: si el entorno no declara cuál es su URL pública, se devuelve
 *   `null` y el llamador decide (el correo se omite y queda registrado; el
 *   botón de copiar ni siquiera usa esta función). Fallar visible > enviar un
 *   enlace muerto.
 */

/** Ruta (relativa) de la pantalla que canjea el token. */
export const RUTA_INVITACION = "/invitacion";

/** Quita la barra final para que la concatenación no produzca `//invitacion`. */
function normalizarBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/**
 * URL pública de la app, o `null` si el entorno no la declara.
 *
 * Orden de precedencia (mismo que `integraciones/pagos/.../fintoc.ts`, que ya
 * necesitaba resolver esto para sus URLs de retorno):
 *   1. `APP_BASE_URL`         — override explícito de servidor.
 *   2. `NEXT_PUBLIC_APP_URL`  — la que ya usa el resto del proyecto.
 *   3. `VERCEL_URL`           — red de seguridad: en Vercel siempre existe y
 *      produce un enlace que FUNCIONA (apunta al deployment, no al dominio
 *      estable, pero un enlace vivo es mejor que ninguno).
 */
export function resolverUrlBaseApp(): string | null {
  const explicita = process.env.APP_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (explicita && explicita.trim()) {
    return normalizarBase(explicita);
  }

  const vercel = process.env.VERCEL_URL;
  if (vercel && vercel.trim()) {
    // `VERCEL_URL` viene sin protocolo (`mi-app.vercel.app`).
    return normalizarBase(vercel.startsWith("http") ? vercel : `https://${vercel}`);
  }

  return null;
}

/**
 * Arma la URL absoluta de canje. `urlBase` se pasa explícita (no se lee del
 * entorno aquí) para que la función sea pura y el cliente pueda usarla con su
 * propio `window.location.origin`.
 *
 * El token es base64url (`A-Za-z0-9_-`), así que no necesita escaparse: no
 * contiene ningún carácter con significado en una URL ni en HTML.
 */
export function construirEnlaceInvitacion(urlBase: string, token: string): string {
  return `${normalizarBase(urlBase)}${RUTA_INVITACION}/${token}`;
}
