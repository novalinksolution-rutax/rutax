"use server";

/**
 * Server Actions de corrección manual del dinero de un pedido (B2 + B1).
 *
 * B2: anular cobro/liquidación manualmente.
 * B1: reclasificar tipo de incidencia + re-disparar C1 automáticamente.
 */

import { revalidatePath } from "next/cache";
import { exigirSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import {
  anularLineaCobroPedido,
  anularLineaLiquidacionPedido,
} from "@/modules/dinero/acciones";
import { reclasificarIncidencia } from "@/modules/operacion/incidencias";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { inngest } from "@/lib/inngest/cliente";
import type { TipoIncidencia } from "@/modules/operacion/tipos";

export async function accionAnularCobroPedido(
  pedidoId: string,
  motivo: string,
): Promise<{ ok: boolean; mensaje?: string }> {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) return { ok: false, mensaje: "Sin sesión." };
  try {
    await anularLineaCobroPedido(
      sesion.usuario.tenantId,
      pedidoId,
      motivo,
      sesion.usuario,
      sesion.usuarioId,
    );
    revalidatePath(`/operaciones/${pedidoId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, mensaje: err instanceof Error ? err.message : "Error al anular el cobro." };
  }
}

export async function accionAnularLiquidacionPedido(
  pedidoId: string,
  motivo: string,
): Promise<{ ok: boolean; mensaje?: string }> {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) return { ok: false, mensaje: "Sin sesión." };
  try {
    await anularLineaLiquidacionPedido(
      sesion.usuario.tenantId,
      pedidoId,
      motivo,
      sesion.usuario,
      sesion.usuarioId,
    );
    revalidatePath(`/operaciones/${pedidoId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, mensaje: err instanceof Error ? err.message : "Error al anular la liquidación." };
  }
}

/**
 * B1: Reclasifica el tipo de una incidencia y re-dispara C1 para regenerar
 * las líneas de cobro/liquidación con los montos correctos.
 *
 * Flujo:
 * 1. `reclasificarIncidencia` actualiza la incidencia y anula las líneas mutables.
 * 2. Publicamos `dinero/pedido.estado_financiero_relevante` con el estado actual
 *    del pedido; C1 lo recibe y reactiva/crea las líneas nuevas.
 */
export async function accionReclasificarIncidencia(
  pedidoId: string,
  incidenciaId: string,
  nuevoTipo: TipoIncidencia,
): Promise<{ ok: boolean; mensaje?: string }> {
  const sesion = await exigirSesionActual();
  const tenantId = sesion.usuario.tenantId;
  if (!tenantId) return { ok: false, mensaje: "Sin sesión." };

  try {
    const supabase = crearClienteServiceRole();

    // Reclasificar y anular líneas mutables.
    await reclasificarIncidencia(
      supabase,
      { incidenciaId, tenantId, pedidoId, nuevoTipo, actorUsuarioId: sesion.usuarioId },
      sesion.usuario,
    );

    // Leer datos del pedido para armar el evento de re-disparo.
    const { data: pedido } = await supabase
      .schema("operacion")
      .from("pedidos")
      .select("estado, seller_id, tipo_pedido, tarifa_aplicable_id, actualizado_en")
      .eq("id", pedidoId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (!pedido) return { ok: false, mensaje: "Pedido no encontrado." };

    // Solo re-disparar C1 si el estado del pedido genera líneas.
    const estadosQueGeneranLineas = [
      "entregado", "entregado_manual", "fallido", "fallido_manual",
    ] as const;
    type EstadoFinanciero = (typeof estadosQueGeneranLineas)[number];
    const estadoFinanciero = estadosQueGeneranLineas.includes(pedido.estado as EstadoFinanciero)
      ? (pedido.estado as EstadoFinanciero)
      : null;

    if (estadoFinanciero) {
      // Leer driver_id de la asignación activa.
      const { data: asignacion } = await supabase
        .from("asignaciones_pedido")
        .select("driver_id")
        .eq("pedido_id", pedidoId)
        .eq("tenant_id", tenantId)
        .eq("activa", true)
        .maybeSingle();

      await inngest.send({
        name: "dinero/pedido.estado_financiero_relevante",
        data: {
          pedidoId,
          tenantId,
          sellerId: pedido.seller_id as string,
          driverIdAsignado: (asignacion?.driver_id as string | null) ?? null,
          estadoNuevo: estadoFinanciero,
          estadoAnterior: estadoFinanciero,
          fechaTransicion: pedido.actualizado_en as string,
          tipoPedido: pedido.tipo_pedido as "flex" | "same_day",
          tarifaAplicableId: (pedido.tarifa_aplicable_id as string | null) ?? null,
        },
      });
    }

    revalidatePath(`/operaciones/${pedidoId}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      mensaje: err instanceof Error ? err.message : "Error al reclasificar la incidencia.",
    };
  }
}
