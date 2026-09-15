import { cookies, headers } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { dominioCookieSupabase } from "./dominio-cookie";

/**
 * `cookieOptions.domain` DEBE derivarse con la MISMA función que usa el
 * cliente de navegador (`dominioCookieSupabase`, ver ese módulo): si el
 * dominio difiere entre ambos clientes, el `code_verifier` de PKCE y la
 * sesión quedan partidos entre dos scopes de cookie y el login se rompe
 * para todos, no solo para `www`.
 *
 * `@supabase/ssr` (0.10.3) mezcla este `cookieOptions` en TODA escritura
 * de cookie que hace internamente —incluida la que borra el
 * `code_verifier` al canjear el código OAuth—, así que basta pasarlo una
 * vez en la construcción del cliente; no hace falta tocar `setAll`.
 *
 * `headers()` es válido en Server Components, Route Handlers y Server
 * Actions (los tres contextos desde los que se llama `createClient()` en
 * este repo). Si alguna vez se llamara desde un sitio donde no lo es, se
 * degrada a cookie host-only en vez de romper la petición.
 */
async function derivarDominioCookie(): Promise<string | undefined> {
  try {
    const host = (await headers()).get("host");
    return dominioCookieSupabase(host);
  } catch {
    return undefined;
  }
}

export async function createClient() {
  const cookieStore = await cookies();
  const dominio = await derivarDominioCookie();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      ...(dominio ? { cookieOptions: { domain: dominio } } : {}),
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // setAll fue llamado desde un Server Component: ignorar si hay
            // middleware refrescando la sesión.
          }
        },
      },
    },
  );
}
