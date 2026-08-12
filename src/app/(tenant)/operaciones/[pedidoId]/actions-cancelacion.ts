"use server";

/**
 * Server Action · Cancelar un pedido same-day (rol interno).
 *
 * Patrón de dos clientes (docs/arquitectura/edicion-y-cancelacion-de-pedidos.md
 * §4.2 y §7.3) — por primera vez una acción de este módulo maneja el cliente de
 * la SESIÓN y el de `service_role` juntos:
 *   1. El cliente de SESIÓN sirve SOLO para `obtenerPedido`, que decide la
 *      pertenencia (RLS). Si el pedido no existe en el tenant, devuelve `null`
 *      y esta acción responde "Pedido no encontrado" — nunca se pasa este
 *      cliente a `cancelarPedido` ni a `registrarEnBitacora` (eso fue
 *      exactamente lo que rompió el alta de conductores en prod, commit
 *      `0164a56`).
 *   2. `crearClienteServiceRole()` recién después, para mutar y auditar.
 *
 * El preflight (`dinero`) es informativo y NUNCA bloquea (D-A1): si hay líneas
 * de dinero que no se van a anular solas, se le muestra la advertencia al
 * usuario y se exige una segunda confirmación explícita antes de ejecutar.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { createClient } from "@/lib/supabase/server";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { obtenerPedido, cancelarPedido } from "@/modules/operacion/index";
import { puedeAjustarOperacionDiaria } from "@/modules/identidad/capacidades";
import { preflightCancelacionPedido } from "@/modules/dinero/preflight-cancelacion";
import type { ItemPreflight } from "@/modules/dinero/preflight";

const MOTIVO_CANCELACION_MIN = 10;

export type ResultadoCancelarPedidoInterno =
  | { exito: true }
  | { error: string }
  | { requiereConfirmacion: true; advertencias: ItemPreflight[] };

export async function accionCancelarPedido(
  formData: FormData,
): Promise<ResultadoCancelarPedidoInterno> {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) redirect("/login");
  const tenantId = sesion.usuario.tenantId;

  // Gate RBAC: mismo gate que la acción equivalente muestra en la UI. Se
  // impone también aquí porque la Server Action es invocable directamente.
  if (!puedeAjustarOperacionDiaria(sesion.usuario)) {
    return { error: "No tienes permiso para cancelar pedidos." };
  }

  const pedidoId = formData.get("pedidoId") as string | null;
  const motivo = ((formData.get("motivo") as string | null) ?? "").trim();
  const confirmado = formData.get("confirmado") === "true";

  if (!pedidoId) return { error: "Falta el pedido a cancelar." };
  if (motivo.length < MOTIVO_CANCELACION_MIN) {
    return { error: `El motivo debe tener al menos ${MOTIVO_CANCELACION_MIN} caracteres.` };
  }

  // Paso 1 — pertenencia con el cliente de la SESIÓN. RLS decide (P1 tenant).
  const clienteSesion = await createClient();
  const pedido = await obtenerPedido(clienteSesion, pedidoId, tenantId);
  if (!pedido) return { error: "Pedido no encontrado." };

  // Paso 2 — preflight informativo de dinero (D-A3): nunca bloquea, solo avisa.
  const preflight = await preflightCancelacionPedido({ tenantId, pedidoId });
  if (!preflight.anulacionAutomatica && !confirmado) {
    return { requiereConfirmacion: true, advertencias: preflight.advertencias };
  }

  // Paso 3 — mutar y auditar SOLO con service_role.
  try {
    const servicio = crearClienteServiceRole();
    await cancelarPedido(
      servicio,
      {
        pedidoId,
        tenantId,
        estadoEsperado: pedido.estado,
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
    const mensaje = err instanceof Error ? err.message : "Error al cancelar el pedido.";
    return { error: mensaje };
  }
}
