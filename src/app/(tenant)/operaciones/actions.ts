"use server";

/**
 * Server Actions para el módulo de operaciones.
 * Usadas por los formularios de: crear pedido same-day, cambiar estado manual,
 * abrir incidencia.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { actualizarEstadoPedido, crearPedidoSameDay, abrirIncidencia } from "@/modules/operacion/index";
import {
  puedeAjustarOperacionDiaria,
  puedeGestionarIncidencias,
  puedeAsignarYReasignarPedidos,
} from "@/modules/identidad/capacidades";
import type { EstadoPedido, TipoIncidencia } from "@/modules/operacion/tipos";

// =============================================================================
// Cambiar estado del pedido (corrección manual — drawer)
// =============================================================================

export async function actionCambiarEstadoPedido(formData: FormData) {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) redirect("/login");

  if (!puedeAjustarOperacionDiaria(sesion.usuario)) {
    return { error: "No tienes permiso para cambiar estados manualmente." };
  }

  const pedidoId = formData.get("pedidoId") as string;
  const estadoEsperado = formData.get("estadoEsperado") as EstadoPedido;
  const estadoNuevo = formData.get("estadoNuevo") as EstadoPedido;
  const motivo = formData.get("motivo") as string;

  if (!pedidoId || !estadoEsperado || !estadoNuevo) {
    return { error: "Faltan datos requeridos." };
  }
  if (!motivo || motivo.trim().length < 10) {
    return { error: "El motivo debe tener al menos 10 caracteres." };
  }

  // Defensa en profundidad (docs/arquitectura/edicion-y-cancelacion-de-pedidos.md
  // §3.2/§4.1 — "ocultar no basta"): esta corrección genérica no conoce el
  // tipo_pedido del pedido, así que no puede imponer la barrera same_day que sí
  // impone `cancelarPedido`. Para las 3 transiciones NUEVAS hacia 'cancelado'
  // (§3.3) esa barrera es obligatoria — se rechaza aquí, sin llegar a tocar la
  // BD, y se dirige a la acción dedicada (que sí valida same_day + preflight de
  // dinero). Desde 'fallido'/'fallido_manual' NO se bloquea: es la válvula de
  // escape existente para un Flex atascado, sin cambios.
  if (
    estadoNuevo === "cancelado" &&
    (estadoEsperado === "pendiente_asignacion" ||
      estadoEsperado === "asignado" ||
      estadoEsperado === "en_ruta")
  ) {
    return {
      error:
        "Para cancelar este pedido usa el botón \"Cancelar pedido\": valida que sea same-day y revisa el estado del dinero antes de confirmar.",
    };
  }

  try {
    const cliente = crearClienteServiceRole();
    await actualizarEstadoPedido(
      cliente,
      {
        pedidoId,
        tenantId: sesion.usuario.tenantId,
        estadoNuevo,
        estadoEsperado,
        ejecutor: "interno",
        actuadoPorUsuarioId: sesion.usuarioId,
        motivo,
      },
      sesion.usuario,
    );
    revalidatePath(`/operaciones/${pedidoId}`);
    revalidatePath("/operaciones");
    return { exito: true };
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : "Error desconocido";
    return { error: mensaje };
  }
}

// =============================================================================
// Crear pedido same-day
// =============================================================================

export async function actionCrearPedidoSameDay(formData: FormData) {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) redirect("/login");

  // Mismo gate RBAC que muestra el botón en la UI (page.tsx: `puedeAjustar`).
  // La Server Action es invocable directamente, así que la comprobación no puede
  // vivir solo en el render — se impone también en el servidor.
  if (!puedeAjustarOperacionDiaria(sesion.usuario)) {
    return { error: "No tienes permiso para crear pedidos same-day." };
  }

  const destinatarioNombre = formData.get("destinatarioNombre") as string;
  const destinatarioDireccion = formData.get("destinatarioDireccion") as string;
  const destinatarioComuna = formData.get("destinatarioComuna") as string;
  const destinatarioTelefono = (formData.get("destinatarioTelefono") as string) || undefined;
  const instruccionesEntrega = (formData.get("instruccionesEntrega") as string) || undefined;
  const fechaCompromiso = (formData.get("fechaCompromiso") as string) || undefined;
  const sellerId = formData.get("sellerId") as string;

  if (!destinatarioNombre?.trim() || !destinatarioDireccion?.trim() || !destinatarioComuna?.trim()) {
    return { error: "Nombre, dirección y comuna son obligatorios." };
  }
  if (!sellerId) {
    return { error: "Debe seleccionar un seller." };
  }

  try {
    const cliente = crearClienteServiceRole();
    const { pedido, avisoCorte } = await crearPedidoSameDay(cliente, {
      tenantId: sesion.usuario.tenantId,
      sellerId,
      destinatarioNombre,
      destinatarioDireccion,
      destinatarioComuna,
      destinatarioTelefono,
      instruccionesEntrega,
      fechaCompromiso,
      actorUsuarioId: sesion.usuarioId,
    });
    revalidatePath("/operaciones");
    return { exito: true, pedidoId: pedido.id, avisoCorte: avisoCorte ?? null };
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : "Error al crear el pedido.";
    return { error: mensaje };
  }
}

// =============================================================================
// Abrir incidencia
// =============================================================================

export async function actionAbrirIncidencia(formData: FormData) {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) redirect("/login");

  if (!puedeGestionarIncidencias(sesion.usuario)) {
    return { error: "No tienes permiso para abrir incidencias." };
  }

  const pedidoId = formData.get("pedidoId") as string;
  const sellerId = formData.get("sellerId") as string;
  const tipo = formData.get("tipo") as TipoIncidencia;
  const descripcion = (formData.get("descripcion") as string) || undefined;

  if (!pedidoId || !sellerId || !tipo) {
    return { error: "Faltan datos requeridos." };
  }

  try {
    const cliente = crearClienteServiceRole();
    await abrirIncidencia(
      cliente,
      {
        tenantId: sesion.usuario.tenantId,
        pedidoId,
        sellerId,
        tipo,
        descripcion,
        abiertaPorUsuarioId: sesion.usuarioId,
        esAccionManual: true,
      },
      sesion.usuario,
    );
    revalidatePath(`/operaciones/${pedidoId}`);
    revalidatePath("/operaciones/incidencias");
    return { exito: true };
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : "Error al abrir la incidencia.";
    return { error: mensaje };
  }
}

// =============================================================================
// Reasignar pedido (devolver a pendiente_asignacion)
// =============================================================================

export async function actionReasignarPedido(formData: FormData) {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) redirect("/login");

  if (!puedeAsignarYReasignarPedidos(sesion.usuario)) {
    return { error: "No tienes permiso para reasignar pedidos." };
  }

  const pedidoId = formData.get("pedidoId") as string;
  const estadoEsperado = formData.get("estadoEsperado") as EstadoPedido;

  if (!pedidoId || !estadoEsperado) {
    return { error: "Faltan datos requeridos." };
  }

  try {
    const cliente = crearClienteServiceRole();
    await actualizarEstadoPedido(
      cliente,
      {
        pedidoId,
        tenantId: sesion.usuario.tenantId,
        estadoNuevo: "pendiente_asignacion",
        estadoEsperado,
        ejecutor: "interno",
        actuadoPorUsuarioId: sesion.usuarioId,
        motivo: "Reasignación solicitada por coordinador",
      },
      sesion.usuario,
    );
    revalidatePath(`/operaciones/${pedidoId}`);
    revalidatePath("/operaciones");
    return { exito: true };
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : "Error al reasignar el pedido.";
    return { error: mensaje };
  }
}
