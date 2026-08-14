"use server";

/**
 * Server Action de la asignación en bloque (etapa 6,
 * docs/ux/etapa-6-asignacion-en-bloque.md §7). Escribe llamando a
 * `operacion.asignar_pedidos_en_bloque` a través de
 * `asignarPedidosEnBloqueRpc` (src/modules/operacion/asignacion-rpc.ts) — este
 * archivo NO contiene lógica de negocio propia, solo: sesión, gate RBAC,
 * cliente `service_role`, la fecha operativa y la revalidación de rutas.
 *
 * `tenantId` y `actorUsuarioId` salen SIEMPRE de la sesión validada
 * (`exigirSesionActual`), nunca de lo que mande el cliente — igual que el
 * resto de las Server Actions de este módulo (molde: `../../manifiestos/actions.ts`).
 *
 * =============================================================================
 * POR QUÉ ESTA ACCIÓN NO ESCRIBE BITÁCORA
 * =============================================================================
 * Se aparta a propósito del patrón general de CLAUDE.md ("bitácora antes que
 * efectos externos"). El asiento lo escribe `operacion.asignar_pedidos_en_bloque`
 * DENTRO de su propia transacción, al final (migración
 * `20260814000001_operacion_asignacion_en_bloque.sql` §1, paso (9) — lee su
 * comentario completo antes de "corregir" esto):
 *
 *   - Escribirlo aquí ANTES de llamar al RPC dejaría un asiento describiendo
 *     una asignación que puede no haber ocurrido (la función puede lanzar por
 *     conductor ajeno, lote vacío, etc.) — un rastro de auditoría que miente.
 *   - Escribirlo aquí DESPUÉS duplicaría la auditoría: ya existe un asiento
 *     por lote, con su `actorUsuarioId`, escrito dentro de la misma
 *     transacción que aplicó el cambio.
 *
 * La atomicidad de la función SQL da una garantía más fuerte que el orden:
 * si algo falla, se deshace TODO (incluida la bitácora), así que no hay
 * ventana en la que un efecto haya ocurrido sin su asiento.
 *
 * =============================================================================
 * LA FECHA ES SIEMPRE EL DÍA OPERATIVO DE SANTIAGO, CALCULADA AQUÍ
 * =============================================================================
 * Nunca se recibe del cliente: la base corre en UTC, y si el día se calculara
 * dentro de la función SQL con `current_date`, a partir de las 21:00 de
 * Santiago el día operativo se adelantaría y la asignación de la tarde
 * crearía el manifiesto de MAÑANA (mismo razonamiento que la cabecera de la
 * migración, handoff a `backend`).
 */

import { revalidatePath } from "next/cache";
import { exigirSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeAsignarYReasignarPedidos } from "@/modules/identidad/capacidades";
import { fechaLocalEnSantiago } from "@/lib/fecha-santiago";
import {
  asignarPedidosEnBloqueRpc,
  type ResultadoAsignacionEnBloque,
} from "@/modules/operacion/asignacion-rpc";

// =============================================================================
// Tipos de respuesta — mismo molde que manifiestos/actions.ts (actionMarcarConductorNoDisponible)
// =============================================================================

type RespuestaOk<T> = { ok: true; datos: T };
type RespuestaError = { ok: false; mensaje: string };
type Respuesta<T> = RespuestaOk<T> | RespuestaError;

// =============================================================================
// actionAsignarPedidosEnBloque
// =============================================================================

/**
 * Asigna (o reasigna) `pedidoIds` a `conductorId`, en el manifiesto del día
 * operativo de Santiago. Devuelve el resultado íntegro del RPC (incluido el
 * desglose de omitidos con motivo) para que la pantalla pueda armar el toast
 * de éxito o el diálogo de resultado parcial descritos en §7.5 del diseño —
 * nunca un booleano suelto que obligaría a volver a consultar.
 */
export async function actionAsignarPedidosEnBloque(
  conductorId: string,
  pedidoIds: string[],
): Promise<Respuesta<ResultadoAsignacionEnBloque>> {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) {
    return { ok: false, mensaje: "No hay sesión activa." };
  }

  if (!puedeAsignarYReasignarPedidos(sesion.usuario)) {
    return { ok: false, mensaje: "No tienes permiso para asignar pedidos." };
  }

  if (!conductorId) {
    return { ok: false, mensaje: "Debes elegir un conductor." };
  }
  if (!Array.isArray(pedidoIds) || pedidoIds.length === 0) {
    return { ok: false, mensaje: "Debes seleccionar al menos un pedido." };
  }

  try {
    const cliente = crearClienteServiceRole();
    const resultado = await asignarPedidosEnBloqueRpc(cliente, {
      tenantId: sesion.usuario.tenantId,
      conductorId,
      fecha: fechaLocalEnSantiago(new Date()),
      pedidoIds,
      actorUsuarioId: sesion.usuarioId,
    });

    // La bandeja de asignación y el bloque de /preparacion leen cifras en
    // vivo; el manifiesto (nuevo o reutilizado) también cambió.
    revalidatePath("/preparacion/asignar");
    revalidatePath("/preparacion");
    revalidatePath("/manifiestos");
    revalidatePath(`/manifiestos/${resultado.manifiestoId}`);

    return { ok: true, datos: resultado };
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : "Error al asignar los pedidos.";
    return { ok: false, mensaje };
  }
}
