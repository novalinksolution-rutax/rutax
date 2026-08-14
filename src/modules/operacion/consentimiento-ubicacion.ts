/**
 * Módulo `consentimiento-ubicacion` — fuente de verdad autoritativa del
 * consentimiento del conductor para compartir su ubicación.
 *
 * Cierra ALTO-2: el consentimiento ya no vive solo en localStorage/bitácora;
 * ahora tiene una tabla propia (`operacion.consentimientos_ubicacion`) con
 * histórico de otorgar/revocar (Ley 21.431 — trazabilidad legal).
 *
 * ⚠️ EL CONSENTIMIENTO ES **POR FINALIDAD** (desde 2026-08-14, etapa 7). Son
 * dos tratamientos distintos —dónde estás durante el turno / dónde vives— y
 * mezclarlos rompe en las DOS direcciones: revocar el rastreo apagaría el punto
 * de término sin que nadie lo pidiera, y tener vigente el del rastreo se leería
 * como permiso para guardar la casa.
 *
 *   - `'rastreo_en_ruta'`    — posición durante el turno. **Sin escritor desde
 *     el 2026-08-14**: el ping cada 90 s se retiró entero (nada lo leía, no
 *     tenía purga y la última posición del día —a menudo el domicilio— vivía
 *     para siempre; ver `docs/seguridad/punto-de-termino-conductor.md` §1). El
 *     histórico de esos consentimientos se conserva por trazabilidad legal.
 *   - `'punto_termino_ruta'` — dónde termina la ruta, o sea el domicilio. Es la
 *     finalidad que usa `punto-termino-conductor.ts`.
 *
 * ⚠️ **`finalidad` es un parámetro OBLIGATORIO y SIN DEFAULT, a propósito.** La
 * columna sí tiene default en la base (`'rastreo_en_ruta'`, para backfilear el
 * histórico), pero aquí no puede haberlo: un parámetro opcional dejaría
 * compilar las llamadas viejas —que consultarían sin filtrar— y un
 * consentimiento de punto de término pasaría a autorizar el rastreo en vivo.
 * El error aparecería en producción, no en el compilador. Con el parámetro
 * obligatorio, tocar la columna obliga a tocar las dos mitades a la vez.
 * No le pongas un valor por defecto "para no romper llamadas": romperlas es el
 * punto.
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
 * Consentimiento VIGENTE (siempre acotado a UNA finalidad):
 *   SELECT … WHERE finalidad = ? ORDER BY otorgado_en DESC LIMIT 1
 *   vigente ⟺ fila existe AND acepto = true AND revocado_en IS NULL
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";

// =============================================================================
// Finalidades — espejo del CHECK `consentimientos_ubicacion_finalidad_valida`
// =============================================================================

/**
 * Las finalidades admitidas. Espejo EXACTO del CHECK de la migración
 * `20260814000003`. Si agregas una en SQL, agrégala aquí en el mismo cambio:
 * el CHECK rechaza con 23514 lo que esta lista no conozca, y al revés esta
 * lista dejaría compilar un INSERT que la base va a rechazar en ejecución.
 */
export const FINALIDADES_CONSENTIMIENTO_UBICACION = [
  "rastreo_en_ruta",
  "punto_termino_ruta",
] as const;

export type FinalidadConsentimientoUbicacion =
  (typeof FINALIDADES_CONSENTIMIENTO_UBICACION)[number];

// =============================================================================
// Constantes de versión del texto de consentimiento
// =============================================================================

/**
 * Versión del texto de consentimiento del RASTREO EN VIVO.
 * Congelada: esa finalidad ya no tiene escritor (el ping se retiró el
 * 2026-08-14). Se conserva porque el histórico de la tabla la referencia.
 */
export const VERSION_TEXTO_CONSENTIMIENTO_UBICACION = "v1" as const;

/**
 * Versión del texto de consentimiento del PUNTO DE TÉRMINO.
 *
 * ⚠️ El texto todavía no está escrito — lo redacta `copywriter`, y el contenido
 * obligatorio está en `docs/seguridad/punto-de-termino-conductor.md` §5.2:
 * qué se guarda (un punto aproximado, no una dirección), para qué, quién lo ve
 * (nadie más que él), que es opcional y que no pasa nada si no lo define, cuánto
 * dura, y —con todas sus letras— el residuo del §4.4: *"Tu jefe no va a ver tu
 * dirección ni el punto que marcaste. Lo que sí va a notar, con el tiempo, es
 * que tus rutas tienden a terminar por tu sector."* Cuando ese texto exista o
 * cambie, SUBE esta constante: es lo que permite saber a qué redacción dijo que
 * sí cada conductor.
 */
