/**
 * Roles de RBAC — espejo en TypeScript del enum `identidad.rol_usuario`
 * (`supabase/migrations/20260101000001_identidad_base.sql`, líneas ~39-49).
 *
 * IMPORTANTE: este conjunto está cerrado y debe coincidir EXACTAMENTE con el
 * enum de Postgres (mismos 7 valores, mismo orden no importa pero los nombres
 * sí). Si necesitas agregar/quitar un rol, primero migras la base de datos
 * (`base-datos-rls`) y luego actualizas este archivo — nunca al revés.
 *
 * Decisión de arquitectura (§4 del documento de Fase A): los permisos NO viven
 * en tablas — viven en código, en el mapa rol→capacidades de `capacidades.ts`.
 * `rol` es una columna enum simple en `usuarios_perfil`.
 */
export const ROLES = [
  "super_admin",
  "dueno",
  "supervisor",
  "coordinador",
  "administracion",
  "conductor",
  "seller",
] as const;

export type Rol = (typeof ROLES)[number];

/** Type guard — útil al leer `rol` desde claims del JWT (texto) o desde la BD. */
export function esRolValido(valor: unknown): valor is Rol {
  return typeof valor === "string" && (ROLES as readonly string[]).includes(valor);
}

/**
 * Roles "internos" del courier (tipo_usuario = 'interno' en `usuarios_perfil`).
 * Coincide con el constraint `usuarios_perfil_rol_coherente_con_tipo` de la
 * migración 0001: tipo_usuario='interno' ⇔ rol ∈ {dueno, supervisor,
 * coordinador, administracion}.
 */
export const ROLES_INTERNOS = ["dueno", "supervisor", "coordinador", "administracion"] as const;

export type RolInterno = (typeof ROLES_INTERNOS)[number];

export function esRolInterno(rol: Rol): rol is RolInterno {
  return (ROLES_INTERNOS as readonly Rol[]).includes(rol);
}
