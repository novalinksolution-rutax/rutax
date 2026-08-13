/**
 * Módulo `pruebas-entrega` — POD (Proof of Delivery) del ciclo same-day propio.
 *
 * FRONTERA DURA: este módulo es EXCLUSIVO de pedidos tipo_pedido='same_day'.
 * En Flex manda la app de Mercado Envíos Flex (obligatoria, no integrable — CLAUDE.md).
 * La barrera doble:
 *   1. Backend: verifica tipo_pedido y pertenencia antes de cualquier escritura.
 *   2. BD: trigger trg_pruebas_entrega_solo_same_day (último recurso).
 *
 * Reglas de negocio:
 * - Conductor autenticado dueño del pedido (driverId + pedido.driver_id_asignado).
 * - Geocerca Haversine con radio POD_GEOCERCA_RADIO_M (150 m).
 * - es_valido = tiene_foto AND geocerca IN ('dentro','sin_referencia') para entregado.
 *   Para fallido: válido = tiene tipo_incidencia.
 * - Idempotente sobre idx_pruebas_entrega_entregado_uk (UNIQUE pedido_id WHERE entregado):
 *   on conflict do nothing + devuelve el existente.
 * - Bitácora ANTES del insert (patrón del proyecto: bitácora primero, efecto después).
 * - NO sube fotos; recibe foto_object_path ya subido por el frontend a Storage.
 *
 * Las ubicaciones y paths de fotos NO se loguean (datos personales / sensibles).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { puedeMarcarEvidenciasPropias, puedeVerDocumentosPropios } from "@/modules/identidad/capacidades";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { ErrorValidacion } from "@/modules/identidad/errores";
import { ErrorPedidoNoEncontrado } from "./errores";
import type { UsuarioActual } from "@/modules/identidad/usuario-actual";
import type { TipoIncidencia } from "./tipos";

// =============================================================================
// Constante de geocerca
// =============================================================================

/** Radio máximo aceptable entre la posición de captura del POD y el destino del pedido (metros). */
export const POD_GEOCERCA_RADIO_M = 150;

// =============================================================================
// Tipos de dominio del POD
// =============================================================================

export type PodResultado = "entregado" | "fallido";
export type PodGeoResultado = "dentro" | "fuera" | "sin_referencia";
export type PodOtpEstado = "no_aplica" | "pendiente" | "validado" | "omitido";

export interface PruebaEntrega {
  id: string;
  tenantId: string;
  pedidoId: string;
  sellerId: string;
  conductorId: string;
  tipoResultado: PodResultado;
  tieneFoto: boolean;
  /** Path en el bucket privado pod-evidencias. NUNCA una URL pública. */
  fotoObjectPath: string | null;
  tieneFirma: boolean;
  firmaObjectPath: string | null;
  otpEstado: PodOtpEstado;
  geoLat: number | null;
  geoLong: number | null;
  geoPrecisionM: number | null;
  distanciaDestinoM: number | null;
  geocercaResultado: PodGeoResultado;
  esValido: boolean;
  tipoIncidencia: TipoIncidencia | null;
  capturadoEn: string;
  creadoEn: string;
}

export interface RegistrarPruebaEntradaBase {
  pedidoId: string;
  tenantId: string;
  /** Path en bucket pod-evidencias ya subido por el frontend. null si no hay foto. */
  fotoObjectPath?: string;
  /** Path en bucket pod-evidencias ya subido por el frontend. null si no hay firma. */
  firmaObjectPath?: string;
  /** Posición GPS del conductor al capturar el POD. */
  geo?: {
    lat: number;
    long: number;
    precisionM?: number;
  };
}

export interface RegistrarPodEntregadoEntrada extends RegistrarPruebaEntradaBase {
  tipoResultado: "entregado";
}

export interface RegistrarPodFallidoEntrada extends RegistrarPruebaEntradaBase {
  tipoResultado: "fallido";
  /** Requerido para fallido: motivo del no-entrega. */
  tipoIncidencia: TipoIncidencia;
}

export type RegistrarPruebaEntradaEntrada =
  | RegistrarPodEntregadoEntrada
  | RegistrarPodFallidoEntrada;

// =============================================================================
// Haversine — cálculo de distancia entre dos puntos geográficos (metros)
// =============================================================================

/**
 * Devuelve la distancia en metros entre dos puntos {lat, long} usando la
 * fórmula de Haversine. Suficientemente precisa para radios de <1 km.
 * Función pura sin dependencias externas.
 */
