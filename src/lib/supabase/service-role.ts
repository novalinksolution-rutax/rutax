import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente Supabase con `service_role`.
 *
 * USO RESTRINGIDO: bypassa RLS por diseño (es la "puerta trasera" controlada
 * que el documento de arquitectura §8.3/§10 reserva para funciones de servidor
 * y jobs auditados — nunca como atajo general).
 *
 * Quién puede importar este módulo:
 * - `src/modules/integraciones/**` (adaptadores/puertos: cifrado de secretos,
 *   OAuth de ML, DTE) — son los únicos que necesitan leer/escribir
 *   `identidad.secretos_cifrados` y actualizar `conexiones_seller_ml`.
 * - Jobs en segundo plano (Fase B en adelante: refresco de tokens, sondeo de
 *   salud, ingesta).
 *
 * Quién NO debe importar esto: cualquier código que sirva una request de
 * usuario directamente (`app/**`, componentes, route handlers que solo
 * reflejan datos del propio usuario). Para esos casos usa
 * `src/lib/supabase/server.ts` (cliente con la sesión del usuario, RLS activa).
 *
 * Guarda de entorno: `SUPABASE_SERVICE_ROLE_KEY` (sin prefijo `NEXT_PUBLIC_`)
 * nunca llega al bundle del navegador por convención de Next.js — pero además
 * verificamos aquí que `window` no exista, para fallar ruidosamente si alguna
 * vez algo intenta importar este módulo desde código de cliente. Defensa en
 * profundidad, igual que el patrón de `secretos_cifrados` en BD.
 */
let cliente: SupabaseClient | null = null;

export function crearClienteServiceRole(): SupabaseClient {
  if (typeof window !== "undefined") {
    throw new Error(
      "crearClienteServiceRole() es exclusivamente de servidor. " +
        "Nunca debe ejecutarse en el navegador (bypassa RLS).",
    );
  }

  if (cliente) return cliente;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const claveServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !claveServiceRole) {
    throw new Error(
      "Faltan variables de entorno para el cliente service_role " +
        "(NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY). " +
        "Revisa .env.local — nunca se loguea el valor de la clave.",
    );
  }

  cliente = createSupabaseClient(url, claveServiceRole, {
    auth: {
      // Cliente de servidor puro: no persistir ni refrescar sesión de usuario.
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return cliente;
}
