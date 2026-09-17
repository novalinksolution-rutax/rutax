"use server";

/**
 * Server Actions — landing PÚBLICA de auto-registro de sellers (RF-010
 * rediseño). SIN sesión: cualquiera con el enlace correcto llega acá.
 *
 * Nunca expone el token de OTRO courier ni la lista de enlaces — solo
 * resuelve el propio, vía `resolverEnlaceSellerPublico` (`service_role`,
 * `identidad.enlaces_registro_seller` es deny-all).
 */

import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { resolverEnlaceSellerPublico } from "@/modules/identidad/enlaces-seller";
import { guardarBorrador as guardarBorradorRegistroSeller } from "@/lib/identidad/borrador-registro-seller";

export type ResultadoEnlacePublico =
  | { ok: true; tenantId: string; nombreFantasia: string }
  | { ok: false; mensaje: string };

/** Resuelve el enlace para pintar la landing ("Vas a registrarte con <nombreFantasia>"). */
export async function resolverEnlaceSellerPublicoAction(token: string): Promise<ResultadoEnlacePublico> {
  const limpio = (token ?? "").trim();
  if (!limpio) return { ok: false, mensaje: "Este enlace no es válido." };

  try {
    const enlace = await resolverEnlaceSellerPublico(crearClienteServiceRole(), limpio);
    if (!enlace) return { ok: false, mensaje: "Este enlace no es válido o ya no está activo." };
    return { ok: true, tenantId: enlace.tenantId, nombreFantasia: enlace.nombreFantasia };
  } catch {
    return { ok: false, mensaje: "No pudimos validar el enlace por un problema de nuestro sistema." };
  }
}

export type ResultadoIniciarRegistroSeller = { ok: true } | { ok: false; mensaje: string };

/**
 * Guarda el `intent=registro-seller` (tenantId del enlace + el token) en una
 * cookie firmada, ANTES de mandar al visitante a Google — mismo molde que
 * `guardarBorradorTenant` (F1). El cliente llama a esto y LUEGO dispara
 * `supabase.auth.signInWithOAuth({ provider: 'google' })` por su cuenta (el
 * mismo patrón que `formulario-alta-empresa.tsx`).
 */
export async function iniciarRegistroSellerAction(token: string): Promise<ResultadoIniciarRegistroSeller> {
  const limpio = (token ?? "").trim();
  if (!limpio) return { ok: false, mensaje: "Este enlace no es válido." };

  const enlace = await resolverEnlaceSellerPublico(crearClienteServiceRole(), limpio);
  if (!enlace) return { ok: false, mensaje: "Este enlace no es válido o ya no está activo." };

  await guardarBorradorRegistroSeller({ tenantId: enlace.tenantId, enlaceToken: limpio });
  return { ok: true };
}
