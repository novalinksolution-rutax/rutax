/**
 * La ÚNICA forma de iniciar el login con Google en el navegador.
 * =============================================================================
 * ⚠️ POR QUÉ EXISTE — el «falla la primera vez del día» (21-sep-2026)
 *
 * `@supabase/auth-js`, al descartar una sesión (`_removeSession`), borra TAMBIÉN
 * el verificador de PKCE (`GoTrueClient.js`, `storageKey + '-code-verifier'`).
 * Y descarta la sesión cuando no logra renovarla.
 *
 * La secuencia que fallaba, siempre en el primer intento del día:
 *   1. La sesión de ayer venció durante la noche; su cookie sigue ahí.
 *   2. Al abrir el login, el cliente la encuentra y, EN SEGUNDO PLANO, intenta
 *      renovarla.
 *   3. El usuario aprieta «Continuar con Google»: se escribe el verificador.
 *   4. La renovación falla → `_removeSession()` → se borra el verificador que
 *      se acababa de escribir.
 *   5. Vuelve de Google sin ninguna cookie de sesión y el canje falla con
 *      `pkce_code_verifier_not_found`.
 * El segundo intento funciona porque ya no queda sesión vieja que renovar.
 *
 * Lo confirmó el diagnóstico del callback en Sentry: `llego_verificador_pkce:
 * false` y `nombres_sb_recibidos: []` — no llegaba NINGUNA cookie, y en el
 * proyecto no hay middleware que las quite en el camino. El arreglo anterior
 * (cookie en el dominio `.rutax.io`) resolvía otro caso, el del salto de `www`
 * al apex, y no éste.
 *
 * EL ARREGLO: esperar a que el cliente termine de resolver la sesión vieja
 * ANTES de escribir el verificador. `getSession()` espera a que termine la
 * inicialización del cliente, que es donde corre esa renovación; cuando
 * devuelve, lo que tuviera que borrarse ya se borró, y el verificador que se
 * escribe después sobrevive.
 *
 * ⚠️ Todo login con Google pasa por aquí. Llamar `signInWithOAuth` directo
 * desde una pantalla nueva reabre la carrera sin que nada falle al compilar.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export async function iniciarLoginConGoogle(
  supabase: Pick<SupabaseClient, "auth">,
  redirectTo: string,
): Promise<{ error: Error | null }> {
  // Resuelve (o descarta) la sesión vieja ANTES de escribir el verificador.
  await supabase.auth.getSession();

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo },
  });
  return { error };
}
