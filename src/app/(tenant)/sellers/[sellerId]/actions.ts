"use server";

/**
 * Server Actions — bloqueo/desbloqueo del acceso de un seller autoservicio
 * (RF-010 rediseño). NO borra la membresía: la marca `bloqueada` (trazable) —
 * ver `identidad.seller_membresias` y `src/modules/identidad/seller-membresias.ts`.
 *
 * Gate: `puedeInvitarUsuarios`, el mismo que gestiona el ciclo de vida de un
 * seller invitado manualmente (revocar su invitación, etc.).
 */

import { revalidatePath } from "next/cache";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeInvitarUsuarios } from "@/modules/identidad/capacidades";
import { bloquearSellerMembresia, desbloquearSellerMembresia } from "@/modules/identidad/seller-membresias";
import { ErrorIdentidad } from "@/modules/identidad/errores";

export type ResultadoBloqueoSeller = { ok: true } | { ok: false; mensaje: string };

async function exigirGate(): Promise<
  { ok: true; tenantId: string; usuarioId: string } | { ok: false; mensaje: string }
> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) return { ok: false, mensaje: "No hay una sesión activa." };
  if (!puedeInvitarUsuarios(sesion.usuario)) {
    return { ok: false, mensaje: "No tienes permiso para gestionar el acceso de sellers." };
  }
  return { ok: true, tenantId: sesion.usuario.tenantId, usuarioId: sesion.usuarioId };
}

/** Corta el acceso de un seller autoservicio a este courier — no borra la membresía. */
export async function bloquearSellerAction(sellerId: string): Promise<ResultadoBloqueoSeller> {
  const g = await exigirGate();
  if (!g.ok) return g;

  try {
    await bloquearSellerMembresia(crearClienteServiceRole(), {
      tenantId: g.tenantId,
      sellerId,
      actorUsuarioId: g.usuarioId,
    });
    revalidatePath(`/sellers/${sellerId}`);
    revalidatePath("/sellers");
    return { ok: true };
  } catch (err) {
    if (err instanceof ErrorIdentidad) return { ok: false, mensaje: err.message };
    return { ok: false, mensaje: "No pudimos bloquear a este seller por un problema de nuestro sistema." };
  }
}

/** Restaura el acceso de un seller previamente bloqueado. */
export async function desbloquearSellerAction(sellerId: string): Promise<ResultadoBloqueoSeller> {
  const g = await exigirGate();
  if (!g.ok) return g;

  try {
    await desbloquearSellerMembresia(crearClienteServiceRole(), {
      tenantId: g.tenantId,
      sellerId,
      actorUsuarioId: g.usuarioId,
    });
    revalidatePath(`/sellers/${sellerId}`);
    revalidatePath("/sellers");
    return { ok: true };
  } catch (err) {
    if (err instanceof ErrorIdentidad) return { ok: false, mensaje: err.message };
    return { ok: false, mensaje: "No pudimos desbloquear a este seller por un problema de nuestro sistema." };
  }
}