export function haversineMetros(
  lat1: number, long1: number,
  lat2: number, long2: number,
): number {
  const R = 6_371_000; // radio de la Tierra en metros
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dphi = ((lat2 - lat1) * Math.PI) / 180;
  const dlambda = ((long2 - long1) * Math.PI) / 180;

  const a =
    Math.sin(dphi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlambda / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// =============================================================================
// Mapper BD → PruebaEntrega
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function filaAPruebaEntrega(fila: Record<string, any>): PruebaEntrega {
  return {
    id: fila.id,
    tenantId: fila.tenant_id,
    pedidoId: fila.pedido_id,
    sellerId: fila.seller_id,
    conductorId: fila.conductor_id,
    tipoResultado: fila.tipo_resultado as PodResultado,
    tieneFoto: fila.tiene_foto,
    fotoObjectPath: fila.foto_object_path ?? null,
    tieneFirma: fila.tiene_firma,
    firmaObjectPath: fila.firma_object_path ?? null,
    otpEstado: (fila.otp_estado ?? "no_aplica") as PodOtpEstado,
    geoLat: fila.geo_lat ?? null,
    geoLong: fila.geo_long ?? null,
    geoPrecisionM: fila.geo_precision_m ?? null,
    distanciaDestinoM: fila.distancia_destino_m ?? null,
    geocercaResultado: (fila.geocerca_resultado ?? "sin_referencia") as PodGeoResultado,
    esValido: fila.es_valido,
    tipoIncidencia: (fila.tipo_incidencia ?? null) as TipoIncidencia | null,
    capturadoEn: fila.capturado_en,
    creadoEn: fila.creado_en,
  };
}

// =============================================================================
// registrarPruebaEntrega
// =============================================================================

/**
 * Registra el POD de un pedido same-day capturado por el conductor.
 *
 * Idempotente: si ya existe un POD 'entregado' para el mismo pedido (índice
 * parcial), devuelve el existente sin crear uno nuevo.
 *
 * El frontend es responsable de subir la foto a Storage antes de llamar a
 * esta función; aquí solo se recibe el foto_object_path resultante.
 *
 * Bitácora ANTES del INSERT (patrón del proyecto). Datos personales
 * (geo, foto_path) NO se incluyen en el detalle de la bitácora.
 */
export async function registrarPruebaEntrega(
  cliente: SupabaseClient,
  entrada: RegistrarPruebaEntradaEntrada,
  // `& { usuarioId }`: escribe bitácora y necesita el id de AUTH, que
  // `UsuarioActual` no expone. Ver la nota del INSERT más abajo.
  actor: UsuarioActual & { usuarioId: string },
): Promise<PruebaEntrega> {
  // --- 1. RBAC + validación de actor ------------------------------------
  if (!puedeMarcarEvidenciasPropias(actor)) {
    throw new ErrorValidacion(
      "El usuario no tiene capacidad para registrar evidencias de entrega.",
    );
  }
  if (!actor.driverId) {
    throw new ErrorValidacion(
      "El actor no tiene driverId — solo conductores pueden registrar POD.",
    );
  }

  // Validación de tipoIncidencia para fallido (defensa en profundidad:
  // el tipo de TS lo garantiza en compile-time, pero validamos en runtime).
  if (entrada.tipoResultado === "fallido") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inc = (entrada as any).tipoIncidencia;
    if (!inc) {
      throw new ErrorValidacion(
        "Se requiere el tipo de incidencia para registrar un POD de fallo.",
      );
    }
  }

  // --- 2. Leer el pedido (solo same-day + asignado al conductor) --------
  const { data: pedido, error: errorPedido } = await cliente
    .from("pedidos")
    .select("id, tenant_id, seller_id, tipo_pedido, driver_id_asignado, lat, long, geo_estado, estado")
    .eq("id", entrada.pedidoId)
    .eq("tenant_id", entrada.tenantId)
    .maybeSingle();

  if (errorPedido) {
    throw new Error(`Error al leer el pedido para POD: ${errorPedido.message}`);
  }
  if (!pedido) {
    throw new ErrorPedidoNoEncontrado(entrada.pedidoId);
  }

  // FRONTERA DURA: solo same-day.
  if (pedido.tipo_pedido !== "same_day") {
    throw new ErrorValidacion(
      "El POD/tracking propio es exclusivo de pedidos same-day; los Flex los reporta Mercado Libre.",
    );
  }

  // El conductor solo actúa sobre pedidos asignados a él.
  if (pedido.driver_id_asignado !== actor.driverId) {
    throw new ErrorValidacion(
      "El conductor solo puede registrar evidencias de pedidos asignados a él.",
    );
  }

  // --- 3. Idempotencia para tipo_resultado='entregado' ------------------
  //    El índice parcial (UNIQUE pedido_id WHERE tipo_resultado='entregado')
  //    en BD garantiza la unicidad; aquí lo chequeamos para devolver el existente.
  if (entrada.tipoResultado === "entregado") {
    const { data: existente } = await cliente
      .from("pruebas_entrega")
      .select("*")
      .eq("pedido_id", entrada.pedidoId)
      .eq("tenant_id", entrada.tenantId)
      .eq("tipo_resultado", "entregado")
      .maybeSingle();

    if (existente) {
      return filaAPruebaEntrega(existente);
    }
  }

  // --- 4. Calcular geocerca --------------------------------------------
  const tieneFoto = !!entrada.fotoObjectPath;
  const tieneFirma = !!entrada.firmaObjectPath;

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

  // --- 5. Calcular es_valido -------------------------------------------
  let esValido: boolean;
  if (entrada.tipoResultado === "entregado") {
    // Entregado válido: tiene foto Y geocerca no es 'fuera'.
    esValido = tieneFoto && geocercaResultado !== "fuera";
  } else {
    // Fallido válido: tiene tipo_incidencia (ya validado arriba por TS).
    esValido = !!entrada.tipoIncidencia;
  }

  // --- 6. Bitácora ANTES del INSERT (patrón del proyecto) ---------------
  // DATOS PERSONALES: NO incluir lat/long, foto_path en el detalle.
  await registrarEnBitacora(cliente, {
    tenantId: entrada.tenantId,
    // `usuarioId` (auth), NUNCA `driverId`: son espacios de UUID distintos y la
    // columna tiene FK a `auth.users(id)`. El comentario que estaba aquí decía
    // que `driverId` era "el UUID de auth del conductor" y era falso — el
    // INSERT fallaba con 23503, antes del efecto. Este es el POD autoritativo
    // de same-day: mientras falló, ninguna entrega llegó a generar su línea.
    actorUsuarioId: actor.usuarioId,
    actorTipo: "usuario",
    accion: "pod.capturado",
    entidadTipo: "pedido",
    entidadId: entrada.pedidoId,
    detalle: {
      tipo_resultado: entrada.tipoResultado,
      tiene_foto: tieneFoto,
      tiene_firma: tieneFirma,
      geocerca_resultado: geocercaResultado,
      es_valido: esValido,
      // tipo_incidencia solo para fallido (no es dato personal).
      tipo_incidencia: entrada.tipoResultado === "fallido" ? entrada.tipoIncidencia : null,
    },
  });

  // --- 7. INSERT (service_role — bypass de RLS) -------------------------
  const payload: Record<string, unknown> = {
    tenant_id: entrada.tenantId,
    pedido_id: entrada.pedidoId,
    seller_id: pedido.seller_id,
    conductor_id: actor.driverId,
    tipo_resultado: entrada.tipoResultado,
    tiene_foto: tieneFoto,
    foto_object_path: entrada.fotoObjectPath ?? null,
    tiene_firma: tieneFirma,
    firma_object_path: entrada.firmaObjectPath ?? null,
    otp_estado: "no_aplica",
    geo_lat: entrada.geo?.lat ?? null,
    geo_long: entrada.geo?.long ?? null,
    geo_precision_m: entrada.geo?.precisionM ?? null,
    distancia_destino_m: distanciaDestinoM,
    geocerca_resultado: geocercaResultado,
    es_valido: esValido,
    tipo_incidencia: entrada.tipoResultado === "fallido" ? entrada.tipoIncidencia : null,
  };

  const { data: nueva, error: errorInsert } = await cliente
    .from("pruebas_entrega")
    .insert(payload)
    .select()
    .single();

  if (errorInsert) {
    // Si el conflicto es por el índice parcial del 'entregado' (código 23505),
    // volvemos a leer y devolvemos el existente (idempotencia de red).
    if (errorInsert.code === "23505" && entrada.tipoResultado === "entregado") {
      const { data: existenteTras } = await cliente
        .from("pruebas_entrega")
        .select("*")
        .eq("pedido_id", entrada.pedidoId)
        .eq("tenant_id", entrada.tenantId)
        .eq("tipo_resultado", "entregado")
        .maybeSingle();

      if (existenteTras) return filaAPruebaEntrega(existenteTras);
    }
    throw new Error(`Error al registrar prueba de entrega: ${errorInsert.message}`);
  }

  if (!nueva) {
    throw new Error("No se pudo obtener el POD recién creado.");
  }

  return filaAPruebaEntrega(nueva);
}

// =============================================================================
// obtenerPruebaEntregaPorPedido
// =============================================================================

/**
 * Devuelve el POD relevante de un pedido para mostrarlo (coordinador/seller).
 * Prioriza el POD de 'entregado' (único por pedido); si no existe, el 'fallido'
 * más reciente. Devuelve null si el pedido no tiene POD.
 *
 * Solo lectura. El aislamiento por tenant lo impone el filtro; el RBAC de la
 * URL firmada de la foto lo impone `obtenerUrlFirmadaPod`.
 */
export async function obtenerPruebaEntregaPorPedido(
  cliente: SupabaseClient,
  pedidoId: string,
  tenantId: string,
): Promise<PruebaEntrega | null> {
  const { data, error } = await cliente
    .from("pruebas_entrega")
    .select("*")
    .eq("pedido_id", pedidoId)
    .eq("tenant_id", tenantId)
    // 'entregado' < 'fallido' alfabéticamente → ascending prioriza el de entrega.
    .order("tipo_resultado", { ascending: true })
    .order("capturado_en", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Error al obtener prueba de entrega: ${error.message}`);
  }

  return data ? filaAPruebaEntrega(data) : null;
}

// =============================================================================
// obtenerUrlFirmadaPod
// =============================================================================

/**
 * Devuelve una URL firmada de corta duración para la foto/firma del POD.
 *
 * Control de acceso:
 *   - Actor interno (mismo tenant): acceso libre.
 *   - Actor seller: solo puede acceder al POD de sus propios pedidos (sellerId coincide).
 *   - Actor conductor: solo puede acceder a los PODs que él mismo capturó.
 *
 * Duración: 15 minutos (900 segundos), alineada con el patrón de cobros del portal.
 *
 * El bucket es PRIVADO; las URLs públicas NO existen. Datos personales (path de foto)
 * NO se registran en logs.
 */
export async function obtenerUrlFirmadaPod(
  cliente: SupabaseClient,
  podId: string,
  actor: UsuarioActual,
): Promise<string> {
  // Verificar RBAC mínimo.
  const esInterno = actor.tipoUsuario === "interno";
  const esSeller = actor.tipoUsuario === "seller";
  const esConductor = actor.tipoUsuario === "conductor";

  if (!esInterno && !esSeller && !esConductor) {
    throw new ErrorValidacion("No tienes permisos para acceder a las evidencias de entrega.");
  }
  if (esSeller && !puedeVerDocumentosPropios(actor)) {
    throw new ErrorValidacion("El seller no tiene capacidad para ver documentos propios.");
  }
  if (esConductor && !puedeMarcarEvidenciasPropias(actor)) {
    throw new ErrorValidacion("El conductor no tiene capacidad para ver sus evidencias.");
  }

  // Leer el POD con aislamiento de tenant.
  const { data: pod, error: errorPod } = await cliente
    .from("pruebas_entrega")
    .select("id, tenant_id, seller_id, conductor_id, foto_object_path")
    .eq("id", podId)
    .eq("tenant_id", actor.tenantId ?? "")
    .maybeSingle();

  if (errorPod) {
    throw new Error(`Error al buscar el POD: ${errorPod.message}`);
  }
  if (!pod) {
    throw new ErrorValidacion(`El POD '${podId}' no existe o no pertenece al tenant.`);
  }
  if (!pod.foto_object_path) {
    throw new ErrorValidacion(`El POD '${podId}' no tiene foto registrada.`);
  }

  // Verificar pertenencia para seller y conductor.
  if (esSeller && pod.seller_id !== actor.sellerId) {
    throw new ErrorValidacion("El seller no tiene acceso al POD de este pedido.");
  }
  if (esConductor && pod.conductor_id !== actor.driverId) {
    throw new ErrorValidacion("El conductor no tiene acceso a este POD.");
  }

  // Generar URL firmada (15 min). El path NO se loguea.
  const { data, error: errorUrl } = await cliente.storage
    .from("pod-evidencias")
    .createSignedUrl(pod.foto_object_path as string, 900);

  if (errorUrl || !data) {
    throw new Error("No se pudo generar el enlace firmado para la evidencia.");
  }

  return data.signedUrl;
}
