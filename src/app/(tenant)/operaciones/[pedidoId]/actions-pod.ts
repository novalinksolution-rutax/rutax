"use server";

/**
 * Server Actions para POD en el área del coordinador (tenant).
 *
 * El coordinador (rol interno del courier) puede ver el POD de cualquier
 * pedido de su tenant. La función obtenerUrlFirmadaPod ya verifica RBAC
 * y aislamiento de tenant.
 *
 * El path de foto nunca se loguea.
 */

import { redirect } from "next/navigation";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { obtenerUrlFirmadaPod } from "@/modules/operacion/pruebas-entrega";

export async function actionObtenerUrlPodCoordinador(
  podId: string,
): Promise<{ url?: string; error?: string }> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) redirect("/login");
  if (sesion.usuario.tipoUsuario !== "interno") {
    return { error: "Sin permisos para ver la evidencia." };
  }

  try {
    const cliente = crearClienteServiceRole();
    const url = await obtenerUrlFirmadaPod(cliente, podId, sesion.usuario);
    return { url };
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : "No se pudo obtener el enlace de la foto.";
    return { error: mensaje };
  }
}
