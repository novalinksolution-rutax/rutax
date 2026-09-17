"use server";

/**
 * Server Actions — selector multi-courier del seller (RF-010 rediseño), estilo
 * el del conductor F4. Una misma identidad Google puede ser seller de N
 * couriers; acá elige con cuál opera.
 */

import { revalidatePath } from "next/cache";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { createClient } from "@/lib/supabase/server";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  cambiarCourierActivo,
  listarMisMembresiasSeller,
  type MembresiaSellerConNombre,
} from "@/modules/identidad/seller-membresias";
import { ErrorIdentidad } from "@/modules/identidad/errores";

async function exigirSeller(): Promise<
  { ok: true; authUserId: string; tenantIdActual: string | null } | { ok: false; mensaje: string }
> {
  const sesion = await obtenerSesionActual();
  if (!sesion || sesion.usuario.tipoUsuario !== "seller") {
    return { ok: false, mensaje: "Esta acción es del portal del seller." };
  }
  return { ok: true, authUserId: sesion.usuarioId, tenantIdActual: sesion.usuario.tenantId };
}

export type ResultadoListarCouriers =
  | { ok: true; couriers: MembresiaSellerConNombre[] }
  | { ok: false; mensaje: string };

/** Las N membresías de la identidad actual, con el nombre de cada courier. */
export async function listarMisCouriersAction(): Promise<ResultadoListarCouriers> {
  const g = await exigirSeller();
  if (!g.ok) return g;

  try {
    const couriers = await listarMisMembresiasSeller(crearClienteServiceRole(), g.authUserId, g.tenantIdActual);
    return { ok: true, couriers };
  } catch {
    return { ok: false, mensaje: "No pudimos cargar tus couriers por un problema de nuestro sistema." };
  }
}

export type ResultadoCambiarCourier = { ok: true; tenantId: string } | { ok: false; mensaje: string };

/** Conmuta el courier activo — reescribe `usuarios_perfil` y refresca el JWT. */
export async function cambiarCourierActivoAction(tenantId: string): Promise<ResultadoCambiarCourier> {
  const g = await exigirSeller();
  if (!g.ok) return g;
  if (!tenantId?.trim()) return { ok: false, mensaje: "Falta indicar el courier." };

  try {
    const resultado = await cambiarCourierActivo(crearClienteServiceRole(), {
      authUserId: g.authUserId,
      tenantId: tenantId.trim(),
    });

    // Refrescar el JWT: usuarios_perfil.{tenant_id,seller_id} recién cambió.
    const supabase = await createClient();
    await supabase.auth.refreshSession();

    revalidatePath("/portal");
    return { ok: true, tenantId: resultado.tenantId };
  } catch (err) {
    if (err instanceof ErrorIdentidad) return { ok: false, mensaje: err.message };
    return { ok: false, mensaje: "No pudimos cambiar de courier por un problema de nuestro sistema." };
  }
}
