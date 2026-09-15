/**
 * Deriva el `domain` de las cookies de sesión de Supabase a partir del host
 * de la petición/navegador.
 * =====================================================================
 * BUG QUE ESTO ARREGLA (producción, sep-2026): Vercel redirige
 * `www.rutax.io` → 308 → `rutax.io`. Si el login con Google arranca en
 * `www.rutax.io`, el `code_verifier` de PKCE se guarda como cookie
 * HOST-ONLY de `www.rutax.io`; el callback de OAuth vuelve a `rutax.io`
 * (tras el 308) y esa cookie no viaja → `pkce_code_verifier_not_found` en
 * el primer intento. El segundo intento entra porque para entonces el
 * navegador ya está parado en `rutax.io`.
 *
 * El arreglo es que la cookie sea de dominio COMPARTIDO `.rutax.io`, así
 * viaja entre `www` y el apex. Esta función es la única fuente de verdad
 * de esa derivación: la usan el cliente de navegador (que ESCRIBE el
 * `code_verifier`) y el cliente de servidor (que lo lee/borra y escribe la
 * sesión), y **deben coincidir siempre** — si difieren, las cookies quedan
 * partidas entre dos scopes y el login se rompe para todos.
 *
 * ⚠️ En local (`localhost`, `127.0.0.1`) y en previews (`*.vercel.app`,
 * túneles) se devuelve `undefined` a propósito: forzar `.rutax.io` ahí
 * invalidaría la cookie entera (el navegador la descarta si el dominio no
 * es un sufijo válido del host real). No se decide por `NODE_ENV`: se
 * decide por el host, así que un preview de Vercel en producción también
 * queda a salvo sin tocar nada.
 */
export function dominioCookieSupabase(
  host: string | null | undefined,
): string | undefined {
  if (!host) {
    return undefined;
  }

  const normalizado = host.trim().toLowerCase().split(":")[0];

  if (!normalizado) {
    return undefined;
  }

  if (normalizado === "rutax.io" || normalizado.endsWith(".rutax.io")) {
    return ".rutax.io";
  }

  return undefined;
}
