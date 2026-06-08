/**
 * Resuelve el `UsuarioActual` (forma que consume `capacidades.ts`) a partir de
 * la sesión real del usuario en el servidor — sin tocar la base de datos.
 *
 * Por qué desde los claims del JWT y no desde una consulta a `usuarios_perfil`:
 * el `custom_access_token_hook` (migración 0001 §6) ya inyecta exactamente
 * `tenant_id` / `tipo_usuario` / `seller_id` / `driver_id` / `rol` /
 * `estado_usuario` en cada token — son la MISMA fuente de verdad que evalúan
 * las políticas RLS (`identidad.claim_tenant_id()`, etc.). Leerlos aquí evita
 * una consulta redundante y garantiza que "lo que ve la UI" y "lo que filtra
 * RLS" sean exactamente lo mismo.
 *
 * `getClaims()` valida el JWT (localmente vía JWKS o contra el servidor de
 * Auth, según el proyecto) — preferible a decodificar a mano `getSession()`,
 * que la propia documentación de Supabase marca como "no confiable" en el
 * servidor sin verificación.
 *
 * Esta es la ÚNICA función que el código de rutas/Server Actions de `frontend`
 * debe usar para "¿quién es el usuario actual y qué puede hacer?" — el resto
 * compone sobre `capacidades.ts` (`puede*`, `tieneCapacidad`).
 */

import { createClient } from "@/lib/supabase/server";
import { esRolValido, type Rol } from "@/modules/identidad/roles";
import type { UsuarioActual } from "@/modules/identidad/usuario-actual";

export interface SesionActual {
  usuarioId: string;
  email: string | null;
  nombreCompleto: string | null;
  usuario: UsuarioActual;
}

function leerClaimTexto(claims: Record<string, unknown>, clave: string): string | null {
  const valor = claims[clave];
  return typeof valor === "string" && valor.trim() ? valor : null;
}

function leerEstadoUsuario(claims: Record<string, unknown>): UsuarioActual["estado"] {
  const valor = claims["estado_usuario"];
  if (valor === "activo" || valor === "invitado" || valor === "suspendido") return valor;
  // Sin perfil de negocio (usuario recién creado, aún no aprovisionado): el
  // hook no agrega `estado_usuario` — tratamos como `invitado` (sin
  // capacidades), nunca como `activo` por omisión (fail-closed).
  return "invitado";
}

function leerTipoUsuario(claims: Record<string, unknown>): UsuarioActual["tipoUsuario"] {
  const valor = claims["tipo_usuario"];
  if (valor === "interno" || valor === "seller" || valor === "conductor" || valor === "super_admin") {
    return valor;
  }
  return "interno";
}

function leerRol(claims: Record<string, unknown>): Rol {
  const valor = claims["rol"];
  if (esRolValido(valor)) return valor;
  // Fail-closed: un rol desconocido/ausente se resuelve al más acotado posible
  // que el tipo por defecto ('interno') admite — nunca a 'dueno'.
  return "supervisor";
}

/**
 * Lee la sesión del usuario autenticado y arma su `UsuarioActual`.
 * Devuelve `null` si no hay sesión (visitante anónimo).
 */
export async function obtenerSesionActual(): Promise<SesionActual | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data, error } = await supabase.auth.getClaims();
  const claims = (data?.claims ?? {}) as Record<string, unknown>;

  if (error || !data) {
    // No se pudo validar el JWT: tratamos como sin perfil de negocio
    // (fail-closed) — el usuario sigue autenticado a nivel de Auth, pero no
    // ejerce ninguna capacidad de tenant hasta que la sesión se regularice.
    return {
      usuarioId: user.id,
      email: user.email ?? null,
      nombreCompleto:
        typeof user.user_metadata?.["nombre_completo"] === "string"
          ? (user.user_metadata["nombre_completo"] as string)
          : null,
      usuario: {
        tenantId: null,
        tipoUsuario: "interno",
        sellerId: null,
        driverId: null,
        rol: "supervisor",
        estado: "invitado",
      },
    };
  }

  const usuario: UsuarioActual = {
    tenantId: leerClaimTexto(claims, "tenant_id"),
    tipoUsuario: leerTipoUsuario(claims),
    sellerId: leerClaimTexto(claims, "seller_id"),
    driverId: leerClaimTexto(claims, "driver_id"),
    rol: leerRol(claims),
    estado: leerEstadoUsuario(claims),
  };

  const nombreCompleto =
    typeof claims["user_metadata"] === "object" &&
    claims["user_metadata"] !== null &&
    typeof (claims["user_metadata"] as Record<string, unknown>)["nombre_completo"] === "string"
      ? ((claims["user_metadata"] as Record<string, unknown>)["nombre_completo"] as string)
      : (typeof user.user_metadata?.["nombre_completo"] === "string"
          ? (user.user_metadata["nombre_completo"] as string)
          : null);

  return {
    usuarioId: user.id,
    email: user.email ?? (typeof claims["email"] === "string" ? (claims["email"] as string) : null),
    nombreCompleto,
    usuario,
  };
}

/** Azúcar: lanza si no hay sesión — útil para rutas que exigen autenticación. */
export async function exigirSesionActual(): Promise<SesionActual> {
  const sesion = await obtenerSesionActual();
  if (!sesion) {
    throw new Error("No hay una sesión activa.");
  }
  return sesion;
}
