import { createClient } from "@supabase/supabase-js";
import { esRolValido } from "@/modules/identidad/roles";
import type { UsuarioActual } from "@/modules/identidad/usuario-actual";

/**
 * Verifica un Bearer token de Supabase Auth y devuelve el UsuarioActual.
 *
 * Equivalente a obtenerSesionActual() pero para peticiones con Authorization
 * header (API routes consumidas por la app Expo del conductor) en lugar de cookies.
 *
 * Flujo:
 *  1. Verifica el token contra Supabase Auth Admin (getUser) — rechaza tokens
 *     expirados, mal firmados o revocados.
 *  2. Decodifica el payload del JWT (ya validado) para leer los custom claims
 *     que el custom_access_token_hook inyecta en cada token (migración 0001).
 *
 * Devuelve null si el token es inválido, está expirado o no tiene claims de negocio.
 */
export async function autenticarBearer(
  authorizationHeader: string | null,
): Promise<(UsuarioActual & { usuarioId: string }) | null> {
  if (!authorizationHeader?.startsWith("Bearer ")) return null;
  const token = authorizationHeader.slice(7);
  if (!token) return null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;

  // 1. Verificar el token contra Supabase Auth.
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const {
    data: { user },
    error,
  } = await admin.auth.getUser(token);
  if (error || !user) return null;

  // 2. Extraer claims del payload del JWT (firma ya validada en el paso anterior).
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
    ) as Record<string, unknown>;

    const tipoUsuario = payload["tipo_usuario"] as string | undefined;
    const estadoUsuario = payload["estado_usuario"] as string | undefined;
    const rol = payload["rol"];

    return {
      usuarioId: user.id,
      tenantId: typeof payload["tenant_id"] === "string" ? payload["tenant_id"] : null,
      tipoUsuario: (["interno", "seller", "conductor", "super_admin"] as const).includes(
        tipoUsuario as "interno",
      )
        ? (tipoUsuario as UsuarioActual["tipoUsuario"])
        : "interno",
      sellerId: typeof payload["seller_id"] === "string" ? payload["seller_id"] : null,
      driverId: typeof payload["driver_id"] === "string" ? payload["driver_id"] : null,
      rol: esRolValido(rol) ? rol : "supervisor",
      estado: (["activo", "invitado", "suspendido"] as const).includes(
        estadoUsuario as "activo",
      )
        ? (estadoUsuario as UsuarioActual["estado"])
        : "invitado",
    };
  } catch {
    return null;
  }
}
