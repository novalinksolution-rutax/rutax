"use server";

/**
 * Server Action · Cancelar un pedido same-day propio (seller, portal).
 *
 * Ventana del seller (docs/arquitectura/edicion-y-cancelacion-de-pedidos.md
 * §3.1): llega hasta `asignado` — nunca `en_ruta` (eso lo impone la máquina de
 * estados; esta acción no lo revalida, `cancelarPedido` lanza
 * `ErrorTransicionInvalida` si no corresponde).
 *
 * Patrón de dos clientes (§4.2/§7.3) — igual que la acción equivalente en
 * `(tenant)/operaciones`:
 *   1. El cliente de SESIÓN sirve SOLO para `obtenerPedido`, que decide la
 *      pertenencia. La política `pedidos_select` (P2) ya restringe lo que un
 *      seller autenticado puede leer a SUS PROPIOS pedidos — si el pedido es
 *      de otro seller (o de otro tenant), RLS devuelve `null` y esta acción
 *      responde "Pedido no encontrado", nunca "no autorizado" (no se filtra
 *      la existencia de recursos ajenos). Este cliente NUNCA se pasa a
 *      `cancelarPedido` ni a `registrarEnBitacora`.
 *   2. `crearClienteServiceRole()` recién después, para mutar y auditar, con
 *      `sellerId` como guarda atómica adicional en el WHERE.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { createClient } from "@/lib/supabase/server";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { obtenerPedido, cancelarPedido } from "@/modules/operacion/index";
import { puedeGestionarPedidosPropios } from "@/modules/identidad/capacidades";
import { preflightCancelacionPedido } from "@/modules/dinero/preflight-cancelacion";
import type { ItemPreflight } from "@/modules/dinero/preflight";

const MOTIVO_CANCELACION_MIN = 10;

export type ResultadoCancelarPedidoSeller =
  | { exito: true }
  | { error: string }
  | { requiereConfirmacion: true; advertencias: ItemPreflight[] };

export async function accionCancelarPedidoSeller(
  formData: FormData,
): Promise<ResultadoCancelarPedidoSeller> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) redirect("/login");
  if (sesion.usuario.tipoUsuario !== "seller" || !sesion.usuario.sellerId) {
    redirect("/portal");
  }
  const tenantId = sesion.usuario.tenantId;
  const sellerId = sesion.usuario.sellerId;

  // Gate RBAC: mismo gate que la acción equivalente muestra en la UI.
  if (!puedeGestionarPedidosPropios(sesion.usuario)) {
    return { error: "No tienes permiso para cancelar tus pedidos." };
  }

  const pedidoId = formData.get("pedidoId") as string | null;
  const motivo = ((formData.get("motivo") as string | null) ?? "").trim();
  const confirmado = formData.get("confirmado") === "true";

  if (!pedidoId) return { error: "Falta el pedido a cancelar." };
  if (motivo.length < MOTIVO_CANCELACION_MIN) {
    return { error: `El motivo debe tener al menos ${MOTIVO_CANCELACION_MIN} caracteres.` };
  }

  // Paso 1 — pertenencia con el cliente de la SESIÓN. RLS (P2) decide: un
  // pedido de otro seller nunca aparece, sin importar qué pedidoId se mande.
  const clienteSesion = await createClient();
  const pedido = await obtenerPedido(clienteSesion, pedidoId, tenantId);
  if (!pedido) return { error: "Pedido no encontrado." };

  // Paso 2 — preflight informativo de dinero (D-A3): nunca bloquea, solo avisa.
  const preflight = await preflightCancelacionPedido({ tenantId, pedidoId });
  if (!preflight.anulacionAutomatica && !confirmado) {
    return { requiereConfirmacion: true, advertencias: preflight.advertencias };
  }

  // Paso 3 — mutar y auditar SOLO con service_role, con sellerId como guarda
  // atómica adicional en el WHERE (§4.2) contra la carrera entre la lectura
  // anterior y esta escritura.
  try {
    const servicio = crearClienteServiceRole();
    await cancelarPedido(
      servicio,
      {
        pedidoId,
        tenantId,
        estadoEsperado: pedido.estado,
        ejecutor: "seller",
        actuadoPorUsuarioId: sesion.usuarioId,
        motivo,
        sellerId,
      },
      sesion.usuario,
    );
    revalidatePath(`/portal/pedidos/${pedidoId}`);
    revalidatePath("/portal/pedidos");
    return { exito: true };
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : "No se pudo cancelar el pedido.";
    return { error: mensaje };
  }
}
