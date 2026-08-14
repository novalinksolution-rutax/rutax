"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { exigirSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { confirmarManifiesto, completarManifiesto } from "@/modules/operacion/manifiestos";
import { puedeAsignarYReasignarPedidos } from "@/modules/identidad/capacidades";
import { marcarConductorNoDisponibleYRedistribuir } from "@/modules/operacion/auto-asignacion";
import type { ResultadoRedistribucion } from "@/modules/operacion/tipos";
import { ahoraEnSantiago } from "@/lib/fecha-santiago";

// =============================================================================
// Tipos de respuesta compartidos
// =============================================================================

type RespuestaOk<T> = { ok: true; datos: T };
type RespuestaError = { ok: false; mensaje: string };
type Respuesta<T> = RespuestaOk<T> | RespuestaError;

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
    await confirmarManifiesto(cliente, manifiestoId, sesion.usuario.tenantId, sesion.usuario, sesion.usuarioId);
    revalidatePath(`/manifiestos/${manifiestoId}`);
    return { exito: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Error al confirmar el manifiesto." };
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

// =============================================================================
// Completar manifiesto (coordinador / supervisor)
// =============================================================================

/**
 * El coordinador o supervisor marca un manifiesto como 'completado'.
 */
export async function actionCompletarManifiesto(formData: FormData) {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) return { error: "Sin sesión." };

  if (!puedeAsignarYReasignarPedidos(sesion.usuario)) {
    return { error: "No tienes permiso para completar manifiestos." };
  }

  const manifiestoId = formData.get("manifiestoId") as string;
  const driverId = formData.get("driverId") as string;

  if (!manifiestoId || !driverId) return { error: "Faltan datos requeridos." };

  try {
    const cliente = crearClienteServiceRole();
    await completarManifiesto(
      cliente,
      manifiestoId,
      sesion.usuario.tenantId,
      driverId,
      sesion.usuario,
      sesion.usuarioId,
    );

    revalidatePath(`/manifiestos/${manifiestoId}`);
    revalidatePath("/manifiestos");
    return { exito: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Error al completar el manifiesto." };
  }
}

// =============================================================================
// Marcar conductor no disponible y redistribuir (F6, ítem 1.3)
// =============================================================================
//
// La auto-asignación en bloque del día (`autoAsignarPendientesDelDia`) vivió
// acá hasta el 2026-08-14: se desactivó el 2026-08-12 (Etapa 0 de
// docs/arquitectura/retiro-y-ruteo-plan.md) porque barría pedidos sin saber
// de retiros físicos, y se eliminó por completo al quedar inalcanzable y
// reemplazada por la selección masiva por filtros (Etapa 6). Ver el
// comentario de cabecera de src/modules/operacion/auto-asignacion.ts.
// "Marcar no disponible + redistribuir" es una función DISTINTA que sigue
// activa: solo mueve las paradas de un conductor puntual, no barre pedidos
// sueltos del día.

/**
 * Marca un conductor como no disponible y redistribuye sus paradas abiertas.
 * Devuelve el resultado con impacto SLA por seller afectado.
 */
export async function actionMarcarConductorNoDisponible(
  conductorId: string,
  fecha?: string,
): Promise<Respuesta<ResultadoRedistribucion>> {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) {
    return { ok: false, mensaje: "No hay sesión activa." };
  }

  if (!puedeAsignarYReasignarPedidos(sesion.usuario)) {
    return {
      ok: false,
      mensaje: "No tienes permiso para modificar la disponibilidad de conductores.",
    };
  }

  if (!conductorId) {
    return { ok: false, mensaje: "ID de conductor requerido." };
  }

  const fechaOperacion = fecha ?? ahoraEnSantiago().fecha;

  try {
    const cliente = crearClienteServiceRole();
    const resultado = await marcarConductorNoDisponibleYRedistribuir(
      cliente,
      sesion.usuario.tenantId,
      conductorId,
      fechaOperacion,
      sesion.usuario,
      sesion.usuarioId,
    );

    revalidatePath("/manifiestos");

    return { ok: true, datos: resultado };
  } catch (err) {
    const mensaje =
      err instanceof Error ? err.message : "Error al procesar la redistribución.";
    return { ok: false, mensaje };
  }
}
