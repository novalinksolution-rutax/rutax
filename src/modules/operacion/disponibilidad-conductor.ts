/**
 * «Marcarme disponible» — la asistencia, en manos del conductor.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * QUIÉN DECIDE ESTO, Y POR QUÉ CAMBIÓ
 * -----------------------------------------------------------------------------
 * `conductores.disponible` decía quién trabaja hoy, y **solo el coordinador
 * podía tocarlo**. Eso significaba que la asistencia se definía en una lista
 * aparte —por WhatsApp, en la práctica— y después alguien la transcribía a
 * Rutax. El campo describía la creencia del coordinador, no un hecho.
 *
 * Decisión del usuario (24-08-2026): **pasa a ser solo del conductor.** Él se
 * marca disponible al empezar su turno, desde la app.
 *
 * La regla queda asimétrica a propósito, y vale la pena escribirla entera:
 *
 * · **Ponerse disponible** es del conductor y solo suyo. El coordinador no
 *   puede meter en la asignación a alguien que no se presentó — que es
 *   justamente el bug que esto arregla: el campo describía una creencia.
 * · **Sacarlo** sigue siendo del coordinador, pero por un camino distinto: el
 *   de «se cayó a mitad de ruta» (`redistribuirPorConductorCaido`). Eso no es
 *   asistencia, es una respuesta a un incidente, y lo que resuelve es quién
 *   entrega esas paradas. Dejar de estar disponible es su consecuencia, no su
 *   propósito.
 *
 * ⚠️ **La contrapartida es real y se asumió a propósito:** si un conductor no se
 * marca y no contesta el teléfono, el coordinador **no tiene forma de meterlo en
 * la auto-asignación**. La pantalla de conductores lo dice con esas palabras, en
 * el lugar donde antes estaba el interruptor — quitar un control sin explicar
 * qué lo reemplazó es cómo se generan las llamadas que esto viene a evitar.
 *
 * -----------------------------------------------------------------------------
 * LA BITÁCORA SIGUE, Y AHORA DICE ALGO DISTINTO
 * -----------------------------------------------------------------------------
 * Se registra igual, antes del efecto, pero el actor ya no es un usuario interno
 * actuando sobre un tercero: es el conductor sobre sí mismo. `actorTipo` sigue
 * siendo `usuario` porque el conductor **tiene** sesión de usuario, y el
 * `entidadId` es él mismo. Que actor y entidad coincidan es la señal de que la
 * marca la puso quien trabaja, no quien reparte el trabajo.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { ErrorValidacion } from "@/modules/identidad/errores";

export interface DisponibilidadConductor {
  disponible: boolean;
  /** Paradas que ya tiene asignadas hoy. Manda la advertencia al apagarse. */
  capacidadParadas: number | null;
}

export async function leerDisponibilidad(
  cliente: SupabaseClient,
  entrada: { tenantId: string; conductorId: string },
): Promise<DisponibilidadConductor | null> {
  const { data, error } = await cliente
    .schema("identidad")
    .from("conductores")
    .select("disponible, capacidad_paradas")
    .eq("id", entrada.conductorId)
    .eq("tenant_id", entrada.tenantId)
    .maybeSingle();

  if (error) throw new Error(`Error al leer la disponibilidad: ${error.message}`);
  if (!data) return null;

  return {
    disponible: Boolean(data.disponible),
    capacidadParadas: (data.capacidad_paradas as number | null) ?? null,
  };
}

/**
 * El conductor se marca (o se desmarca) disponible para hoy.
 *
 * No recibe `conductorId` de fuera: sale de la sesión de quien llama. Aceptarlo
 * como parámetro abriría la puerta a que un conductor marque a otro, que es
 * exactamente lo que esta función viene a impedir al quitarle el control al
 * coordinador.
 */
export async function marcarmeDisponible(
  cliente: SupabaseClient,
  entrada: {
    tenantId: string;
    /** El conductor de la sesión. Nunca un id que venga del cuerpo del request. */
    conductorId: string;
    usuarioId: string;
    disponible: boolean;
  },
): Promise<DisponibilidadConductor> {
  const actual = await leerDisponibilidad(cliente, entrada);
  if (!actual) {
    throw new ErrorValidacion("No encontramos tu ficha de conductor en este courier.");
  }

  // Bitácora ANTES del efecto. Es la marca de asistencia de una persona: si el
  // update falla después, tiene que quedar registrado que lo intentó.
  await registrarEnBitacora(cliente, {
    tenantId: entrada.tenantId,
    actorUsuarioId: entrada.usuarioId,
    actorTipo: "usuario",
    accion: entrada.disponible
      ? "conductor.disponible_activado"
      : "conductor.disponible_desactivado",
    entidadTipo: "conductor",
    entidadId: entrada.conductorId,
    detalle: {
      conductor_id: entrada.conductorId,
      disponible: entrada.disponible,
      // El origen distingue esta marca de las que quedaron de cuando el
      // coordinador podía ponerla. Sin esto, la bitácora histórica y la nueva
      // se leen igual y no se puede saber quién marcaba antes.
      origen: "app_conductor",
    },
  });

  const { data, error } = await cliente
    .schema("identidad")
    .from("conductores")
    .update({ disponible: entrada.disponible })
    .eq("id", entrada.conductorId)
    .eq("tenant_id", entrada.tenantId)
    .select("disponible, capacidad_paradas")
    .maybeSingle();

  if (error) throw new Error(`Error al guardar tu disponibilidad: ${error.message}`);
  if (!data) throw new ErrorValidacion("No encontramos tu ficha de conductor en este courier.");

  return {
    disponible: Boolean(data.disponible),
    capacidadParadas: (data.capacidad_paradas as number | null) ?? null,
  };
}
