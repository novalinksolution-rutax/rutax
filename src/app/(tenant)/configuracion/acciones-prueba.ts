"use server";

/**
 * Herramienta TEMPORAL de QA: crea pedidos same-day de prueba en bloque.
 * =============================================================================
 *
 * Existe para no tener que llenar el formulario de alta una y otra vez cuando se
 * necesita volumen de pedidos same-day para probar asignación, ruteo y el mapa
 * del conductor. NO es una funcionalidad de producto — vive detrás del mismo
 * gate que el alta real (`puedeAjustarOperacionDiaria`) y su panel está marcado
 * como herramienta de prueba.
 *
 * Reusa `crearPedidoSameDay` (el MISMO camino del alta real): tarifa vigente,
 * ventana de corte, bitácora, código interno y evento de geocodificación. Así
 * un pedido de prueba es indistinguible de uno real salvo por el nombre y la
 * dirección de relleno — que es justo lo que se quiere para probar de verdad.
 *
 * Se llama por TANDAS desde el cliente (mismo patrón que la conciliación en
 * lote): el contador «X de N» que ve quien la usa cuenta pedidos ya escritos en
 * base, no una estimación.
 */

import { exigirSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeAjustarOperacionDiaria } from "@/modules/identidad/capacidades";
import { crearPedidoSameDay } from "@/modules/operacion/pedidos";
import { COMUNAS_RM } from "@/lib/ui/comunas-rm";
import { revalidatePath } from "next/cache";

/** Tope por llamada: el cliente pide de a pocos para poder mostrar el avance. */
const TOPE_POR_TANDA = 5;

export type ResultadoPrueba =
  | { ok: true; creados: number }
  | { ok: false; creados: number; mensaje: string };

/**
 * Crea `cantidad` pedidos same-day de prueba (tope `TOPE_POR_TANDA`) para el
 * seller y la comuna dados. Devuelve cuántos alcanzó a crear: si el seller no
 * tiene tarifa same-day, `crearPedidoSameDay` lanza y se reporta con los que sí
 * se crearon (0 en la primera tanda).
 */
export async function actionCrearSameDayPrueba(
  sellerId: string,
  comuna: string,
  cantidad: number,
): Promise<ResultadoPrueba> {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) {
    return { ok: false, creados: 0, mensaje: "No hay sesión activa." };
  }
  if (!puedeAjustarOperacionDiaria(sesion.usuario)) {
    return { ok: false, creados: 0, mensaje: "No tienes permiso para crear pedidos same-day." };
  }

  if (!sellerId) {
    return { ok: false, creados: 0, mensaje: "Elige un seller." };
  }
  if (!COMUNAS_RM.includes(comuna as (typeof COMUNAS_RM)[number])) {
    return { ok: false, creados: 0, mensaje: "Comuna no válida." };
  }

  const n = Math.min(Math.max(1, Math.floor(cantidad)), TOPE_POR_TANDA);
  const tenantId = sesion.usuario.tenantId;
  const cliente = crearClienteServiceRole();

  let creados = 0;
  try {
    for (let i = 0; i < n; i++) {
      // Dirección de relleno plausible: un número de calle al azar dentro de la
      // comuna, para que el geocodificador la ubique dentro de ella y el pedido
      // sirva para probar el mapa. El nombre puede repetirse a propósito.
      const numero = 100 + Math.floor(Math.random() * 9800);
      await crearPedidoSameDay(cliente, {
        tenantId,
        sellerId,
        destinatarioNombre: `Prueba ${comuna} #${numero}`,
        destinatarioDireccion: `Avenida ${comuna} ${numero}`,
        destinatarioComuna: comuna,
        instruccionesEntrega: "Pedido de prueba generado desde Configuración.",
        actorUsuarioId: sesion.usuarioId,
      });
      creados++;
    }
  } catch (err) {
    return {
      ok: false,
      creados,
      mensaje: err instanceof Error ? err.message : "Error al crear el pedido de prueba.",
    };
  }

  if (creados > 0) revalidatePath("/operaciones");
  return { ok: true, creados };
}
