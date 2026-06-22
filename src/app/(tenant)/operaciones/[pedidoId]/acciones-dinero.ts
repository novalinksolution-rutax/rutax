"use server";

/**
 * Server Actions de corrección manual del dinero de un pedido (B2).
 *
 * Permiten a dueño/administración anular la línea de cobro y/o de liquidación de
 * un pedido cuando el motor las generó por defecto (p. ej. un fallido cargado
 * conservadoramente) pero, revisado, no corresponden — sin depender del `tipo`
 * de la incidencia. El RBAC fino y las guardas de estado (período abierto /
 * liquidación en borrador) los impone la capa de dominio (`@/modules/dinero`).
 */

import { revalidatePath } from "next/cache";
import { exigirSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import {
  anularLineaCobroPedido,
  anularLineaLiquidacionPedido,
} from "@/modules/dinero/acciones";

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
