/**
 * Enlace permanente de auto-registro de sellers (RF-010 rediseño, alta por
 * autoservicio) — `identidad.enlaces_registro_seller` (migración
 * `20260916000001`).
 * =============================================================================
 * La tabla es DENY-ALL: ni el panel del courier ni la landing pública tocan
 * `authenticated`/`anon` por RLS — todo pasa por `service_role`, acotado por
 * `tenant_id` en código (igual criterio que `invitaciones.ts`).
 *
 * Tres operaciones para el panel del courier (gate `puedeInvitarUsuarios`, el
 * mismo que ya usa "invitar seller" — ver `src/app/(tenant)/sellers/invitar/
 * actions.ts`) y una para la landing pública:
 *   - `obtenerOCrearEnlaceSeller` — trae el vivo o lo crea si el courier nunca
 *     tuvo uno.
 *   - `regenerarEnlaceSeller`     — baja lógica del vigente + inserta otro.
 *   - `anularEnlaceSeller`        — baja lógica sin crear reemplazo (el
 *     courier queda sin enlace vivo a propósito).
 *   - `resolverEnlaceSellerPublico` — token → {tenantId, nombreFantasia}. NUNCA
 *     expone el token de otro courier ni la lista de enlaces.
 */

import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarEnBitacora } from "./auditoria";
import type { ClienteServicio } from "./onboarding";

/** Tamaño del token: 32 bytes aleatorios en base64url — mismo criterio que `invitaciones.ts`. */
const TAMANO_TOKEN_BYTES = 32;

function generarTokenEnlace(): string {
  return randomBytes(TAMANO_TOKEN_BYTES).toString("base64url");
}

export interface EnlaceSellerVigente {
  id: string;
  token: string;
  activo: boolean;
  creadoEn: string;
}

async function crearEnlaceSeller(
  cliente: ClienteServicio,
  tenantId: string,
  actorUsuarioId: string,
): Promise<EnlaceSellerVigente> {
  const token = generarTokenEnlace();

  const { data, error } = await cliente
    .schema("identidad")
    .from("enlaces_registro_seller")
    .insert({ tenant_id: tenantId, token, creado_por: actorUsuarioId })
    .select("id, token, activo, creado_en")
    .single();

  if (error || !data) {
    throw new Error(`No se pudo crear el enlace de registro de sellers: ${error?.message ?? "desconocido"}`);
  }

  await registrarEnBitacora(cliente as unknown as SupabaseClient, {
    tenantId,
    actorUsuarioId,
    actorTipo: "usuario",
    accion: "enlace_registro_seller.creado",
    entidadTipo: "enlace_registro_seller",
    entidadId: data.id as string,
    detalle: {},
  });

  return {
    id: data.id as string,
    token: data.token as string,
    activo: data.activo as boolean,
    creadoEn: data.creado_en as string,
  };
}

/** Devuelve el enlace vivo del courier, o lo crea si nunca tuvo ninguno. */
export async function obtenerOCrearEnlaceSeller(
  cliente: ClienteServicio,
  tenantId: string,
  actorUsuarioId: string,
): Promise<EnlaceSellerVigente> {
  const { data: vigente, error } = await cliente
    .schema("identidad")
    .from("enlaces_registro_seller")
    .select("id, token, activo, creado_en")
    .eq("tenant_id", tenantId)
    .eq("activo", true)
    .maybeSingle();

  if (error) {
    throw new Error(`No se pudo leer el enlace de registro de sellers: ${error.message}`);
  }
  if (vigente) {
    return {
      id: vigente.id as string,
      token: vigente.token as string,
      activo: true,
      creadoEn: vigente.creado_en as string,
    };
  }

  return crearEnlaceSeller(cliente, tenantId, actorUsuarioId);
}

/**
 * Baja lógica del enlace vigente + creación de uno nuevo. Respeta el unique
 * parcial "un enlace vivo por courier" — bajar ANTES de crear.
 */
async function revocarEnlaceVigente(
  cliente: ClienteServicio,
  tenantId: string,
  actorUsuarioId: string,
  accionBitacora: string,
): Promise<void> {
  const { data, error } = await cliente
    .schema("identidad")
    .from("enlaces_registro_seller")
    .update({ activo: false, revocado_en: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("activo", true)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(`No se pudo revocar el enlace de registro de sellers: ${error.message}`);
  }
  if (!data) return; // No había enlace vivo — nada que revocar (idempotente).

  await registrarEnBitacora(cliente as unknown as SupabaseClient, {
    tenantId,
    actorUsuarioId,
    actorTipo: "usuario",
    accion: accionBitacora,
    entidadTipo: "enlace_registro_seller",
    entidadId: data.id as string,
    detalle: {},
  });
}

export async function regenerarEnlaceSeller(
  cliente: ClienteServicio,
  tenantId: string,
  actorUsuarioId: string,
): Promise<EnlaceSellerVigente> {
  await revocarEnlaceVigente(cliente, tenantId, actorUsuarioId, "enlace_registro_seller.regenerado");
  return crearEnlaceSeller(cliente, tenantId, actorUsuarioId);
}

/** Baja lógica del enlace vigente, SIN crear uno nuevo — el courier queda sin enlace vivo. */
export async function anularEnlaceSeller(
  cliente: ClienteServicio,
  tenantId: string,
  actorUsuarioId: string,
): Promise<void> {
  await revocarEnlaceVigente(cliente, tenantId, actorUsuarioId, "enlace_registro_seller.anulado");
}

export interface EnlaceSellerPublico {
  tenantId: string;
  nombreFantasia: string;
}

/**
 * Resolución PÚBLICA token → tenant, para la landing sin sesión. Devuelve
 * `null` si el token no existe o su enlace está `activo=false` — nunca
 * distingue el motivo (no hay nada que ganar filtrando "no existe" de
 * "revocado" a quien no tiene sesión).
 *
 * Expone EXCLUSIVAMENTE `nombreFantasia` del courier — nunca el token, la
 * lista de enlaces, ni ningún dato de `sellers`/`seller_identidades`.
 */
export async function resolverEnlaceSellerPublico(
  cliente: ClienteServicio,
  token: string,
): Promise<EnlaceSellerPublico | null> {
  const limpio = token.trim();
  if (!limpio) return null;

  const { data: enlace, error } = await cliente
    .schema("identidad")
    .from("enlaces_registro_seller")
    .select("tenant_id, activo")
    .eq("token", limpio)
    .maybeSingle();

  if (error || !enlace || enlace.activo !== true) return null;

  const tenantId = enlace.tenant_id as string;

  const { data: tenant } = await cliente.from("tenants").select("nombre_fantasia").eq("id", tenantId).maybeSingle();

  const nombreFantasia = (tenant?.nombre_fantasia as string | undefined)?.trim();
  if (!nombreFantasia) return null; // Defensivo — no debería pasar (FK cascade tenant→enlace).

  return { tenantId, nombreFantasia };
}
