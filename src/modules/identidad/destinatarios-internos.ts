/**
 * A quién del courier hay que avisarle cuando algo se atasca.
 *
 * =============================================================================
 * POR QUÉ ES UN MÓDULO COMPARTIDO Y NO CÓDIGO DENTRO DE UN JOB
 * =============================================================================
 * Dos alertas distintas necesitan lo mismo —`conexion-caida.ts` (la conexión ML
 * de un seller se cayó) y `notificacion-incidencias-sin-gestion.ts` (una
 * incidencia lleva horas sin que nadie la tome)— y las dos arrastraban el MISMO
 * `TODO (Fase C/devops)` desde hace meses. Resolverlo dos veces habría producido
 * dos criterios distintos de "quién es el responsable", que es exactamente la
 * clase de divergencia que después nadie sabe explicar.
 *
 * =============================================================================
 * QUIÉN RECIBE, Y POR QUÉ ESE CRITERIO
 * =============================================================================
 * Los usuarios INTERNOS y ACTIVOS del tenant cuyo rol tiene responsabilidad
 * operativa: `dueno`, `supervisor` y `coordinador`. Se excluye `administracion`
 * a propósito — ese rol lleva la trastienda financiera, y llenarle la bandeja de
 * alertas operativas hace que deje de mirar las suyas.
 *
 * Se avisa a TODOS los que califican, no solo al primero. La versión anterior de
 * este criterio (en `conexion-caida.ts`) tomaba "el primer usuario interno tipo
 * dueño o admin", y eso significa que si esa persona está de vacaciones la
 * alerta no existe para nadie más.
 *
 * =============================================================================
 * EL EMAIL VIVE EN `auth.users`, NO EN EL PERFIL
 * =============================================================================
 * `identidad.usuarios_perfil` guarda el rol y el tenant, pero no la dirección de
 * correo: ésa la administra Supabase Auth. Hay que resolverla con
 * `auth.admin.getUserById`, que exige `service_role`.
 *
 * ⚠️ El correo de una persona es dato personal. Esta función lo devuelve para
 * usarlo como DESTINATARIO y nada más: no se loguea, no se guarda en la
 * bitácora y no se devuelve a ninguna pantalla.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Roles con responsabilidad operativa: los que deben enterarse de un atasco. */
const ROLES_QUE_RECIBEN_ALERTAS_OPERATIVAS = ["dueno", "supervisor", "coordinador"] as const;

/**
 * Tope de destinatarios por alerta. Un courier con veinte internos no necesita
 * veinte copias del mismo aviso, y sin tope una alerta por incidencia se
 * multiplicaría por el tamaño del equipo.
 */
const MAX_DESTINATARIOS = 5;

export interface DestinatarioInterno {
  usuarioId: string;
  email: string;
  rol: string;
}

/**
 * Resuelve a quién avisarle en este courier. Devuelve `[]` si no hay nadie
 * elegible — y eso NO es un error: un tenant recién creado puede no tener
 * todavía usuarios activos. El llamador decide si eso merece un log.
 *
 * NUNCA lanza: una alerta que no se puede entregar no debe tumbar el job que la
 * emite. El peor caso es que el aviso quede solo en bitácora, que es donde ya
 * estaba antes de existir esta función.
 */
export async function resolverDestinatariosInternos(
  cliente: SupabaseClient,
  tenantId: string,
): Promise<DestinatarioInterno[]> {
  try {
    const { data: perfiles, error } = await cliente
      .from("usuarios_perfil")
      .select("id, rol")
      .eq("tenant_id", tenantId)
      .eq("tipo_usuario", "interno")
      .eq("estado", "activo")
      .in("rol", [...ROLES_QUE_RECIBEN_ALERTAS_OPERATIVAS])
      // `dueno` antes que `supervisor` antes que `coordinador` no sale de un
      // orden alfabético feliz: es el orden en que se prefiere gastar el tope
      // de destinatarios si el equipo es grande.
      .order("rol", { ascending: true })
      .limit(MAX_DESTINATARIOS);

    if (error || !perfiles || perfiles.length === 0) return [];

    const destinatarios: DestinatarioInterno[] = [];
    for (const perfil of perfiles) {
      const usuarioId = perfil.id as string;
      try {
        const { data } = await cliente.auth.admin.getUserById(usuarioId);
        const email = data?.user?.email;
        // Un usuario sin correo en Auth es un estado posible (invitado que
        // nunca completó): se salta, no se rompe el resto del envío.
        if (email) {
          destinatarios.push({ usuarioId, email, rol: perfil.rol as string });
        }
      } catch {
        // Ídem: el fallo de UNO no puede dejar sin aviso a los demás.
      }
    }

    return destinatarios;
  } catch {
    return [];
  }
}
