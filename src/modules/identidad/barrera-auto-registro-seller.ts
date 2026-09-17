/**
 * Barrera de auto-registro de sellers — hermana de `cuenta-por-email.ts`
 * (RF-010 rediseño, alta por autoservicio).
 * =============================================================================
 * `cuenta-por-email.ts` protege el alta MANUAL (el courier invita por
 * correo): impide que una invitación pise el perfil de una cuenta que ya es
 * otra cosa. Esta barrera protege el alta AUTOSERVICIO (Google + enlace): la
 * misma pregunta, en el momento en que la identidad Auth intenta convertirse
 * en seller de un courier por su cuenta, sin que nadie del courier la esté
 * invitando.
 *
 * Dos reglas, ambas antes de escribir nada:
 *   1. PERMITE que una identidad se registre en un tenant donde no tiene
 *      membresía — incluido el caso "ya es seller de OTRO courier" (eso es
 *      justamente el multi-courier que este alcance habilita).
 *   2. BLOQUEA si la identidad YA es `conductor`/`interno`/`super_admin` en
 *      CUALQUIER tenant — esos tipos no pueden "sumar" un rol de seller
 *      encima; sería el mismo bug que `cuenta-por-email.ts` documenta (un
 *      upsert por `id` que le pisa el perfil a otra cosa).
 *   3. BLOQUEA si la identidad YA tiene una fila en `seller_membresias` para
 *      ESE MISMO tenant (activa o bloqueada) — no hay nada que "re-registrar".
 *
 * Aislamiento: nunca revela al courier que esa identidad opera con otros
 * couriers — el resultado de esta función es binario (permite/bloquea) y el
 * mensaje al VISITANTE (que es la propia identidad en cuestión, no el
 * courier) es lo único que se muestra.
 */

import type { ClienteServicio } from "./onboarding";
import { buscarPerfilPorAuthUserId } from "./onboarding";

/** Tipos de cuenta que NO pueden convertirse en seller por autoservicio. */
export type TipoCuentaBloqueante = "interno" | "conductor" | "super_admin";

export type ResultadoBarreraAutoRegistroSeller =
  | { ok: true }
  | { ok: false; motivo: "identidad_no_es_seller"; tipoActual: TipoCuentaBloqueante }
  | { ok: false; motivo: "ya_tiene_membresia_en_este_courier" };

/**
 * ¿Puede esta identidad Auth registrarse como seller de `tenantId`?
 *
 * No lanza por reglas de negocio (devuelve el resultado tipado); sí lanza si
 * la lectura a la base falla (fallo de infraestructura).
 */
export async function verificarBarreraAutoRegistroSeller(
  cliente: ClienteServicio,
  authUserId: string,
  tenantId: string,
): Promise<ResultadoBarreraAutoRegistroSeller> {
  const perfil = await buscarPerfilPorAuthUserId(cliente, authUserId);

  if (perfil && perfil.tipoUsuario !== "seller") {
    return {
      ok: false,
      motivo: "identidad_no_es_seller",
      tipoActual: perfil.tipoUsuario as TipoCuentaBloqueante,
    };
  }

  const { data, error } = await cliente
    .schema("identidad")
    .from("seller_membresias")
    .select("id")
    .eq("auth_user_id", authUserId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    throw new Error(`No se pudo verificar la barrera de auto-registro de sellers: ${error.message}`);
  }
  if (data) {
    return { ok: false, motivo: "ya_tiene_membresia_en_este_courier" };
  }

  return { ok: true };
}

const NOMBRE_TIPO_BLOQUEANTE: Record<TipoCuentaBloqueante, string> = {
  interno: "un usuario de equipo",
  conductor: "un conductor",
  super_admin: "una cuenta de plataforma",
};

/** El mensaje que ve el propio visitante que intenta registrarse. */
export function mensajeBarreraAutoRegistroSeller(resultado: ResultadoBarreraAutoRegistroSeller): string {
  if (resultado.ok) return "";
  if (resultado.motivo === "identidad_no_es_seller") {
    return (
      `Esta cuenta ya es ${NOMBRE_TIPO_BLOQUEANTE[resultado.tipoActual]} en Rutax y no puede registrarse ` +
      "como seller. Usa otra cuenta de Google."
    );
  }
  return "Ya tienes una cuenta de seller con este courier. Inicia sesión en vez de registrarte de nuevo.";
}