export const VERSION_TEXTO_CONSENTIMIENTO_PUNTO_TERMINO = "v1" as const;

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
  /** PARA QUÉ. Obligatorio y sin default — ver el aviso al inicio del módulo. */
  finalidad: FinalidadConsentimientoUbicacion;
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
  const { tenantId, conductorId, actorUsuarioId, acepto, versionTexto, finalidad } = input;

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
      // La FINALIDAD sí va: es lo que hace auditable "a qué dijo que sí". No es
      // un dato personal — es una etiqueta de propósito.
      finalidad,
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
      finalidad,
      otorgado_en: new Date().toISOString(),
    });

  if (error) {
    throw new Error(
      `Error al registrar consentimiento de ubicación (finalidad=${finalidad}, acepto=${acepto}): ${error.message}`,
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
  /** QUÉ se revoca. Obligatorio y sin default — ver el aviso al inicio. */
  finalidad: FinalidadConsentimientoUbicacion;
}

/**
 * Revoca el consentimiento vigente del conductor PARA UNA FINALIDAD:
 * 1. Bitácora antes del efecto.
 * 2. Actualiza `revocado_en = now()` en el último registro otorgado vigente
 *    de esa finalidad (acepto = true AND revocado_en IS NULL).
 *
 * Si no hay consentimiento vigente, es idempotente (no lanza error).
 *
 * **Cada revocación borra LO SUYO, y esta función no borra nada.** El dato que
 * cuelga de cada finalidad lo borra su propio módulo, porque solo él sabe cuál
 * es: `punto-termino-conductor.ts::revocarPuntoTermino` borra la fila de
 * `operacion.punto_termino_conductor` justo después de llamar aquí. La
 * finalidad `'rastreo_en_ruta'` no tiene nada que borrar —su tabla se vació y
 * se quedó sin escritores el 2026-08-14—. Si algún día se agrega una finalidad
 * nueva, su borrado va en su módulo, no aquí: meterlo en esta función la haría
 * conocer todas las tablas de todas las finalidades.
 *
 * @param cliente   Cliente service_role.
 * @param input     Parámetros de la operación.
 */
export async function revocarConsentimientoUbicacion(
  cliente: SupabaseClient,
  input: RevocarConsentimientoInput,
): Promise<void> {
  const { tenantId, conductorId, actorUsuarioId, finalidad } = input;

  // --- 1. Bitácora ANTES del efecto -------------------------------------------
  await registrarEnBitacora(cliente, {
    tenantId,
    actorUsuarioId,
    actorTipo: "usuario",
    accion: "conductor.ubicacion.consentimiento_revocado",
    entidadTipo: "conductor",
    entidadId: conductorId,
    detalle: { accion: "revocacion", finalidad },
  });

  // --- 2. Marcar revocado_en en el último consentimiento otorgado vigente ------
  // Buscamos el id del registro más reciente con acepto=true y revocado_en IS NULL
  // DE ESA FINALIDAD. Sin el filtro, revocar el punto de término marcaría como
  // revocado un consentimiento de rastreo (o al revés).
  const { data: vigente, error: errorBusqueda } = await cliente
    .from("consentimientos_ubicacion")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("conductor_id", conductorId)
    .eq("finalidad", finalidad)
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
 * Verifica si el conductor tiene un consentimiento VIGENTE **para la finalidad
 * indicada**:
 *   fila existe AND acepto = true AND revocado_en IS NULL
 *
 * Se ordena por `otorgado_en DESC LIMIT 1`: solo el registro más reciente
 * de esa finalidad es determinante (un conductor puede haber revocado y vuelto
 * a otorgar).
 *
 * ⚠️ `finalidad` es el 4.º parámetro y es OBLIGATORIO. Hasta el 2026-08-14 esta
 * función NO filtraba por finalidad, porque solo existía una. Darle un valor
 * por defecto ahora reintroduciría exactamente el fallo que la columna vino a
 * cerrar: un consentimiento de punto de término autorizando el rastreo en vivo.
 *
 * @param cliente     Cliente service_role.
 * @param tenantId    UUID del tenant (aislamiento).
 * @param conductorId UUID del conductor.
 * @param finalidad   Para qué tratamiento se pregunta.
 * @returns true si existe consentimiento vigente de ESA finalidad; false en
 *          cualquier otro caso.
 */
export async function tieneConsentimientoVigente(
  cliente: SupabaseClient,
  tenantId: string,
  conductorId: string,
  finalidad: FinalidadConsentimientoUbicacion,
): Promise<boolean> {
  const { data, error } = await cliente
    .from("consentimientos_ubicacion")
    .select("id, acepto, revocado_en")
    .eq("tenant_id", tenantId)
    .eq("conductor_id", conductorId)
    .eq("finalidad", finalidad)
    .order("otorgado_en", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    // Fallamos cerrado: sin poder verificar el consentimiento, no autorizamos.
    throw new Error(
      `Error al verificar consentimiento de ubicación (finalidad=${finalidad}): ${error.message}`,
    );
  }

  if (!data) return false; // Sin filas → sin consentimiento.
  return data.acepto === true && data.revocado_en === null;
}
