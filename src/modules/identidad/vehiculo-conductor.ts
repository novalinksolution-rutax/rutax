/**
 * «Mi vehículo» — auto o moto, en manos del conductor.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * QUIÉN DECIDE ESTO, Y POR QUÉ CAMBIÓ (2026-09-05)
 * -----------------------------------------------------------------------------
 * `conductores.vehiculo` nació INFORMATIVO y **de solo lectura para el
 * conductor** (migración `20260826000005`): lo declaraba el coordinador en la
 * nómina y nada lo consumía. La objeción escrita entonces era literal: dejar que
 * el conductor lo cambiara «movería un dato con el que el courier reparte, desde
 * la calle y sin que nadie se entere».
 *
 * Decisión del usuario (2026-09-05): **pasa a ser del conductor**, que lo elige
 * en sus ajustes, porque ahora el dato SÍ hace algo — el motor de ruta traza y
 * estima el tiempo según el vehículo (moto → `TWO_WHEELER`; ver
 * `operacion/ruta-manifiesto.ts`). El coordinador lo sigue viendo en la nómina;
 * última escritura gana.
 *
 * -----------------------------------------------------------------------------
 * POR ESO ESTO LLEVA BITÁCORA (y `guardarMiPerfilConductor` no)
 * -----------------------------------------------------------------------------
 * El «sin que nadie se entere» de la objeción original se responde AQUÍ: cada
 * cambio queda registrado, con su autor, antes del efecto. Actor y entidad
 * coinciden (el conductor sobre sí mismo), igual que en la asistencia — la señal
 * de que la marca la puso quien conduce, no quien reparte el trabajo.
 *
 * -----------------------------------------------------------------------------
 * `null` = SIN DECLARAR, y no se inventa
 * -----------------------------------------------------------------------------
 * La lectura devuelve `null` tal cual para los conductores que existían antes de
 * esta función: la nómina lo muestra como «sin declarar» y el motor lo trata
 * como auto (que es como ruteaba a todos hasta hoy). La app muestra Auto
 * seleccionado por defecto, pero NO escribe hasta que el conductor elige — así
 * el `null` de la base no se pisa con un dato que nadie afirmó.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { ErrorValidacion } from "@/modules/identidad/errores";

export type VehiculoConductor = "moto" | "auto";

export interface EstadoVehiculoConductor {
  /** `null` = sin declarar. La app lo muestra como Auto, sin escribirlo. */
  vehiculo: VehiculoConductor | null;
}

export async function leerVehiculoConductor(
  cliente: Pick<SupabaseClient, "schema">,
  entrada: { tenantId: string; conductorId: string },
): Promise<EstadoVehiculoConductor | null> {
  const { data, error } = await cliente
    .schema("identidad")
    .from("conductores")
    .select("vehiculo")
    .eq("id", entrada.conductorId)
    .eq("tenant_id", entrada.tenantId)
    .maybeSingle();

  if (error) throw new Error(`Error al leer el vehículo: ${error.message}`);
  if (!data) return null;

  return { vehiculo: (data.vehiculo as VehiculoConductor | null) ?? null };
}

/**
 * El conductor declara su vehículo.
 *
 * No recibe `conductorId` de fuera: sale de la sesión de quien llama. Aceptarlo
 * como parámetro dejaría que un conductor cambie el de otro, y ese dato ahora
 * gobierna cómo se traza la ruta de esa otra persona.
 */
export async function fijarVehiculoConductor(
  cliente: SupabaseClient,
  entrada: {
    tenantId: string;
    /** El conductor de la sesión. Nunca un id que venga del cuerpo del request. */
    conductorId: string;
    usuarioId: string;
    vehiculo: VehiculoConductor;
  },
): Promise<EstadoVehiculoConductor> {
  const actual = await leerVehiculoConductor(cliente, entrada);
  if (!actual) {
    throw new ErrorValidacion("No encontramos tu ficha de conductor en este courier.");
  }

  // Bitácora ANTES del efecto: es justo el «sin que nadie se entere» que la
  // decisión original temía. Si el update falla después, queda que lo intentó.
  await registrarEnBitacora(cliente, {
    tenantId: entrada.tenantId,
    actorUsuarioId: entrada.usuarioId,
    actorTipo: "usuario",
    accion: "conductor.vehiculo_declarado",
    entidadTipo: "conductor",
    entidadId: entrada.conductorId,
    detalle: {
      conductor_id: entrada.conductorId,
      vehiculo: entrada.vehiculo,
      vehiculo_anterior: actual.vehiculo,
      origen: "app_conductor",
    },
  });

  const { data, error } = await cliente
    .schema("identidad")
    .from("conductores")
    .update({ vehiculo: entrada.vehiculo })
    .eq("id", entrada.conductorId)
    .eq("tenant_id", entrada.tenantId)
    .select("vehiculo")
    .maybeSingle();

  if (error) throw new Error(`Error al guardar tu vehículo: ${error.message}`);
  if (!data) throw new ErrorValidacion("No encontramos tu ficha de conductor en este courier.");

  return { vehiculo: (data.vehiculo as VehiculoConductor | null) ?? null };
}
