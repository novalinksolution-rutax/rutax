"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { exigirSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { crearManifiesto, confirmarManifiesto, asignarPedidosAManifiesto, completarManifiesto } from "@/modules/operacion/manifiestos";
import { puedeGenerarManifiestos, puedeAsignarYReasignarPedidos } from "@/modules/identidad/capacidades";
import {
  autoAsignarPendientesDelDia,
  marcarConductorNoDisponibleYRedistribuir,
} from "@/modules/operacion/auto-asignacion";
import type { ResultadoAutoAsignacion, ResultadoRedistribucion } from "@/modules/operacion/tipos";
import { ahoraEnSantiago } from "@/lib/fecha-santiago";

// =============================================================================
// Tipos de respuesta compartidos
// =============================================================================

type RespuestaOk<T> = { ok: true; datos: T };
type RespuestaError = { ok: false; mensaje: string };
type Respuesta<T> = RespuestaOk<T> | RespuestaError;

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
    await confirmarManifiesto(cliente, manifiestoId, sesion.usuario.tenantId, sesion.usuario, sesion.usuarioId);
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
    await asignarPedidosAManifiesto(cliente, manifiestoId, pedidoIds, sesion.usuario, sesion.usuarioId);
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

// =============================================================================
// Completar manifiesto (coordinador / supervisor)
// =============================================================================

/**
 * El coordinador o supervisor marca un manifiesto como 'completado'.
 *
 * ALTO-1: llama a `completarManifiesto` que, además de la transición de estado,
 * borra server-side la ubicación GPS del conductor (minimización — Ley 21.431).
 * Esto garantiza el borrado independientemente de si el conductor cierra o no
 * su sesión en la PWA.
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
// Auto-asignación heurística (F6, ítem 1.3) — DESACTIVADA (2026-08-12)
// =============================================================================
//
// Etapa 0 de docs/arquitectura/retiro-y-ruteo-plan.md: ver el comentario de
// cabecera de src/modules/operacion/auto-asignacion.ts para el porqué. El
// botón que llamaba a esta acción ya no se renderiza en ninguna pantalla;
// esta guarda cubre que alguien la invoque por una ruta directa. No se borra
// la acción ni el motor de abajo — se reactiva quitando la guarda.
const AUTO_ASIGNACION_DESACTIVADA = true;

/**
 * Dispara el motor heurístico para asignar los pedidos pendientes del día.
 * La fecha se obtiene del día actual en zona America/Santiago si no se pasa.
 */
export async function actionAutoAsignarPendientes(
  fecha?: string,
): Promise<Respuesta<ResultadoAutoAsignacion>> {
  if (AUTO_ASIGNACION_DESACTIVADA) {
    return {
      ok: false,
      mensaje:
        "La auto-asignación automática está desactivada. Asigna los pedidos manualmente desde el manifiesto.",
    };
  }

  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) {
    return { ok: false, mensaje: "No hay sesión activa." };
  }

  if (!puedeAsignarYReasignarPedidos(sesion.usuario)) {
    return { ok: false, mensaje: "No tienes permiso para asignar pedidos." };
  }

  const fechaOperacion = fecha ?? ahoraEnSantiago().fecha;

  try {
    const cliente = crearClienteServiceRole();
    const resultado = await autoAsignarPendientesDelDia(
      cliente,
      sesion.usuario.tenantId,
      fechaOperacion,
      sesion.usuario,
      sesion.usuarioId,
    );

    revalidatePath("/manifiestos");

    return { ok: true, datos: resultado };
  } catch (err) {
    const mensaje =
      err instanceof Error ? err.message : "Error al ejecutar la auto-asignación.";
    return { ok: false, mensaje };
  }
}

// =============================================================================
// Marcar conductor no disponible y redistribuir (F6, ítem 1.3)
// =============================================================================

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
