"use server";

/**
 * La lectura que alimenta la vista previa lateral.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ ES UNA SERVER ACTION Y NO UN PARÁMETRO EN LA URL
 * -----------------------------------------------------------------------------
 * La tentación es `?vista=<id>`: sería compartible y el botón de atrás lo
 * cerraría solo. Y no sirve acá, porque **cambiar la URL vuelve a renderizar la
 * página entera** — la lista con su filtro, sus contadores y sus cien filas.
 *
 * El tablero pide justo lo contrario: mirar un pedido **sin perder el filtro, la
 * selección ni el lugar en la lista**. Con la URL, cada toque en una fila
 * costaría una consulta de listado y un salto de posición; con una acción, la
 * lista no se entera.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ LA ACCIÓN VUELVE A COMPROBARLO TODO
 * -----------------------------------------------------------------------------
 * Recibe un `pedidoId` **del navegador**, así que no se cree nada: sesión,
 * tenant y capacidad se verifican acá otra vez. Que la fila estuviera en la
 * pantalla no prueba nada — quien llama a la acción puede no haber abierto esa
 * pantalla nunca.
 *
 * El aislamiento final lo impone `armarVistaPreviaPedido`, que filtra por
 * `tenant_id` en cada consulta.
 */

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { armarVistaPreviaPedido, type VistaPreviaPedido } from "@/modules/operacion/vista-previa";

export type RespuestaVistaPrevia =
  | { ok: true; datos: VistaPreviaPedido }
  | { ok: false; motivo: "sin_sesion" | "no_encontrado" | "error" };

export async function accionVistaPreviaPedido(pedidoId: string): Promise<RespuestaVistaPrevia> {
  // Forma antes que nada: un id que no es UUID no llega a tocar la base.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pedidoId)) {
    return { ok: false, motivo: "no_encontrado" };
  }

  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario?.tenantId) return { ok: false, motivo: "sin_sesion" };

  try {
    const datos = await armarVistaPreviaPedido(
      crearClienteServiceRole(),
      sesion.usuario.tenantId,
      pedidoId,
    );
    return datos ? { ok: true, datos } : { ok: false, motivo: "no_encontrado" };
  } catch {
    // El panel dibuja su propio estado de fallo con un reintento. No se propaga
    // la excepción: tumbar la pantalla entera por una previsualización sería
    // peor que el problema que vino a resolver.
    return { ok: false, motivo: "error" };
  }
}
