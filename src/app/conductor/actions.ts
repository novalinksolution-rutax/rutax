"use server";

/**
 * Lo único que sobrevive de las Server Actions de la PWA: revocar.
 * =============================================================================
 *
 * `punto-termino/actions.ts` tenía dos acciones —definir y revocar— y se fue
 * entera con el retiro de la PWA. Ésta vuelve sola, y no por simetría:
 *
 * **Revocar no es una funcionalidad, es una condición.** El punto de término es
 * dato personal bajo la Ley 21.431; quien lo entregó tiene derecho a retirarlo
 * cuando quiera. Quitar la pantalla que lo CAPTURA es una decisión de producto
 * —el flujo de consentimiento se rehace en la app nativa, en el bloque B5— pero
 * quitar la que lo BORRA deja sin salida a quien ya dijo que sí, y eso no es una
 * decisión de producto.
 *
 * El endpoint `DELETE /api/conductor/punto-termino` ya existía y sigue intacto.
 * Esto es su único acceso humano hasta que la app nativa tenga el suyo.
 */

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { revocarPuntoTermino } from "@/modules/operacion/punto-termino-conductor";

export interface ResultadoQuitarPuntoTermino {
  ok: boolean;
  mensaje?: string;
}

/**
 * El conductor retira su punto de término. Idempotente y de un toque.
 *
 * `actorUsuarioId` va siempre: es una acción sobre un dato personal y la
 * bitácora tiene que decir quién la hizo, aunque el quién y el dueño del dato
 * sean la misma persona.
 */
export async function accionQuitarPuntoTermino(): Promise<ResultadoQuitarPuntoTermino> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) redirect("/login");
  if (sesion.usuario.tipoUsuario !== "conductor") redirect("/");
  if (!sesion.usuario.driverId) redirect("/login");

  const cliente = crearClienteServiceRole();

  try {
    await revocarPuntoTermino(cliente, {
      tenantId: sesion.usuario.tenantId,
      conductorId: sesion.usuario.driverId,
      actorUsuarioId: sesion.usuarioId,
    });

    revalidatePath("/conductor");
    return { ok: true };
  } catch {
    return { ok: false, mensaje: "No pudimos quitar tu punto de término. Inténtalo de nuevo." };
  }
}
