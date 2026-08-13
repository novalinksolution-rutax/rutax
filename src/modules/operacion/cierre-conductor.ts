/**
 * Módulo `cierre-conductor` — CIERRE OPERATIVO del conductor (registro del courier).
 *
 * El conductor declara el RESULTADO de la entrega (entregado / no_entregado) para sus
 * pedidos. Es el registro PROPIO del courier — UNO por pedido (se actualiza si se
 * corrige). NO cambia el estado del pedido:
 *
 *   - Para Flex: el estado oficial lo sigue gobernando la app de Mercado Envíos Flex
 *     (obligatoria, no integrable — CLAUDE.md). Este cierre corre en PARALELO; NO la
 *     reemplaza. Permite al courier saber qué pasó con cada parada de su ruta.
 *   - Para same-day: el POD AUTORITATIVO sigue siendo `pruebas-entrega` (que sí cambia
 *     el estado). Este cierre NO se usa para same-day desde los endpoints; el ruteo lo
 *     decide el endpoint según tipo_pedido.
 *
 * Foto OPCIONAL (a diferencia de evidencias_entrega, que exige foto). La geocerca se
 * calcula igual que el POD pero 'fuera' NO bloquea (queda registrada para revisión).
 *
 * Bitácora ANTES del upsert (patrón del proyecto). Las ubicaciones y paths de fotos
 * NO se loguean (datos personales / sensibles).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { puedeMarcarEvidenciasPropias } from "@/modules/identidad/capacidades";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { ErrorValidacion } from "@/modules/identidad/errores";
import { ErrorPedidoNoEncontrado } from "./errores";
import type { UsuarioActual } from "@/modules/identidad/usuario-actual";
import type { TipoIncidencia } from "./tipos";
import {
  haversineMetros,
  POD_GEOCERCA_RADIO_M,
  type PodGeoResultado,
} from "./pruebas-entrega";

// =============================================================================
// Tipos de dominio
// =============================================================================

export type ResultadoCierre = "entregado" | "no_entregado";

export interface CierreConductor {
  id: string;
  tenantId: string;
  pedidoId: string;
  sellerId: string;
  conductorId: string;
  resultado: ResultadoCierre;
  motivo: TipoIncidencia | null;
  fotoObjectPath: string | null;
  geoLat: number | null;
  geoLong: number | null;
  geoPrecisionM: number | null;
  distanciaDestinoM: number | null;
  geocercaResultado: PodGeoResultado;
  cerradoEn: string;
  creadoEn: string;
  actualizadoEn: string;
}

export interface RegistrarCierreEntrada {
  pedidoId: string;
  tenantId: string;
  resultado: ResultadoCierre;
  /** Requerido cuando resultado = 'no_entregado'. */
  motivo?: TipoIncidencia;
  /** Path en bucket pod-evidencias ya subido. OPCIONAL. */
  fotoObjectPath?: string;
  geo?: { lat: number; long: number; precisionM?: number };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function filaACierre(fila: Record<string, any>): CierreConductor {
  return {
    id: fila.id,
    tenantId: fila.tenant_id,
    pedidoId: fila.pedido_id,
    sellerId: fila.seller_id,
    conductorId: fila.conductor_id,
    resultado: fila.resultado as ResultadoCierre,
    motivo: (fila.motivo ?? null) as TipoIncidencia | null,
    fotoObjectPath: fila.foto_object_path ?? null,
    geoLat: fila.geo_lat ?? null,
    geoLong: fila.geo_long ?? null,
    geoPrecisionM: fila.geo_precision_m ?? null,
    distanciaDestinoM: fila.distancia_destino_m ?? null,
    geocercaResultado: (fila.geocerca_resultado ?? "sin_referencia") as PodGeoResultado,
    cerradoEn: fila.cerrado_en,
    creadoEn: fila.creado_en,
    actualizadoEn: fila.actualizado_en,
  };
}

// =============================================================================
// registrarCierreConductor
// =============================================================================

/**
 * Registra (o actualiza) el cierre operativo de un pedido por su conductor. NO cambia
 * el estado del pedido. Aplica a cualquier tipo de pedido asignado al conductor.
 *
 * Idempotente por pedido (UNIQUE pedido_id): un reintento o una corrección actualiza
 * la fila existente en vez de duplicar.
 */
