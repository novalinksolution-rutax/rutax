/**
 * Selector multi-courier del seller (switcher) + bloqueo de membresía por el
 * courier — RF-010 rediseño (alta de seller por autoservicio).
 * =============================================================================
 * `identidad.usuarios_perfil` sigue 1:1 con `auth.users` y guarda SOLO la
 * membresía ACTIVA (`tenant_id`/`seller_id`). `identidad.seller_membresias`
 * (migración `20260916000001`) enumera las N membresías de una identidad; el
 * switcher reescribe la fila activa de `usuarios_perfil` a partir de una fila
 * `seller_membresias` — nunca al revés, y `seller_membresias` NUNCA alimenta
 * el `custom_access_token_hook` directamente.
 *
 * Tres operaciones:
 *   - `listarMisMembresiasSeller` — para el selector: las N membresías con el
 *     NOMBRE de cada courier resuelto por `service_role` (el seller solo
 *     puede leer, por RLS de cliente, el `tenants` de su tenant ACTIVO).
 *   - `cambiarCourierActivo`      — el switcher en sí. El llamador (Server
 *     Action) es responsable de refrescar el JWT después.
 *   - `bloquearSellerMembresia` / `desbloquearSellerMembresia` — la palanca
 *     del courier para cortar (o restaurar) el acceso de un seller
 *     autoservicio sin borrar la membresía (trazabilidad).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClienteServicio } from "./onboarding";
import { registrarEnBitacora } from "./auditoria";
import { ErrorNoEncontrado, ErrorValidacion } from "./errores";

/** Nombre de respaldo si el tenant no resolviera (no debería pasar — FK cascade). */
const NOMBRE_COURIER_GENERICO = "Courier";

export interface MembresiaSellerConNombre {
  tenantId: string;
  sellerId: string;
  nombreCourier: string;
  estado: "activa" | "bloqueada";
  /** `true` si es el courier que la sesión tiene activo ahora mismo. */
  esActual: boolean;
}

/**
 * Lista las membresías de una identidad, con el nombre de cada courier
 * resuelto por `service_role`. `tenantIdActual` viene de la sesión (el claim
 * vigente) — sirve solo para marcar `esActual`, nunca para filtrar.
 */
export async function listarMisMembresiasSeller(
  cliente: ClienteServicio,
  authUserId: string,
  tenantIdActual: string | null,
): Promise<MembresiaSellerConNombre[]> {
  const { data, error } = await cliente
    .schema("identidad")
    .from("seller_membresias")
    .select("tenant_id, seller_id, estado")
    .eq("auth_user_id", authUserId);

  if (error) {
    throw new Error(`No se pudieron listar tus membresías: ${error.message}`);
  }

  const filas = (data ?? []) as Array<{ tenant_id: string; seller_id: string; estado: "activa" | "bloqueada" }>;
  if (!filas.length) return [];

  const tenantIds = Array.from(new Set(filas.map((f) => f.tenant_id)));
  const { data: tenants } = await cliente.from("tenants").select("id, nombre_fantasia").in("id", tenantIds);

  const nombresPorTenant = new Map<string, string>(
    ((tenants ?? []) as Array<{ id: string; nombre_fantasia: string | null }>).map((t) => [
      t.id,
      t.nombre_fantasia?.trim() || NOMBRE_COURIER_GENERICO,
    ]),
  );

  return filas.map((f) => ({
    tenantId: f.tenant_id,
    sellerId: f.seller_id,
    nombreCourier: nombresPorTenant.get(f.tenant_id) ?? NOMBRE_COURIER_GENERICO,
    estado: f.estado,
    esActual: f.tenant_id === tenantIdActual,
  }));
}

export interface CambioCourierActivo {
  tenantId: string;
  sellerId: string;
}

