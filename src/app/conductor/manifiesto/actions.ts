"use server";

import { revalidatePath } from "next/cache";
import { exigirSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeConfirmarManifiestoPropio } from "@/modules/identidad/capacidades";
import { transicionarPedidosSameDayAEnRuta } from "@/modules/operacion/manifiestos-same-day";
import { completarManifiesto } from "@/modules/operacion/manifiestos";

// =============================================================================
// Conductor confirma recepción ("Listo para salir")
// =============================================================================

/**
 * El conductor pone su manifiesto en 'en_ruta'.
 *
 * Efecto adicional (Bloque 2 same-day): transiciona en lote todos los pedidos
 * same-day del manifiesto que estén en 'asignado' → 'en_ruta' con ejecutor
 * 'conductor'. Idempotente. Los pedidos Flex NO se tocan (sus estados vienen de ML).
 */
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

    // Transición del manifiesto a 'en_ruta'.
    const { error } = await cliente
      .from("manifiestos")
      .update({ estado: "en_ruta" })
      .eq("id", manifiestoId)
      .eq("tenant_id", sesion.usuario.tenantId);

    if (error) throw error;

    // Efecto same-day: transicionar en lote los pedidos same-day asignado→en_ruta.
    // Idempotente. Los pedidos Flex no se tocan.
    await transicionarPedidosSameDayAEnRuta(
      cliente,
      manifiestoId,
      sesion.usuario.tenantId,
      sesion.usuario.driverId,
      sesion.usuario,
    );

    revalidatePath("/conductor/manifiesto");
    return { exito: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Error al actualizar el manifiesto." };
  }
}

// =============================================================================
// Conductor finaliza su ruta ("Terminar ruta")
// =============================================================================

/**
 * El conductor marca su manifiesto como 'completado' al terminar la ruta.
 */
export async function actionConductorTerminarRuta(formData: FormData) {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId || !sesion.usuario.driverId) {
    return { error: "Sin sesión de conductor." };
  }

  const manifiestoId = formData.get("manifiestoId") as string;
  if (!manifiestoId) return { error: "Falta el ID del manifiesto." };

  try {
    const cliente = crearClienteServiceRole();
    await completarManifiesto(
      cliente,
      manifiestoId,
      sesion.usuario.tenantId,
      sesion.usuario.driverId,
      sesion.usuario,
      sesion.usuarioId,
    );

    revalidatePath("/conductor/manifiesto");
    return { exito: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Error al completar el manifiesto." };
  }
}
