import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente de Supabase para el NAVEGADOR.
 * =====================================================================
 * `createBrowserClient` memoiza: todas las llamadas devuelven la MISMA
 * instancia (`@supabase/ssr` guarda un singleton en módulo).
 */
export function createClient(): SupabaseClient {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

/**
 * El mismo cliente, pero con el token del usuario YA PROPAGADO al socket de
 * Realtime. Úsalo SIEMPRE antes de suscribirse a un canal.
 * =====================================================================
 *
 * EL DEFECTO QUE ESTO TAPA (encontrado el 2026-08-14, llevaba vivo meses y
 * afectaba a las seis pantallas "en vivo" del producto).
 *
 * Las suscripciones de Realtime evalúan RLS con el JWT del socket, no con el de
 * las consultas HTTP. Y `supabase-js` propaga ese JWT en UN SOLO lugar
 * (`_handleTokenChanged`), que reacciona únicamente a tres eventos de auth:
 *
 *     TOKEN_REFRESHED · SIGNED_IN · SIGNED_OUT
 *
 * **`INITIAL_SESSION` no está en esa lista** — no aparece ni una vez en todo el
 * bundle de `supabase-js` 2.107. Y ése es justamente el evento que se emite al
 * CARGAR una página con la sesión ya establecida, que es el caso normal: el
 * coordinador entra por la mañana y no vuelve a autenticarse en todo el día.
 *
 * Consecuencia: el socket se queda con la clave anónima. Como `anon` no tiene
 * `SELECT` sobre ninguna tabla de negocio, el servidor **descarta la suscripción
 * de `postgres_changes`** — `realtime.subscription` queda en cero filas— y no
 * llega ni un evento. El canal, mientras tanto, **reporta `SUBSCRIBED`**: no hay
 * error en consola, no hay nada en los logs, y el indicador se pinta de verde.
 *
 * Por eso parecía funcionar cuando se probó: justo después de iniciar sesión el
 * evento SÍ es `SIGNED_IN`, así que en esa primera ventana el token se propaga y
 * todo anda. Basta recargar para que se muera en silencio.
 *
 * NO se arregla pasando la opción `accessToken` de supabase-js: esa opción es
 * para autenticación de terceros (Clerk y similares) y **desactiva el módulo de
 * auth propio** (`if (!settings.accessToken) this._listenForAuthEvents()`), que
 * es de donde sale la sesión de este proyecto.
 *
 * ⚠️ Se propaga ANTES de suscribir, no después: la autorización de una
 * suscripción se resuelve en el join del canal. Un `setAuth` que llegue tarde
 * deja el canal ya rechazado.
 */
export async function crearClienteConRealtimeAutenticado(): Promise<{
  cliente: SupabaseClient;
  /** false = no hay sesión utilizable; suscribirse no serviría de nada. */
  autenticado: boolean;
}> {
  const cliente = createClient();

  const { data, error } = await cliente.auth.getSession();
  const token = data.session?.access_token;

  if (error || !token) {
    // No se inventa un estado "en vivo" que no se puede sostener. Quien llama
    // decide qué mostrar; lo que no puede pasar es suscribirse igual y pintar
    // el indicador en verde, que es exactamente el defecto de arriba.
    return { cliente, autenticado: false };
  }

  await cliente.realtime.setAuth(token);
  return { cliente, autenticado: true };
}
