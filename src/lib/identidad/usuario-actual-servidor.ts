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

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { esRolValido, type Rol } from "@/modules/identidad/roles";
import type { UsuarioActual } from "@/modules/identidad/usuario-actual";
import { obtenerAreasHabilitadas } from "@/modules/plataforma/superficie-courier";

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
 * Lee `usuarios_perfil.estado` EN VIVO — no el claim `estado_usuario` del JWT.
 * =============================================================================
 * El `custom_access_token_hook` escribe ese claim SOLO al emitir/refrescar el
 * token (migración 0001 §6). Si un super-admin suspende una cuenta desde
 * `/admin/cuentas` (`src/modules/plataforma/baja-cuentas.ts`) DESPUÉS de que
 * esa persona ya tiene un access token vigente, el claim sigue diciendo
 * `activo` hasta que el token expire y se refresque — hasta ~1 hora. Sin esta
 * lectura, nada bloquea navegar con ese token: `estaActivo()`/`tieneCapacidad()`
 * seguirían aprobando cualquier acción.
 *
 * Esta lectura SÍ ve el cambio al instante: es la misma fila, no el claim
 * cacheado. Es la pieza que de verdad expulsa a alguien con sesión viva; la
 * revocación de sesión (`ban_duration` en Supabase Auth) es la otra mitad —
 * corta el refresco FUTURO del token, pero no el que ya está en la cookie.
 *
 * ⚠️ Con `service_role`, no con el cliente de la sesión (RLS). La política
 * `usuarios_perfil_select` exige `id = auth.uid()` **Y** `tenant_id =
 * identidad.claim_tenant_id()` — el segundo término lee el claim del MISMO
 * JWT que esta función existe para no confiar; si algún día `tenant_id`
 * pudiera divergir entre la fila y el claim (hoy no ocurre, pero nada lo
 * impide), la lectura con el cliente de sesión fallaría en silencio (cero
 * filas) justo en el caso que más importa. `service_role` bypasea RLS y
 * hace la lectura una verdad independiente del propio token — mismo patrón
 * que `autenticarBearer` en `src/lib/supabase/autenticar-bearer.ts`. Si la
 * consulta falla (red, Postgres caído), se devuelve `null` y el llamador
 * conserva el estado del claim: un hipo transitorio de esta lectura extra no
 * puede expulsar a todo el mundo de golpe — el fail-closed real de esta
 * función es el gate de `estaActivo()`, no esta lectura.
 */
async function leerEstadoVivo(usuarioId: string): Promise<UsuarioActual["estado"] | null> {
  try {
    const { data, error } = await crearClienteServiceRole()
      .schema("identidad")
      .from("usuarios_perfil")
      .select("estado")
      .eq("id", usuarioId)
      .maybeSingle();

    if (error || !data) return null;
    const estado = (data as { estado?: unknown }).estado;
    if (estado === "activo" || estado === "invitado" || estado === "suspendido") return estado;
    return null;
  } catch {
    return null;
  }
}

/**
 * Lee la sesión del usuario autenticado y arma su `UsuarioActual`.
 * Devuelve `null` si no hay sesión (visitante anónimo).
 *
 * Memoizada por request con `cache()` de React: layouts y páginas la invocan
 * varias veces por navegación (p. ej. el layout del tenant y la propia página),
 * y sin esto cada llamada repetía `getUser()` + `getClaims()` contra Auth. La
 * memoización es por-request (cero staleness): dentro de una misma petición las
 * cookies/JWT no cambian.
 */
export const obtenerSesionActual = cache(async function obtenerSesionActual(): Promise<SesionActual | null> {
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
        // Sin JWT válido no hay tenant del que leer áreas, y `estado: invitado`
        // ya niega toda capacidad. La lista vacía es coherente con eso.
        areasHabilitadas: [],
      },
    };
  }

  const tenantId = leerClaimTexto(claims, "tenant_id");

  // 🔴 Las áreas que Rutax tiene encendidas para este courier. Es el ÚNICO sitio
  // donde se cargan, y de acá las lee `tieneCapacidad` para restar lo apagado —
  // así las ~50 puertas del producto quedan cubiertas sin tocar ninguna.
  //
  // Va acá y no en los claims del JWT a propósito: un claim solo se refresca al
  // renovar el token, así que apagar un área tardaría hasta una hora en surtir
  // efecto. Esto es un interruptor de «no quiero que le metan mano»: tiene que
  // valer en la siguiente navegación. El coste es una consulta por request, y
  // `obtenerSesionActual` ya está memoizada con `cache()`, igual que la propia
  // `obtenerAreasHabilitadas`.
  //
  // Un `super_admin` no tiene tenant y no pasa por acá: el backstage no se apaga
  // a sí mismo.
  const areasHabilitadas = tenantId ? await obtenerAreasHabilitadas(tenantId) : [];

  // Estado EN VIVO (ver `leerEstadoVivo` arriba) — gana sobre el claim del JWT
  // cuando la lectura funciona. `null` (fila sin perfil, o la lectura falló)
  // conserva el fallback de siempre: el claim, o 'invitado' si tampoco existe.
  const estadoVivo = await leerEstadoVivo(user.id);

  const usuario: UsuarioActual = {
    tenantId,
    tipoUsuario: leerTipoUsuario(claims),
    sellerId: leerClaimTexto(claims, "seller_id"),
    driverId: leerClaimTexto(claims, "driver_id"),
    rol: leerRol(claims),
    estado: estadoVivo ?? leerEstadoUsuario(claims),
    areasHabilitadas,
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
});

/** Azúcar: lanza si no hay sesión — útil para rutas que exigen autenticación. */
export async function exigirSesionActual(): Promise<SesionActual> {
  const sesion = await obtenerSesionActual();
  if (!sesion) {
    throw new Error("No hay una sesión activa.");
  }
  return sesion;
}
