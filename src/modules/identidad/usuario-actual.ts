import type { Rol } from "./roles";

/**
 * Forma mínima de "el usuario autenticado actual" que las utilidades de RBAC
 * (y, por contrato, `dinero`/`operacion`/`frontend`) necesitan para resolver
 * capacidades — sin tocar la base de datos.
 *
 * Refleja 1:1 los claims que el `custom_access_token_hook` inyecta al JWT
 * (migración 0001, §3 del documento de arquitectura de Fase A):
 *   tenant_id · tipo_usuario · seller_id · driver_id · rol · estado_usuario
 *
 * Quien consume este tipo típicamente lo arma leyendo `auth.jwt()` (en el
 * cliente de servidor) o las columnas equivalentes de `usuarios_perfil` — el
 * "cómo se obtiene" no es responsabilidad de este módulo de capacidades; aquí
 * solo se decide "qué puede hacer dado este conjunto de datos".
 */
export interface UsuarioActual {
  /** uuid del tenant; `null` únicamente para `super_admin` de plataforma. */
  tenantId: string | null;
  tipoUsuario: "interno" | "seller" | "conductor" | "super_admin";
  /** uuid de `sellers`; presente solo si `tipoUsuario === 'seller'`. */
  sellerId: string | null;
  /** uuid de `conductores`; presente solo si `tipoUsuario === 'conductor'`. */
  driverId: string | null;
  rol: Rol;
  /**
   * Estado de la cuenta (`activo` / `invitado` / `suspendido`). Las
   * capacidades exigen `estado === 'activo'`: un usuario `invitado` (no ha
   * completado el alta) o `suspendido` no debe poder ejercer ninguna acción,
   * incluso si su `rol` la permitiría en abstracto. Esto refleja la regla
   * transversal de RNF-03 ("permisos por rol verificados en backend") sin
   * necesidad de que cada llamador repita el chequeo de estado.
   */
  estado: "activo" | "invitado" | "suspendido";
}

/** Verdadero solo si la cuenta está activa — condición previa a CUALQUIER capacidad. */
export function estaActivo(usuario: UsuarioActual): boolean {
  return usuario.estado === "activo";
}
