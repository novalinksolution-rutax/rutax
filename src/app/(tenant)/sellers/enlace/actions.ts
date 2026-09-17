"use server";

/**
 * Server Actions — enlace permanente de auto-registro de sellers (RF-010
 * rediseño). Gate: `puedeInvitarUsuarios`, el MISMO que ya usa "invitar
 * seller" (`src/app/(tenant)/sellers/invitar/actions.ts`) — gestionar cómo
 * entra un seller nuevo es la misma responsabilidad, cambie el mecanismo.
 *
 * Capa delgada: valida sesión + capacidad y delega todo a
 * `src/modules/identidad/enlaces-seller.ts`.
 */

import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { puedeInvitarUsuarios } from "@/modules/identidad/capacidades";
import {
  anularEnlaceSeller,
  obtenerOCrearEnlaceSeller,
  regenerarEnlaceSeller,
} from "@/modules/identidad/enlaces-seller";

export type ResultadoEnlaceSeller =
  | { ok: true; token: string; activo: boolean }
  | { ok: false; mensaje: string };

async function exigirGate(): Promise<
  { ok: true; tenantId: string; usuarioId: string } | { ok: false; mensaje: string }
> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) return { ok: false, mensaje: "No hay una sesión activa." };
  if (!puedeInvitarUsuarios(sesion.usuario)) {
    return { ok: false, mensaje: "No tienes permiso para gestionar el enlace de registro de sellers." };
  }
  return { ok: true, tenantId: sesion.usuario.tenantId, usuarioId: sesion.usuarioId };
}

/** Trae el enlace vivo del tenant, o lo crea si nunca tuvo uno. */
export async function obtenerEnlaceSellerAction(): Promise<ResultadoEnlaceSeller> {
  const g = await exigirGate();
  if (!g.ok) return g;

  try {
    const enlace = await obtenerOCrearEnlaceSeller(crearClienteServiceRole(), g.tenantId, g.usuarioId);
    return { ok: true, token: enlace.token, activo: enlace.activo };
  } catch (err) {
    return {
      ok: false,
      mensaje: err instanceof Error ? err.message : "No se pudo obtener el enlace de registro.",
    };
  }
}

/** Baja lógica del enlace vigente + creación de uno nuevo (invalida el anterior). */
export async function regenerarEnlaceSellerAction(): Promise<ResultadoEnlaceSeller> {
  const g = await exigirGate();
  if (!g.ok) return g;

  try {
    const enlace = await regenerarEnlaceSeller(crearClienteServiceRole(), g.tenantId, g.usuarioId);
    return { ok: true, token: enlace.token, activo: enlace.activo };
  } catch (err) {
    return {
      ok: false,
      mensaje: err instanceof Error ? err.message : "No se pudo regenerar el enlace de registro.",
    };
  }
}

export type ResultadoAnularEnlaceSeller = { ok: true } | { ok: false; mensaje: string };

/** Baja lógica del enlace vigente, sin crear uno nuevo — el courier queda sin enlace vivo. */
export async function anularEnlaceSellerAction(): Promise<ResultadoAnularEnlaceSeller> {
  const g = await exigirGate();
  if (!g.ok) return g;

  try {
    await anularEnlaceSeller(crearClienteServiceRole(), g.tenantId, g.usuarioId);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      mensaje: err instanceof Error ? err.message : "No se pudo anular el enlace de registro.",
    };
  }
}
