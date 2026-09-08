"use server";

/**
 * Carga del panel lateral de un manifiesto. Reusa el MISMO cargador que la
 * página de detalle, así el panel y la página muestran lo mismo.
 */

import { exigirSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  cargarDetalleManifiesto,
  type DatosDetalleManifiesto,
} from "./[manifiestoId]/datos-detalle";

export type RespuestaVistaPreviaManifiesto =
  | { ok: true; datos: DatosDetalleManifiesto }
  | { ok: false };

export async function accionVistaPreviaManifiesto(
  manifiestoId: string,
): Promise<RespuestaVistaPreviaManifiesto> {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) return { ok: false };

  const datos = await cargarDetalleManifiesto(
    crearClienteServiceRole(),
    sesion.usuario.tenantId,
    sesion.usuario,
    manifiestoId,
  ).catch(() => null);

  return datos ? { ok: true, datos } : { ok: false };
}