/**
 * Reescribe `usuarios_perfil.{tenant_id, seller_id}` desde una membresía
 * `activa` del propio seller. Lanza `ErrorNoEncontrado` si no tiene membresía
 * con ese tenant, y `ErrorValidacion` si la tiene pero está `bloqueada` — el
 * switcher NUNCA debe ofrecer (ni aceptar) una membresía bloqueada.
 *
 * El llamador (Server Action) es responsable de refrescar el JWT después
 * (`supabase.auth.refreshSession()`) — este módulo no tiene la sesión del
 * usuario, solo el cliente `service_role`.
 */
export async function cambiarCourierActivo(
  cliente: ClienteServicio,
  params: { authUserId: string; tenantId: string },
): Promise<CambioCourierActivo> {
  const { data: membresia, error: errorLectura } = await cliente
    .schema("identidad")
    .from("seller_membresias")
    .select("seller_id, estado")
    .eq("auth_user_id", params.authUserId)
    .eq("tenant_id", params.tenantId)
    .maybeSingle();

  if (errorLectura) {
    throw new Error(`No se pudo resolver la membresía: ${errorLectura.message}`);
  }
  if (!membresia) {
    throw new ErrorNoEncontrado("No tienes una membresía con ese courier.");
  }
  if (membresia.estado !== "activa") {
    throw new ErrorValidacion("Ese courier bloqueó tu acceso — no puedes operar con él.");
  }

  const sellerId = membresia.seller_id as string;

  const { error: errorPerfil } = await cliente
    .from("usuarios_perfil")
    .update({ tenant_id: params.tenantId, seller_id: sellerId })
    .eq("id", params.authUserId);

  if (errorPerfil) {
    throw new Error(`No se pudo cambiar de courier: ${errorPerfil.message}`);
  }

  await registrarEnBitacora(cliente as unknown as SupabaseClient, {
    tenantId: params.tenantId,
    actorUsuarioId: params.authUserId,
    actorTipo: "usuario",
    accion: "seller.courier_cambiado",
    entidadTipo: "usuario_perfil",
    entidadId: params.authUserId,
    detalle: { seller_id: sellerId },
  });

  return { tenantId: params.tenantId, sellerId };
}

async function cambiarEstadoMembresiaPorCourier(
  cliente: ClienteServicio,
  params: { tenantId: string; sellerId: string; actorUsuarioId: string; estado: "activa" | "bloqueada" },
): Promise<void> {
  const { data, error } = await cliente
    .schema("identidad")
    .from("seller_membresias")
    .update({ estado: params.estado })
    .eq("tenant_id", params.tenantId)
    .eq("seller_id", params.sellerId)
    .select("id");

  if (error) {
    throw new Error(`No se pudo cambiar el estado de la membresía: ${error.message}`);
  }
  if (!data || (data as unknown[]).length === 0) {
    throw new ErrorNoEncontrado("Ese seller no tiene una membresía por autoservicio en tu courier.");
  }

  await registrarEnBitacora(cliente as unknown as SupabaseClient, {
    tenantId: params.tenantId,
    actorUsuarioId: params.actorUsuarioId,
    actorTipo: "usuario",
    accion: params.estado === "bloqueada" ? "seller.membresia_bloqueada" : "seller.membresia_desbloqueada",
    entidadTipo: "seller",
    entidadId: params.sellerId,
    detalle: {},
  });
}

/** Corta el acceso de un seller autoservicio a este courier, sin borrar la membresía. */
export async function bloquearSellerMembresia(
  cliente: ClienteServicio,
  params: { tenantId: string; sellerId: string; actorUsuarioId: string },
): Promise<void> {
  await cambiarEstadoMembresiaPorCourier(cliente, { ...params, estado: "bloqueada" });
}

/** Restaura el acceso de un seller previamente bloqueado. */
export async function desbloquearSellerMembresia(
  cliente: ClienteServicio,
  params: { tenantId: string; sellerId: string; actorUsuarioId: string },
): Promise<void> {
  await cambiarEstadoMembresiaPorCourier(cliente, { ...params, estado: "activa" });
}
