"use server";

/**
 * Server Actions para POD en el portal del seller.
 *
 * El seller puede ver la URL firmada de la foto del POD de sus propios pedidos.
 * La función obtenerUrlFirmadaPod verifica que pod.seller_id === actor.sellerId,
 * por lo que no es posible acceder al POD de otro seller.
 *
 * El foto_path NUNCA se expone al cliente.
 */

import { redirect } from "next/navigation";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { obtenerUrlFirmadaPod } from "@/modules/operacion/pruebas-entrega";

export async function actionObtenerUrlPodSeller(
  podId: string,
): Promise<{ url?: string; error?: string }> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) redirect("/login");
  if (sesion.usuario.tipoUsuario !== "seller" || !sesion.usuario.sellerId) {
    return { error: "Sin permisos para ver la evidencia." };
  }

  try {
    const cliente = crearClienteServiceRole();
    // obtenerUrlFirmadaPod verifica internamente que pod.seller_id === actor.sellerId
    const url = await obtenerUrlFirmadaPod(cliente, podId, sesion.usuario);
    return { url };
  } catch (err) {
    const mensaje =
      err instanceof Error ? err.message : "No se pudo obtener el enlace de la foto.";
    return { error: mensaje };
  }
}
