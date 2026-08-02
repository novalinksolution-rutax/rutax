/**
 * Módulo `evidencias-entrega` — evidencia de entrega INFORMATIVA (capa paralela a ML Flex).
 *
 * DIFERENCIA con `pruebas-entrega` (POD autoritativo same-day):
 *   - `pruebas-entrega` es el POD AUTORITATIVO del same-day: su foto ES la
 *     confirmación de entrega (es_valido, entregado/fallido) y está AMURALLADA del
 *     Flex por una frontera dura.
 *   - `evidencias-entrega` es INFORMATIVA: NUNCA cambia el estado del pedido. Existe
 *     para que el courier tenga su PROPIO archivo de evidencias (disputas, reclamos,
 *     auditoría). Por eso SÍ aplica a Flex: en Flex el estado lo gobierna la app de
 *     Mercado Envíos Flex (obligatoria, no integrable — CLAUDE.md). Esta capa corre
 *     en PARALELO y solo guarda evidencia; NO reemplaza la app de ML. Admite también
 *     same-day como evidencia suplementaria.
 *
 * Reglas de negocio:
 * - Conductor autenticado dueño del pedido (driverId === pedido.driver_id_asignado).
 * - Aplica a cualquier tipo_pedido (Flex o same-day) — sin frontera de tipo.
 * - Geocerca Haversine (reusa POD_GEOCERCA_RADIO_M y haversineMetros de pruebas-entrega).
 *   'fuera' NO bloquea: la evidencia se guarda igual y queda marcada para revisión.
 * - VARIAS evidencias por pedido (el conductor puede adjuntar varias fotos).
 * - Idempotente por PK provista por el cliente (sync offline): un reintento con el
 *   mismo id devuelve el existente en vez de duplicar.
 * - Bitácora ANTES del insert (patrón del proyecto: bitácora primero, efecto después).
 * - NO sube fotos; recibe fotoObjectPath ya subido por el frontend a Storage.
 *
 * Las ubicaciones y paths de fotos NO se loguean (datos personales / sensibles).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { puedeMarcarEvidenciasPropias } from "@/modules/identidad/capacidades";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { ErrorValidacion } from "@/modules/identidad/errores";
import { ErrorPedidoNoEncontrado } from "./errores";
import type { UsuarioActual } from "@/modules/identidad/usuario-actual";
import {
  haversineMetros,
  POD_GEOCERCA_RADIO_M,
  type PodGeoResultado,
} from "./pruebas-entrega";

// =============================================================================
// Tipos de dominio
// =============================================================================

export interface EvidenciaEntrega {
  id: string;
  tenantId: string;
  pedidoId: string;
  sellerId: string;
  conductorId: string;
  /** Path en el bucket privado pod-evidencias. NUNCA una URL pública. */
  fotoObjectPath: string;
  nota: string | null;
  geoLat: number | null;
  geoLong: number | null;
  geoPrecisionM: number | null;
  distanciaDestinoM: number | null;
  geocercaResultado: PodGeoResultado;
  capturadoEn: string;
  subidoEn: string;
  creadoEn: string;
}

export interface RegistrarEvidenciaEntrada {
  pedidoId: string;
  tenantId: string;
  /** Path en bucket pod-evidencias ya subido por el frontend. Requerido. */
  fotoObjectPath: string;
  /** Caption opcional del conductor. */
  nota?: string;
  /**
   * Id provisto por el cliente para idempotencia de sync offline. Si se reenvía
   * la misma evidencia (reintento), devuelve la existente sin duplicar. Opcional:
   * si no se provee, la BD genera uno.
   */
  evidenciaId?: string;
  /** Posición GPS del conductor al capturar la evidencia. */
  geo?: {
    lat: number;
    long: number;
    precisionM?: number;
  };
}

// =============================================================================
// Mapper BD → EvidenciaEntrega
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function filaAEvidencia(fila: Record<string, any>): EvidenciaEntrega {
  return {
    id: fila.id,
    tenantId: fila.tenant_id,
    pedidoId: fila.pedido_id,
    sellerId: fila.seller_id,
    conductorId: fila.conductor_id,
    fotoObjectPath: fila.foto_object_path,
    nota: fila.nota ?? null,
    geoLat: fila.geo_lat ?? null,
    geoLong: fila.geo_long ?? null,
    geoPrecisionM: fila.geo_precision_m ?? null,
    distanciaDestinoM: fila.distancia_destino_m ?? null,
    geocercaResultado: (fila.geocerca_resultado ?? "sin_referencia") as PodGeoResultado,
    capturadoEn: fila.capturado_en,
    subidoEn: fila.subido_en,
    creadoEn: fila.creado_en,
  };
}

