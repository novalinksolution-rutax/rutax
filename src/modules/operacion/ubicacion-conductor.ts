/**
 * Módulo `ubicacion-conductor` — tracking en vivo (última posición).
 *
 * Una sola fila por conductor (PK = conductor_id). El backend hace UPSERT con
 * la última posición conocida. SIN tabla de histórico/trail — minimización de
 * datos personales del trabajador (Ley 21.431): solo la última posición, no
 * el recorrido.
 *
 * Reglas de negocio:
 * - Solo se escribe si el conductor tiene un manifiesto en 'en_ruta' HOY
 *   (sin manifiesto activo → no-op). Evita acumular ubicaciones fuera del turno.
 * - EL SELLER NO ACCEDE a esta tabla (dato sensible del trabajador).
 * - Las escrituras NUNCA loguean lat/long en bitácora ni en logs (datos personales).
 * - Al completar/cerrar el manifiesto o cerrar sesión, se llama a
 *   `borrarUbicacionAlCerrarRuta` para minimizar la retención.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { ahoraEnSantiago } from "@/lib/fecha-santiago";
import { tieneConsentimientoVigente } from "@/modules/operacion/consentimiento-ubicacion";

// =============================================================================
// Tipo de dominio
// =============================================================================

export interface UbicacionConductor {
  conductorId: string;
  tenantId: string;
  lat: number | null;
  long: number | null;
  precisionM: number | null;
  actualizadoEn: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function filaAUbicacion(fila: Record<string, any>): UbicacionConductor {
  return {
    conductorId: fila.conductor_id,
    tenantId: fila.tenant_id,
    lat: fila.lat ?? null,
    long: fila.long ?? null,
    precisionM: fila.precision_m ?? null,
    actualizadoEn: fila.actualizado_en,
  };
}

// =============================================================================
// actualizarUbicacionConductor
// =============================================================================

/**
 * UPSERT de la última posición del conductor.
 *
 * Pre-condición: el conductor debe tener un manifiesto en 'en_ruta' con
 * fecha_operacion = hoy (hora local Santiago). Si no hay manifiesto activo,
 * la función es un no-op y devuelve null.
 *
 * DATOS PERSONALES: lat/long NUNCA se incluyen en logs ni en bitácora.
 * El campo de detalle de auditoría no lleva coordenadas.
 *
 * @param cliente    Cliente service_role.
 * @param conductorId UUID del conductor.
 * @param tenantId   UUID del tenant (aislamiento).
 * @param posicion   Posición GPS actual.
 */
export async function actualizarUbicacionConductor(
  cliente: SupabaseClient,
  conductorId: string,
  tenantId: string,
  posicion: { lat: number; long: number; precisionM?: number },
): Promise<UbicacionConductor | null> {
  // --- 1. Verificar manifiesto en_ruta hoy (pre-condición) ----------------
  const { fecha: hoy } = ahoraEnSantiago();

  const { data: manifiestoActivo } = await cliente
    .from("manifiestos")
    .select("id")
    .eq("conductor_id", conductorId)
    .eq("tenant_id", tenantId)
    .eq("estado", "en_ruta")
    .eq("fecha_operacion", hoy)
    .limit(1)
    .maybeSingle();

  // Sin manifiesto en_ruta hoy → no-op (no acumulamos ubicaciones fuera de turno).
  if (!manifiestoActivo) return null;

  // --- 2. Gate de consentimiento (defensa en profundidad) ------------------
  // El cliente no debe enviar pings sin consentimiento, pero el servidor es la
  // fuente de verdad — nunca confiamos solo en que el front haya bloqueado el ping.
  // DATOS PERSONALES: si no hay consentimiento vigente, no escribimos nada;
  // no logueamos las coordenadas en ningún caso.
  const hayConsentimiento = await tieneConsentimientoVigente(
    cliente,
    tenantId,
    conductorId,
  );
  if (!hayConsentimiento) return null;

  // --- 3. UPSERT (una fila por conductor) ---------------------------------
  // DATOS PERSONALES: no logueamos las coordenadas.
  const { data, error } = await cliente
    .from("ubicacion_conductor")
    .upsert(
      {
        conductor_id: conductorId,
        tenant_id: tenantId,
        lat: posicion.lat,
        long: posicion.long,
        precision_m: posicion.precisionM ?? null,
        actualizado_en: new Date().toISOString(),
      },
      {
        onConflict: "conductor_id",
        ignoreDuplicates: false, // queremos actualizar el registro existente
      },
    )
    .select()
    .single();

  if (error) {
    throw new Error(`Error al actualizar ubicación del conductor: ${error.message}`);
  }
  if (!data) {
    throw new Error("No se pudo obtener la fila de ubicación tras el UPSERT.");
  }

  return filaAUbicacion(data);
}

// =============================================================================
// borrarUbicacionAlCerrarRuta
// =============================================================================

/**
 * Elimina la fila de ubicación del conductor al completar/cerrar el manifiesto
 * o al cerrar sesión.
 *
 * Minimización de datos: Ley 21.431 — no conservamos la última posición fuera
 * del turno activo. La función es idempotente: si no hay fila, el DELETE es
 * un no-op.
 *
 * DATOS PERSONALES: la eliminación no se loguea con coordenadas.
 *
 * @param cliente    Cliente service_role.
 * @param conductorId UUID del conductor.
 * @param tenantId   UUID del tenant (aislamiento).
 */
export async function borrarUbicacionAlCerrarRuta(
  cliente: SupabaseClient,
  conductorId: string,
  tenantId: string,
): Promise<void> {
  const { error } = await cliente
    .from("ubicacion_conductor")
    .delete()
    .eq("conductor_id", conductorId)
    .eq("tenant_id", tenantId);

  if (error) {
    throw new Error(`Error al borrar ubicación del conductor al cerrar ruta: ${error.message}`);
  }
}