export async function registrarCierreConductor(
  cliente: SupabaseClient,
  entrada: RegistrarCierreEntrada,
  // `& { usuarioId }` porque esta función escribe bitácora y necesita el id de
  // AUTH, que `UsuarioActual` no expone. Es lo que devuelve `autenticarBearer`;
  // exigirlo aquí impide que un llamador vuelva a caer en pasar `driverId`.
  actor: UsuarioActual & { usuarioId: string },
): Promise<CierreConductor> {
  // --- 1. RBAC + validación de actor ------------------------------------
  if (!puedeMarcarEvidenciasPropias(actor)) {
    throw new ErrorValidacion("El usuario no tiene capacidad para cerrar entregas.");
  }
  if (!actor.driverId) {
    throw new ErrorValidacion(
      "El actor no tiene driverId — solo conductores pueden cerrar entregas.",
    );
  }
  if (entrada.resultado === "no_entregado" && !entrada.motivo) {
    throw new ErrorValidacion("Un cierre 'no entregado' requiere un motivo.");
  }

  // --- 2. Leer el pedido (cualquier tipo; asignado al conductor) --------
  const { data: pedido, error: errorPedido } = await cliente
    .from("pedidos")
    .select("id, tenant_id, seller_id, driver_id_asignado, lat, long, geo_estado")
    .eq("id", entrada.pedidoId)
    .eq("tenant_id", entrada.tenantId)
    .maybeSingle();

  if (errorPedido) {
    throw new Error(`Error al leer el pedido para cierre: ${errorPedido.message}`);
  }
  if (!pedido) {
    throw new ErrorPedidoNoEncontrado(entrada.pedidoId);
  }
  if (pedido.driver_id_asignado !== actor.driverId) {
    throw new ErrorValidacion(
      "El conductor solo puede cerrar pedidos asignados a él.",
    );
  }

  // --- 3. Geocerca (no bloquea) -----------------------------------------
  let geocercaResultado: PodGeoResultado = "sin_referencia";
  let distanciaDestinoM: number | null = null;

  if (entrada.geo) {
    const destinoLat = pedido.lat as number | null;
    const destinoLong = pedido.long as number | null;
    const geoEstado = pedido.geo_estado as string;
    if (destinoLat !== null && destinoLong !== null && geoEstado === "resuelto") {
      distanciaDestinoM = haversineMetros(
        entrada.geo.lat, entrada.geo.long, destinoLat, destinoLong,
      );
      geocercaResultado = distanciaDestinoM <= POD_GEOCERCA_RADIO_M ? "dentro" : "fuera";
    }
  }

  // --- 4. Bitácora ANTES del upsert (sin datos personales) --------------
  await registrarEnBitacora(cliente, {
    tenantId: entrada.tenantId,
    // `usuarioId` (auth), NUNCA `driverId`. `bitacora_auditoria.actor_usuario_id`
    // tiene FK a `auth.users(id)`, y `driverId` es `identidad.conductores.id`,
    // que se genera con `crypto.randomUUID()` (`conductores.ts:530`) y jamás
    // coincide con un usuario de auth. Pasarlo aquí hacía fallar el INSERT con
    // 23503 — y como la bitácora va ANTES del efecto, tumbaba la operación
    // entera. Los tests unitarios no lo veían porque mockean la bitácora.
    actorUsuarioId: actor.usuarioId,
    actorTipo: "usuario",
    accion: "pedido.cierre_operativo",
    entidadTipo: "pedido",
    entidadId: entrada.pedidoId,
    detalle: {
      resultado: entrada.resultado,
      tiene_motivo: !!entrada.motivo,
      tiene_foto: !!entrada.fotoObjectPath,
      geocerca_resultado: geocercaResultado,
    },
  });

  // --- 5. Upsert por pedido_id (idempotente / corregible) ---------------
  const payload: Record<string, unknown> = {
    tenant_id: entrada.tenantId,
    pedido_id: entrada.pedidoId,
    seller_id: pedido.seller_id,
    conductor_id: actor.driverId,
    resultado: entrada.resultado,
    motivo: entrada.resultado === "no_entregado" ? (entrada.motivo ?? null) : null,
    foto_object_path: entrada.fotoObjectPath ?? null,
    geo_lat: entrada.geo?.lat ?? null,
    geo_long: entrada.geo?.long ?? null,
    geo_precision_m: entrada.geo?.precisionM ?? null,
    distancia_destino_m: distanciaDestinoM,
    geocerca_resultado: geocercaResultado,
    cerrado_en: new Date().toISOString(),
  };

  const { data: fila, error: errorUpsert } = await cliente
    .from("cierres_conductor")
    .upsert(payload, { onConflict: "pedido_id" })
    .select()
    .single();

  if (errorUpsert) {
    throw new Error(`Error al registrar el cierre del conductor: ${errorUpsert.message}`);
  }
  if (!fila) {
    throw new Error("No se pudo obtener el cierre recién registrado.");
  }

  return filaACierre(fila);
}

// =============================================================================
// listarCierresPorPedidos — para enriquecer el manifiesto
// =============================================================================

/**
 * Devuelve un Map pedidoId → CierreConductor para un conjunto de pedidos del tenant.
 * Lo usa el endpoint del manifiesto para que la app sepa qué paradas ya cerró el
 * conductor (y con qué resultado), sin un round-trip por pedido.
 */
export async function listarCierresPorPedidos(
  cliente: SupabaseClient,
  pedidoIds: string[],
  tenantId: string,
): Promise<Map<string, CierreConductor>> {
  const mapa = new Map<string, CierreConductor>();
  if (pedidoIds.length === 0) return mapa;

  const { data, error } = await cliente
    .from("cierres_conductor")
    .select("*")
    .in("pedido_id", pedidoIds)
    .eq("tenant_id", tenantId);

  if (error) {
    throw new Error(`Error al listar cierres del conductor: ${error.message}`);
  }

  for (const fila of data ?? []) {
    const cierre = filaACierre(fila);
    mapa.set(cierre.pedidoId, cierre);
  }
  return mapa;
}
