/**
 * ¿Este correo ya tiene una cuenta en Rutax, y de quién?
 * =============================================================================
 * Existe para una sola cosa: **impedir que una invitación pise el perfil de una
 * cuenta que ya existe.**
 *
 * -----------------------------------------------------------------------------
 * EL BUG QUE LO MOTIVA, PORQUE NO SE VE VENIR
 * -----------------------------------------------------------------------------
 * `aceptarInvitacion` hace un **upsert por `id`**, y su propio comentario lo
 * declara: cubre «usuario ya existente que el courier vuelve a invitar con otro
 * rol». Eso es correcto para un cambio de rol dentro del equipo, y catastrófico
 * para todo lo demás:
 *
 *   El 2026-08-25, un courier invitó a un seller con su correo, lo activó, y
 *   después le dio acceso de conductor al MISMO correo. El segundo canje
 *   sobrescribió el perfil: `tipo_usuario` pasó a `conductor` y `seller_id`
 *   quedó en NULL. **La cuenta de seller no falló al crearse — se destruyó
 *   después, en silencio.** El seller aparecía como «Invitado» en el listado y
 *   su invitación decía «aceptada» a la vez.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ ESTO REVIERTE UNA DECISIÓN DOCUMENTADA. A PROPÓSITO.
 * -----------------------------------------------------------------------------
 * `existeCuentaConEmail` (en `invitacion/[token]/actions.ts`) lleva escrito:
 * «NO se usa esto para "verificar antes de invitar" (eso sí filtraría)». El
 * criterio venía del documento de UX §2.2 y era razonable: comprobar antes de
 * invitar convierte el formulario en un oráculo — un courier puede sondear
 * correos y averiguar quién tiene cuenta en Rutax.
 *
 * Se revierte porque **el precio de no comprobar resultó ser mayor**: no es una
 * molestia, es la destrucción del perfil de otra cuenta. Y la fuga que se acepta
 * a cambio es acotada: quien pregunta es un usuario de negocio identificado, con
 * sesión, capacidad de invitar y su acción en `bitacora_auditoria`. No es un
 * formulario público.
 *
 * -----------------------------------------------------------------------------
 * LO QUE SE REVELA, Y LO QUE NO
 * -----------------------------------------------------------------------------
 * Si la cuenta es del MISMO courier que pregunta, se puede decir qué es: son sus
 * propios datos y saber «ese correo ya es un conductor tuyo» es justo lo que
 * necesita para resolverlo. Si es de OTRO courier, no se revela nada — decirle
 * «ese correo es conductor de Despachos del Centro» le filtraría a un
 * competidor quién trabaja con quién, que es el aislamiento que la base impone
 * en todas las demás tablas.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Lo mínimo que hace falta del cliente: `auth` (para `listUsers`) y `schema`
 * (para leer el perfil).
 *
 * ⚠️ Es un `Pick` y no `SupabaseClient` entero, igual que en `invitaciones.ts`.
 * El motivo no es purismo: los dobles de las pruebas implementan solo esos dos,
 * y pedir el cliente completo hace que `crearInvitacion` —que ya trabaja con la
 * versión acotada— no pueda pasarnos el suyo. Falla en `next build` y **no** en
 * `vitest`, que es el peor sitio para enterarse.
 */
type ClienteConAuth = Pick<SupabaseClient, "auth" | "schema">;

export type TipoCuenta = "interno" | "seller" | "conductor" | "super_admin";

export interface CuentaPorEmail {
  existe: boolean;
  /**
   * El tipo de la cuenta, SOLO si pertenece al tenant que pregunta. `null`
   * cuando no existe o cuando es de otro courier — ahí no se revela nada.
   */
  tipoEnMiCourier: TipoCuenta | null;
}

/** Cuenta inexistente. Se nombra para que los llamadores no repitan el literal. */
const SIN_CUENTA: CuentaPorEmail = { existe: false, tipoEnMiCourier: null };

/**
 * Busca el usuario de Auth por correo.
 *
 * `listUsers` paginado es la única vía estable en esta versión del SDK — no hay
 * un `getUserByEmail`. El tope de páginas es defensivo: sin él, un cambio de
 * forma de la API convierte esto en un bucle infinito dentro de un formulario.
 */
async function buscarUsuarioAuth(
  cliente: ClienteConAuth,
  correo: string,
): Promise<{ id: string } | null> {
  const porPagina = 200;
  for (let pagina = 1; pagina <= 25; pagina += 1) {
    const { data, error } = await cliente.auth.admin.listUsers({ page: pagina, perPage: porPagina });
    if (error || !data) return null;
    const encontrado = data.users.find((u) => (u.email ?? "").toLowerCase() === correo);
    if (encontrado) return { id: encontrado.id };
    if (data.users.length < porPagina) return null;
  }
  return null;
}

/**
 * ¿Hay una cuenta con este correo? Y si la hay, ¿es de mi courier?
 *
 * Nunca lanza: ante un fallo de la API de Auth devuelve «no existe». Es la
 * decisión menos mala — un fallo de lectura no puede impedirle a un courier
 * invitar a su equipo, y el canje sigue teniendo su propia comprobación aguas
 * abajo.
 */
export async function buscarCuentaPorEmail(
  cliente: ClienteConAuth,
  email: string,
  tenantIdQuePregunta: string,
): Promise<CuentaPorEmail> {
  const correo = email.trim().toLowerCase();
  if (!correo) return SIN_CUENTA;

  try {
    const usuario = await buscarUsuarioAuth(cliente, correo);
    if (!usuario) return SIN_CUENTA;

    const { data: perfil } = await cliente
      .schema("identidad")
      .from("usuarios_perfil")
      .select("tipo_usuario, tenant_id")
      .eq("id", usuario.id)
      .maybeSingle();

    // Cuenta de Auth sin perfil: existe igual y ocupa el correo. Que no tenga
    // perfil es un problema aparte (lo marca el módulo de cuentas del
    // backstage), pero para invitar da lo mismo: el correo está tomado.
    if (!perfil) return { existe: true, tipoEnMiCourier: null };

    const esMiCourier = perfil.tenant_id === tenantIdQuePregunta;
    return {
      existe: true,
      tipoEnMiCourier: esMiCourier ? ((perfil.tipo_usuario as TipoCuenta) ?? null) : null,
    };
  } catch {
    return SIN_CUENTA;
  }
}

const NOMBRE_TIPO: Record<TipoCuenta, string> = {
  interno: "un usuario de tu equipo",
  seller: "un seller tuyo",
  conductor: "un conductor tuyo",
  super_admin: "una cuenta de plataforma",
};

/**
 * El mensaje que ve quien invita.
 *
 * Genérico hacia afuera —el texto que pidió el usuario— y específico hacia
 * adentro: si el correo es de su propio courier, decirle QUÉ es le ahorra la
 * media hora de no entender por qué no puede invitarlo.
 */
export function mensajeCorreoOcupado(cuenta: CuentaPorEmail): string {
  if (cuenta.tipoEnMiCourier) {
    return (
      `Ese correo ya es ${NOMBRE_TIPO[cuenta.tipoEnMiCourier]}. ` +
      "Una misma persona no puede tener dos cuentas distintas en Rutax con el mismo correo. Usa otro."
    );
  }
  return "Ese correo ya tiene una cuenta en Rutax. Usa otro.";
}
