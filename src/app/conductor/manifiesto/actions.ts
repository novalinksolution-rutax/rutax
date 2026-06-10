"use server";

import { revalidatePath } from "next/cache";
import { exigirSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeConfirmarManifiestoPropio } from "@/modules/identidad/capacidades";

// =============================================================================
// Conductor confirma recepción ("Listo para salir")
// =============================================================================

export async function actionConductorListoParaSalir(formData: FormData) {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId || !sesion.usuario.driverId) {
    return { error: "Sin sesión de conductor." };
  }

  if (!puedeConfirmarManifiestoPropio(sesion.usuario)) {
    return { error: "No tienes permiso para confirmar la salida." };
  }

  const manifiestoId = formData.get("manifiestoId") as string;
  if (!manifiestoId) return { error: "Falta el ID del manifiesto." };

  try {
    const cliente = crearClienteServiceRole();

    // Verificar que el manifiesto pertenece al conductor y está en 'confirmado'
    const { data: manifiesto } = await cliente
      .from("manifiestos")
      .select("estado, driver_id")
      .eq("id", manifiestoId)
      .eq("tenant_id", sesion.usuario.tenantId)
      .eq("driver_id", sesion.usuario.driverId)
      .maybeSingle();

    if (!manifiesto) {
      return { error: "Manifiesto no encontrado." };
    }
    if (manifiesto.estado !== "confirmado") {
      return { error: "El manifiesto no está en estado confirmado." };
    }

    const { error } = await cliente
      .from("manifiestos")
      .update({ estado: "en_ruta" })
      .eq("id", manifiestoId)
      .eq("tenant_id", sesion.usuario.tenantId);

    if (error) throw error;

    revalidatePath("/conductor/manifiesto");
    return { exito: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Error al actualizar el manifiesto." };
  }
}
