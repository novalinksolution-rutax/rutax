/**
 * Módulo `consentimiento-ubicacion` — fuente de verdad autoritativa del
 * consentimiento del conductor para compartir su ubicación.
 *
 * Cierra ALTO-2: el consentimiento ya no vive solo en localStorage/bitácora;
 * ahora tiene una tabla propia (`operacion.consentimientos_ubicacion`) con
 * histórico de otorgar/revocar (Ley 21.431 — trazabilidad legal).
 *
 * ⚠️ SIN INTERFAZ QUE LO INVOQUE DESDE 2026-08-14. El rastreo en vivo del
 * conductor (`operacion.ubicacion_conductor`, el "ping" cada 90 s) se retiró
 * — ver `docs/seguridad/punto-de-termino-conductor.md` §1: nada lo leía, no
 * tenía purga y la última posición del día (a menudo el domicilio del
 * conductor) sobrevivía sin límite de tiempo. Con el ping fuera, este módulo
 * quedó sin ninguna Server Action que lo llame — y es a propósito: la tabla
 * `consentimientos_ubicacion` y las funciones de abajo se CONSERVAN como
 * mecanismo, porque la etapa 7 (punto de término del conductor) las reusa con
 * una columna `finalidad` nueva (`'rastreo_en_ruta'` vs `'punto_termino_ruta'`)
 * — no antes de que esa etapa se construya. No las borres ni las "reactives"
 * cableando de vuelta el ping: si vuelve a hacer falta pedir consentimiento de
 * ubicación, es para una finalidad distinta, con su propia interfaz.
 *
 * Reglas invariantes:
 * - Escritura exclusiva de service_role (sin política INSERT/UPDATE para
 *   authenticated — la migración 20260613000009 lo impone en BD).
 * - Bitácora ANTES del efecto (CLAUDE.md invariante "bitácora antes que
 *   efectos externos"). Si el INSERT en BD falla, la bitácora ya quedó; si la
 *   bitácora falla, el INSERT no se ejecuta → el estado queda indefinido sin
 *   huella.
 * - Aislamiento por tenant: toda consulta filtra por tenant_id + conductor_id.
 * - DATOS PERSONALES: ningún campo de la función expone coordenadas GPS. Los
 *   únicos datos que fluyen aquí son booleano (acepto) y versión del texto.
 *
 * Consentimiento VIGENTE:
 *   SELECT … ORDER BY otorgado_en DESC LIMIT 1
 *   vigente ⟺ fila existe AND acepto = true AND revocado_en IS NULL
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";

// =============================================================================
// Constante de versión del texto de consentimiento
// =============================================================================

/**
 * Versión del texto de consentimiento vigente.
 * El copywriter define el texto; cuando lo cambie, deberá bumpar esta constante
 * para que el historial refleje a qué redacción dio su aceptación el conductor.
 */
export const VERSION_TEXTO_CONSENTIMIENTO_UBICACION = "v1" as const;

// =============================================================================
// registrarConsentimientoUbicacion
// =============================================================================

export interface RegistrarConsentimientoInput {
  tenantId: string;
  conductorId: string;
  /** UUID del usuario auth que realiza la acción (el conductor). RNF-04. */
  actorUsuarioId: string;
  acepto: boolean;
  versionTexto: string;
}

/**
 * Inserta un nuevo registro de consentimiento en
 * `operacion.consentimientos_ubicacion`.
 *
 * Flujo:
 * 1. Bitácora (acción conductor.ubicacion.consentimiento_otorgado /
 *    conductor.ubicacion.consentimiento_rechazado).
 * 2. INSERT en la tabla autoritativa (service_role).
 *
 * La tabla conserva el histórico completo (un registro por evento de
 * otorgamiento/rechazo), lo que permite trazabilidad legal.
 *
 * @param cliente   Cliente service_role.
 * @param input     Parámetros de la operación.
 */
export async function registrarConsentimientoUbicacion(
  cliente: SupabaseClient,
  input: RegistrarConsentimientoInput,
): Promise<void> {
  const { tenantId, conductorId, actorUsuarioId, acepto, versionTexto } = input;

  // --- 1. Bitácora ANTES del efecto -------------------------------------------
  await registrarEnBitacora(cliente, {
    tenantId,
    actorUsuarioId,
    actorTipo: "usuario",
    accion: acepto
      ? "conductor.ubicacion.consentimiento_otorgado"
      : "conductor.ubicacion.consentimiento_rechazado",
    entidadTipo: "conductor",
    entidadId: conductorId,
    detalle: {
      acepto,
      versionTexto,
      // Nunca se incluyen coordenadas ni datos personales adicionales.
    },
  });

  // --- 2. INSERT autoritativo en BD -------------------------------------------
  const { error } = await cliente
    .from("consentimientos_ubicacion")
    .insert({
      tenant_id: tenantId,
      conductor_id: conductorId,
      acepto,
      version_texto: versionTexto,
      otorgado_en: new Date().toISOString(),
    });

  if (error) {
    throw new Error(
      `Error al registrar consentimiento de ubicación (acepto=${acepto}): ${error.message}`,
    );
  }
}

