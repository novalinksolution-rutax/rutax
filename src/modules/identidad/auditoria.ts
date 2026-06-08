/**
 * Bitácora de auditoría — utilidad de escritura para `identidad`.
 *
 * Contrato (§11 regla 1 del documento de arquitectura): nadie fuera de
 * `identidad` escribe en `bitacora_auditoria` directamente. Esta es la única
 * puerta de entrada que usan `onboarding.ts` e `invitaciones.ts` (y, a futuro,
 * cualquier otra función de servidor de este módulo).
 *
 * Regla dura (CLAUDE.md + constraint `bitacora_auditoria_detalle_sin_secretos`
 * en la migración 0004): `detalle` JAMÁS contiene tokens, contraseñas,
 * certificados ni valores cifrados. Esta utilidad:
 *   - solo acepta un `detalle` ya saneado por el llamador (no intenta adivinar
 *     qué es secreto — esa responsabilidad es del llamador, que conoce la forma
 *     de sus datos), pero
 *   - además aplica un filtro de defensa en profundidad que elimina cualquier
 *     clave de la lista negra antes de insertar, como red de seguridad.
 *
 * Usa `service_role` (bypass deliberado de RLS): la tabla es append-only y no
 * tiene política de INSERT para `authenticated` (ver migración 0004) — un
 * INSERT vía cliente normal fallaría siempre. `service_role` es el único rol
 * capaz de escribir aquí, y por eso esta utilidad vive junto a las funciones
 * que ya necesitan ese cliente (alta de tenant, invitaciones).
 *
 * Nota de acceso: se inserta a través de `public.bitacora_auditoria` (la vista
 * `security_invoker = true` que espeja `identidad.bitacora_auditoria`), porque
 * el esquema `identidad` NO está en `api.schemas` de `supabase/config.toml`
 * (solo `public`/`graphql_public` — ver migración 0001 §9). El rol
 * `service_role` de Postgres tiene `BYPASSRLS`, así que `security_invoker`
 * no lo restringe: el INSERT llega íntegro a la tabla base pese a que
 * `authenticated`/`anon` no tienen privilegio de escritura sobre ella.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Claves que NUNCA deben aparecer en `detalle` — espejo de la lista negra del
 * constraint SQL `bitacora_auditoria_detalle_sin_secretos` (migración 0004),
 * más algunas variantes adicionales de defensa en profundidad a nivel de
 * aplicación (la BD valida solo el nivel superior del jsonb; aquí también
 * recorremos anidados).
 */
const CLAVES_PROHIBIDAS = new Set([
  "token",
  "access_token",
  "refresh_token",
  "password",
  "contrasena",
  "contraseña",
  "secret",
  "secreto",
  "certificado",
  "valor_cifrado",
  "credenciales",
  "api_key",
  "apikey",
]);

/** Recorre el objeto y elimina recursivamente cualquier clave de la lista negra. */
function sanearDetalle(valor: unknown): unknown {
  if (Array.isArray(valor)) {
    return valor.map(sanearDetalle);
  }
  if (valor !== null && typeof valor === "object") {
    const limpio: Record<string, unknown> = {};
    for (const [clave, sub] of Object.entries(valor as Record<string, unknown>)) {
      if (CLAVES_PROHIBIDAS.has(clave.toLowerCase())) continue;
      limpio[clave] = sanearDetalle(sub);
    }
    return limpio;
  }
  return valor;
}

/** Identifica quién ejecuta la acción — espejo de `actor_tipo_auditoria` (migración 0004). */
export type ActorTipo = "usuario" | "sistema" | "super_admin";

export interface RegistrarEnBitacoraInput {
  /** `null` solo para acciones de plataforma (alta de tenant, soporte super-admin). */
  tenantId: string | null;
  /** `null` si la acción la ejecutó un job/sistema sin actor humano. */
  actorUsuarioId: string | null;
  actorTipo: ActorTipo;
  /** Código de acción, p. ej. `tenant.alta`, `invitacion.creada`, `usuario.rol_cambiado`. */
  accion: string;
  entidadTipo: string;
  entidadId: string | null;
  /** jsonb — sin secretos ni tokens (se sanea igualmente como red de seguridad). */
  detalle?: Record<string, unknown>;
}

/**
 * Inserta una fila en `bitacora_auditoria` usando el cliente `service_role`
 * recibido. No crea su propio cliente: lo recibe por parámetro para que el
 * llamador controle el ciclo de vida (y para poder probar esta función con un
 * doble de prueba sin tocar Supabase real).
 *
 * Lanza si el INSERT falla — el llamador decide si una falla de auditoría debe
 * abortar la operación de negocio o solo registrarse aparte (en Fase A,
 * preferimos que SÍ aborte: una acción financiera/de acceso sin bitácora viola
 * RF-004/RNF-04, que son P0).
 */
export async function registrarEnBitacora(
  cliente: SupabaseClient,
  entrada: RegistrarEnBitacoraInput,
): Promise<void> {
  const detalleSaneado = sanearDetalle(entrada.detalle ?? {});

  const { error } = await cliente.from("bitacora_auditoria").insert({
    tenant_id: entrada.tenantId,
    actor_usuario_id: entrada.actorUsuarioId,
    actor_tipo: entrada.actorTipo,
    accion: entrada.accion,
    entidad_tipo: entrada.entidadTipo,
    entidad_id: entrada.entidadId,
    detalle: detalleSaneado,
  });

  if (error) {
    throw new Error(`No se pudo registrar en bitácora_auditoria (${entrada.accion}): ${error.message}`);
  }
}
