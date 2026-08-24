"use server";

import { revalidatePath } from "next/cache";
import { exigirSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeAsignarYReasignarPedidos } from "@/modules/identidad/capacidades";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";

// =============================================================================
// Quitar pedido del manifiesto (desactivar asignación)
// =============================================================================

export async function actionQuitarPedidoDeManifiesto(formData: FormData) {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) return { error: "Sin sesión." };

  if (!puedeAsignarYReasignarPedidos(sesion.usuario)) {
    return { error: "No tienes permiso para quitar pedidos del manifiesto." };
  }

  const asignacionId = formData.get("asignacionId") as string;
  const manifiestoId = formData.get("manifiestoId") as string;

  if (!asignacionId || !manifiestoId) {
    return { error: "Faltan datos requeridos." };
  }

  // Peldaño 2 de la escalera de fricción. Quitar una parada devuelve el pedido a
  // la bandeja SIN CONDUCTOR, y hasta hoy se ejecutaba al primer clic y sin
  // dejar rastro: mañana alguien encuentra ese pedido suelto y no hay forma de
  // saber quién lo sacó ni por qué.
  const motivo = ((formData.get("motivo") as string) ?? "").trim();
  if (motivo.length < 3) return { error: "Escribe por qué sale esta parada." };

  try {
    const cliente = crearClienteServiceRole();

    // Verificar que el manifiesto está en borrador antes de quitar
    const { data: manifiesto } = await cliente
      .from("manifiestos")
      .select("estado")
      .eq("id", manifiestoId)
      .eq("tenant_id", sesion.usuario.tenantId)
      .maybeSingle();

    if (!manifiesto || manifiesto.estado !== "borrador") {
      return { error: "Solo se pueden quitar pedidos de manifiestos en borrador." };
    }

    // Bitácora ANTES del efecto (invariante de CLAUDE.md): el registro queda
    // aunque falle el paso siguiente y el pedido quede a medio camino.
    await registrarEnBitacora(cliente, {
      tenantId: sesion.usuario.tenantId,
      actorUsuarioId: sesion.usuarioId,
      actorTipo: "usuario",
      accion: "manifiesto.parada_quitada",
      entidadTipo: "manifiesto",
      entidadId: manifiestoId,
      detalle: { manifiesto_id: manifiestoId, asignacion_id: asignacionId, motivo },
    });

    // Desactivar la asignación
    const { error } = await cliente
      .from("asignaciones_pedido")
      .update({ activa: false, desasignado_en: new Date().toISOString() })
      .eq("id", asignacionId)
      .eq("tenant_id", sesion.usuario.tenantId);

    if (error) throw error;

    // Devolver el pedido a pendiente_asignacion
    const { data: asignacion } = await cliente
      .from("asignaciones_pedido")
      .select("pedido_id")
      .eq("id", asignacionId)
      .maybeSingle();

    if (asignacion?.pedido_id) {
      await cliente
        .from("pedidos")
        .update({ estado: "pendiente_asignacion", driver_id_asignado: null })
        .eq("id", asignacion.pedido_id as string)
        .eq("tenant_id", sesion.usuario.tenantId);
    }

    revalidatePath(`/manifiestos/${manifiestoId}`);
    revalidatePath("/operaciones");
    return { exito: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Error al quitar el pedido." };
  }
}
