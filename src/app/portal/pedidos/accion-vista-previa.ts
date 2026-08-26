"use server";

/**
 * La vista previa de un pedido, pedida desde el panel del seller.
 *
 * ⚠️ El `sellerId` sale de la SESIÓN y se le pasa al armador, que además
 * comprueba que el pedido sea de ese seller. Dos barreras para lo mismo, a
 * propósito: la de acá es la que impide que un id ajeno llegue siquiera a
 * consultarse, y la del armador es la que sobrevive si mañana alguien llama al
 * armador desde otro sitio.
 */

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  armarVistaPreviaSeller,
  type VistaPreviaSeller,
} from "@/modules/operacion/vista-previa-seller";

export type RespuestaVistaPreviaSeller =
  | { ok: true; datos: VistaPreviaSeller }
  | { ok: false; motivo: "sin_sesion" | "no_encontrado" | "error" };

export async function accionVistaPreviaSeller(
  pedidoId: string,
): Promise<RespuestaVistaPreviaSeller> {
  // Forma antes que nada: un id que no es UUID no llega a tocar la base.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pedidoId)) {
    return { ok: false, motivo: "no_encontrado" };
  }

  const sesion = await obtenerSesionActual();
  if (
    !sesion?.usuario?.tenantId ||
    sesion.usuario.tipoUsuario !== "seller" ||
    !sesion.usuario.sellerId
  ) {
    return { ok: false, motivo: "sin_sesion" };
  }

  try {
    const datos = await armarVistaPreviaSeller(
      crearClienteServiceRole(),
      sesion.usuario.tenantId,
      sesion.usuario.sellerId,
      pedidoId,
    );
    return datos ? { ok: true, datos } : { ok: false, motivo: "no_encontrado" };
  } catch {
    // El panel dibuja su propio estado de fallo. No se propaga: tumbar la lista
    // entera por una previsualización sería peor que el problema.
    return { ok: false, motivo: "error" };
  }
}
