"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { exigirSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { crearManifiesto, confirmarManifiesto, asignarPedidosAManifiesto } from "@/modules/operacion/manifiestos";
import { puedeGenerarManifiestos, puedeAsignarYReasignarPedidos } from "@/modules/identidad/capacidades";

// =============================================================================
// Crear manifiesto
// =============================================================================

export async function actionCrearManifiesto(formData: FormData) {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) redirect("/login");

  if (!puedeGenerarManifiestos(sesion.usuario)) {
    return { error: "No tienes permiso para crear manifiestos." };
  }

  const driverId = formData.get("driverId") as string;
  const fechaOperacion = formData.get("fechaOperacion") as string;
  const nombre = formData.get("nombre") as string;
  const notas = (formData.get("notas") as string) || undefined;

  if (!driverId || !fechaOperacion || !nombre?.trim()) {
    return { error: "Conductor, fecha y nombre son obligatorios." };
  }

  try {
    const cliente = crearClienteServiceRole();
    const manifiesto = await crearManifiesto(
      cliente,
      {
        tenantId: sesion.usuario.tenantId,
        driverId,
        nombre: nombre.trim(),
        fechaOperacion,
        notas,
        creadoPorUsuarioId: sesion.usuarioId,
      },
      sesion.usuario,
    );
    revalidatePath("/manifiestos");
    redirect(`/manifiestos/${manifiesto.id}`);
  } catch (err) {
    if (err instanceof Error && err.message.includes("NEXT_REDIRECT")) throw err;
    return { error: err instanceof Error ? err.message : "Error al crear el manifiesto." };
  }
}

// =============================================================================
// Confirmar manifiesto
// =============================================================================

export async function actionConfirmarManifiesto(formData: FormData) {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) return { error: "Sin sesión." };

  if (!puedeAsignarYReasignarPedidos(sesion.usuario)) {
    return { error: "No tienes permiso para confirmar manifiestos." };
  }

  const manifiestoId = formData.get("manifiestoId") as string;
  if (!manifiestoId) return { error: "Falta el ID del manifiesto." };

  try {
    const cliente = crearClienteServiceRole();
    await confirmarManifiesto(cliente, manifiestoId, sesion.usuario.tenantId, sesion.usuario);
    revalidatePath(`/manifiestos/${manifiestoId}`);
    return { exito: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Error al confirmar el manifiesto." };
  }
}

// =============================================================================
// Asignar pedidos al manifiesto
// =============================================================================

export async function actionAsignarPedidos(formData: FormData) {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) return { error: "Sin sesión." };

  if (!puedeAsignarYReasignarPedidos(sesion.usuario)) {
    return { error: "No tienes permiso para asignar pedidos." };
  }

  const manifiestoId = formData.get("manifiestoId") as string;
  const pedidoIdsRaw = formData.get("pedidoIds") as string;

  if (!manifiestoId || !pedidoIdsRaw) return { error: "Faltan datos requeridos." };

  const pedidoIds = pedidoIdsRaw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (pedidoIds.length === 0) return { error: "Debes seleccionar al menos un pedido." };

  try {
    const cliente = crearClienteServiceRole();
    await asignarPedidosAManifiesto(cliente, manifiestoId, pedidoIds, sesion.usuario);
    revalidatePath(`/manifiestos/${manifiestoId}`);
    revalidatePath(`/manifiestos/${manifiestoId}/asignar`);
    return { exito: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Error al asignar los pedidos." };
  }
}

// =============================================================================
// Cancelar manifiesto
// =============================================================================

export async function actionCancelarManifiesto(formData: FormData) {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) return { error: "Sin sesión." };

  const manifiestoId = formData.get("manifiestoId") as string;
  if (!manifiestoId) return { error: "Falta el ID del manifiesto." };

  try {
    const cliente = crearClienteServiceRole();
    await cliente
      .from("manifiestos")
      .update({ estado: "cancelado" })
      .eq("id", manifiestoId)
      .eq("tenant_id", sesion.usuario.tenantId)
      .eq("estado", "borrador");

    revalidatePath("/manifiestos");
    redirect("/manifiestos");
  } catch (err) {
    if (err instanceof Error && err.message.includes("NEXT_REDIRECT")) throw err;
    return { error: err instanceof Error ? err.message : "Error al cancelar." };
  }
}
