"use server";

/**
 * Server Action para anular una línea de liquidación por SU ID.
 *
 * Vive junto a la ficha del conductor y no en
 * `(tenant)/operaciones/[pedidoId]/acciones-dinero.ts` a propósito: aquel
 * archivo agrupa las correcciones de dinero que se hacen DESDE UN PEDIDO, y
 * todas sus acciones reciben un `pedidoId`. Una línea de retiro en bodega no
 * tiene pedido, así que meterla ahí obligaría a que el archivo mintiera sobre
 * su propio eje.
 *
 * El `revalidatePath` apunta a la ficha del conductor porque es la única
 * pantalla desde la que se llega a una línea de retiro.
 */

import { revalidatePath } from "next/cache";
import { exigirSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { anularLineaLiquidacion } from "@/modules/dinero/acciones";

export async function accionAnularLineaLiquidacion(
  lineaId: string,
  motivo: string,
): Promise<{ ok: boolean; mensaje?: string }> {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) return { ok: false, mensaje: "Sin sesión." };
  try {
    await anularLineaLiquidacion(
      sesion.usuario.tenantId,
      lineaId,
      motivo,
      sesion.usuario,
      sesion.usuarioId,
    );
    // Sin driverId a mano y sin querer una segunda lectura solo para armar la
    // ruta: se revalida la sección entera, que son dos pantallas.
    revalidatePath("/conductores", "layout");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      mensaje: err instanceof Error ? err.message : "Error al anular la línea.",
    };
  }
}