// =============================================================================
// revocarConsentimientoUbicacion
// =============================================================================

export interface RevocarConsentimientoInput {
  tenantId: string;
  conductorId: string;
  /** UUID del usuario auth que realiza la acción. RNF-04. */
  actorUsuarioId: string;
}

/**
 * Revoca el consentimiento vigente del conductor:
 * 1. Bitácora antes del efecto.
 * 2. Actualiza `revocado_en = now()` en el último registro otorgado vigente
 *    (acepto = true AND revocado_en IS NULL).
 *
 * Si no hay consentimiento vigente, es idempotente (no lanza error).
 *
 * NO borra `operacion.ubicacion_conductor`: esa tabla ya no se alimenta desde
 * ningún camino (el rastreo en vivo se retiró el 2026-08-14 — ver el aviso al
 * inicio del módulo), así que no hay nada que minimizar aquí. Cuando la etapa
 * 7 reuse esta función con `finalidad = 'punto_termino_ruta'`, el borrado que
 * le corresponde es el de `operacion.punto_termino_conductor`, no este.
 *
 * @param cliente   Cliente service_role.
 * @param input     Parámetros de la operación.
 */
export async function revocarConsentimientoUbicacion(
  cliente: SupabaseClient,
  input: RevocarConsentimientoInput,
): Promise<void> {
  const { tenantId, conductorId, actorUsuarioId } = input;

  // --- 1. Bitácora ANTES del efecto -------------------------------------------
  await registrarEnBitacora(cliente, {
    tenantId,
    actorUsuarioId,
    actorTipo: "usuario",
    accion: "conductor.ubicacion.consentimiento_revocado",
    entidadTipo: "conductor",
    entidadId: conductorId,
    detalle: { accion: "revocacion" },
  });

  // --- 2. Marcar revocado_en en el último consentimiento otorgado vigente ------
  // Buscamos el id del registro más reciente con acepto=true y revocado_en IS NULL.
  const { data: vigente, error: errorBusqueda } = await cliente
    .from("consentimientos_ubicacion")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("conductor_id", conductorId)
    .eq("acepto", true)
    .is("revocado_en", null)
    .order("otorgado_en", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (errorBusqueda) {
    throw new Error(
      `Error al buscar consentimiento vigente para revocar: ${errorBusqueda.message}`,
    );
  }

  if (vigente) {
    const { error: errorUpdate } = await cliente
      .from("consentimientos_ubicacion")
      .update({ revocado_en: new Date().toISOString() })
      .eq("id", vigente.id)
      .eq("tenant_id", tenantId); // defensa en profundidad: nunca escapa del tenant

    if (errorUpdate) {
      throw new Error(
        `Error al revocar consentimiento de ubicación: ${errorUpdate.message}`,
      );
    }
  }
  // Si no hay vigente, la revocación es idempotente — no hay nada que revocar.
}

// =============================================================================
// tieneConsentimientoVigente
// =============================================================================

/**
 * Verifica si el conductor tiene un consentimiento VIGENTE de ubicación:
 *   fila existe AND acepto = true AND revocado_en IS NULL
 *
 * Se ordena por `otorgado_en DESC LIMIT 1`: solo el registro más reciente
 * es determinante (un conductor puede haber revocado y vuelto a otorgar).
 *
 * @param cliente     Cliente service_role.
 * @param tenantId    UUID del tenant (aislamiento).
 * @param conductorId UUID del conductor.
 * @returns true si existe consentimiento vigente; false en cualquier otro caso.
 */
export async function tieneConsentimientoVigente(
  cliente: SupabaseClient,
  tenantId: string,
  conductorId: string,
): Promise<boolean> {
  const { data, error } = await cliente
    .from("consentimientos_ubicacion")
    .select("id, acepto, revocado_en")
    .eq("tenant_id", tenantId)
    .eq("conductor_id", conductorId)
    .order("otorgado_en", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    // Fallamos cerrado: sin poder verificar el consentimiento, no autorizamos.
    throw new Error(
      `Error al verificar consentimiento de ubicación: ${error.message}`,
    );
  }

  if (!data) return false; // Sin filas → sin consentimiento.
  return data.acepto === true && data.revocado_en === null;
}