// =============================================================================
// registrarEvidenciaEntrega
// =============================================================================

/**
 * Registra una evidencia informativa de entrega capturada por el conductor.
 *
 * Aplica a cualquier tipo de pedido (Flex o same-day). NO cambia el estado del
 * pedido — es un archivo de evidencia paralelo. El frontend sube la foto a Storage
 * antes de llamar a esta función; aquí solo se recibe el fotoObjectPath resultante.
 *
 * Idempotente: si se provee evidenciaId y ya existe, devuelve la existente.
 *
 * Bitácora ANTES del INSERT. Datos personales (geo, foto_path) NO se incluyen en
 * el detalle de la bitácora.
 */
export async function registrarEvidenciaEntrega(
  cliente: SupabaseClient,
  entrada: RegistrarEvidenciaEntrada,
  actor: UsuarioActual,
): Promise<EvidenciaEntrega> {
  // --- 1. RBAC + validación de actor ------------------------------------
  if (!puedeMarcarEvidenciasPropias(actor)) {
    throw new ErrorValidacion(
      "El usuario no tiene capacidad para registrar evidencias de entrega.",
    );
  }
  if (!actor.driverId) {
    throw new ErrorValidacion(
      "El actor no tiene driverId — solo conductores pueden registrar evidencias.",
    );
  }
  if (!entrada.fotoObjectPath) {
    throw new ErrorValidacion("Se requiere una foto para registrar la evidencia.");
  }

  // --- 2. Leer el pedido (cualquier tipo; asignado al conductor) --------
  const { data: pedido, error: errorPedido } = await cliente
    .from("pedidos")
    .select("id, tenant_id, seller_id, driver_id_asignado, lat, long, geo_estado")
    .eq("id", entrada.pedidoId)
    .eq("tenant_id", entrada.tenantId)
    .maybeSingle();

  if (errorPedido) {
    throw new Error(`Error al leer el pedido para evidencia: ${errorPedido.message}`);
  }
  if (!pedido) {
    throw new ErrorPedidoNoEncontrado(entrada.pedidoId);
  }

  // El conductor solo actúa sobre pedidos asignados a él.
  if (pedido.driver_id_asignado !== actor.driverId) {
    throw new ErrorValidacion(
      "El conductor solo puede registrar evidencias de pedidos asignados a él.",
    );
  }

  // --- 3. Idempotencia por id provisto por el cliente -------------------
  if (entrada.evidenciaId) {
    const { data: existente } = await cliente
      .from("evidencias_entrega")
      .select("*")
      .eq("id", entrada.evidenciaId)
      .eq("tenant_id", entrada.tenantId)
      .maybeSingle();

    if (existente) {
      return filaAEvidencia(existente);
    }
  }

  // --- 4. Calcular geocerca --------------------------------------------
  let geocercaResultado: PodGeoResultado = "sin_referencia";
  let distanciaDestinoM: number | null = null;

  if (entrada.geo) {
    const destinoLat = pedido.lat as number | null;
    const destinoLong = pedido.long as number | null;
    const geoEstado = pedido.geo_estado as string;

    if (destinoLat !== null && destinoLong !== null && geoEstado === "resuelto") {
      distanciaDestinoM = haversineMetros(
        entrada.geo.lat, entrada.geo.long,
        destinoLat, destinoLong,
      );
      geocercaResultado = distanciaDestinoM <= POD_GEOCERCA_RADIO_M ? "dentro" : "fuera";
    }
    // Si no hay lat/long resuelto → geocercaResultado permanece 'sin_referencia'.
  }

  // --- 5. Bitácora ANTES del INSERT (patrón del proyecto) ---------------
  // DATOS PERSONALES: NO incluir lat/long, foto_path en el detalle.
  await registrarEnBitacora(cliente, {
    tenantId: entrada.tenantId,
    actorUsuarioId: actor.driverId, // el UUID de auth del conductor
    actorTipo: "usuario",
    accion: "evidencia.capturada",
    entidadTipo: "pedido",
    entidadId: entrada.pedidoId,
    detalle: {
      tiene_nota: !!entrada.nota,
      geocerca_resultado: geocercaResultado,
    },
  });

  // --- 6. INSERT (service_role — bypass de RLS) -------------------------
  const payload: Record<string, unknown> = {
    tenant_id: entrada.tenantId,
    pedido_id: entrada.pedidoId,
    seller_id: pedido.seller_id,
    conductor_id: actor.driverId,
    foto_object_path: entrada.fotoObjectPath,
    nota: entrada.nota ?? null,
    geo_lat: entrada.geo?.lat ?? null,
    geo_long: entrada.geo?.long ?? null,
    geo_precision_m: entrada.geo?.precisionM ?? null,
    distancia_destino_m: distanciaDestinoM,
    geocerca_resultado: geocercaResultado,
  };
  if (entrada.evidenciaId) {
    payload.id = entrada.evidenciaId;
  }

  const { data: nueva, error: errorInsert } = await cliente
    .from("evidencias_entrega")
    .insert(payload)
    .select()
    .single();

  if (errorInsert) {
    // Conflicto de PK (23505) por reintento de sync con el mismo id: re-leer y
    // devolver la existente (idempotencia de red).
    if (errorInsert.code === "23505" && entrada.evidenciaId) {
      const { data: existenteTras } = await cliente
        .from("evidencias_entrega")
        .select("*")
        .eq("id", entrada.evidenciaId)
        .eq("tenant_id", entrada.tenantId)
        .maybeSingle();

      if (existenteTras) return filaAEvidencia(existenteTras);
    }
    throw new Error(`Error al registrar evidencia de entrega: ${errorInsert.message}`);
  }

  if (!nueva) {
    throw new Error("No se pudo obtener la evidencia recién creada.");
  }

  return filaAEvidencia(nueva);
}

