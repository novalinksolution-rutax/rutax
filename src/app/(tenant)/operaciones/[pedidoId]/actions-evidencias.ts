"use server";

/**
 * Server Actions para evidencias de entrega INFORMATIVAS en el área del coordinador.
 *
 * El coordinador (rol interno del courier) puede ver las evidencias de cualquier
 * pedido de su tenant. obtenerUrlFirmadaEvidencia ya verifica RBAC y aislamiento.
 *
 * El path de la foto nunca se loguea.
 */

import { redirect } from "next/navigation";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { obtenerUrlFirmadaEvidencia } from "@/modules/operacion/evidencias-entrega";

export async function actionObtenerUrlEvidenciaCoordinador(
  evidenciaId: string,
): Promise<{ url?: string; error?: string }> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) redirect("/login");
  if (sesion.usuario.tipoUsuario !== "interno") {
    return { error: "Sin permisos para ver la evidencia." };
  }

  try {
    const cliente = crearClienteServiceRole();
    const url = await obtenerUrlFirmadaEvidencia(cliente, evidenciaId, sesion.usuario);
    return { url };
  } catch (err) {
    const mensaje =
      err instanceof Error ? err.message : "No se pudo obtener el enlace de la foto.";
    return { error: mensaje };
  }
}