// =============================================================================
// listarEvidenciasPorPedido
// =============================================================================

/**
 * Devuelve todas las evidencias de un pedido, más reciente primero, para mostrarlas
 * al coordinador/dueño en el backoffice. Solo lectura. El aislamiento por tenant lo
 * impone el filtro; el acceso a la foto lo impone obtenerUrlFirmadaEvidencia.
 */
export async function listarEvidenciasPorPedido(
  cliente: SupabaseClient,
  pedidoId: string,
  tenantId: string,
): Promise<EvidenciaEntrega[]> {
  const { data, error } = await cliente
    .from("evidencias_entrega")
    .select("*")
    .eq("pedido_id", pedidoId)
    .eq("tenant_id", tenantId)
    .order("capturado_en", { ascending: false });

  if (error) {
    throw new Error(`Error al listar evidencias de entrega: ${error.message}`);
  }

  return (data ?? []).map(filaAEvidencia);
}

// =============================================================================
// obtenerUrlFirmadaEvidencia
// =============================================================================

/**
 * Devuelve una URL firmada de corta duración (15 min) para la foto de una evidencia.
 *
 * Control de acceso:
 *   - Actor interno (mismo tenant): acceso libre a las evidencias de su tenant.
 *   - Actor conductor: solo a las evidencias que él mismo capturó.
 *   - El SELLER NO accede (mismo criterio que la RLS de la tabla).
 *
 * El bucket es PRIVADO; las URLs públicas NO existen. El path de la foto NO se loguea.
 */
export async function obtenerUrlFirmadaEvidencia(
  cliente: SupabaseClient,
  evidenciaId: string,
  actor: UsuarioActual,
): Promise<string> {
  const esInterno = actor.tipoUsuario === "interno";
  const esConductor = actor.tipoUsuario === "conductor";

  if (!esInterno && !esConductor) {
    throw new ErrorValidacion("No tienes permisos para acceder a las evidencias de entrega.");
  }
  if (esConductor && !puedeMarcarEvidenciasPropias(actor)) {
    throw new ErrorValidacion("El conductor no tiene capacidad para ver sus evidencias.");
  }

  // Leer la evidencia con aislamiento de tenant.
  const { data: evidencia, error: errorEv } = await cliente
    .from("evidencias_entrega")
    .select("id, tenant_id, conductor_id, foto_object_path")
    .eq("id", evidenciaId)
    .eq("tenant_id", actor.tenantId ?? "")
    .maybeSingle();

  if (errorEv) {
    throw new Error(`Error al buscar la evidencia: ${errorEv.message}`);
  }
  if (!evidencia) {
    throw new ErrorValidacion(`La evidencia '${evidenciaId}' no existe o no pertenece al tenant.`);
  }

  // El conductor solo accede a las evidencias que él capturó.
  if (esConductor && evidencia.conductor_id !== actor.driverId) {
    throw new ErrorValidacion("El conductor no tiene acceso a esta evidencia.");
  }

  // Generar URL firmada (15 min). El path NO se loguea.
  const { data, error: errorUrl } = await cliente.storage
    .from("pod-evidencias")
    .createSignedUrl(evidencia.foto_object_path as string, 900);

  if (errorUrl || !data) {
    throw new Error("No se pudo generar el enlace firmado para la evidencia.");
  }

  return data.signedUrl;
}
