"use server";

/**
 * La lectura que alimenta la vista previa lateral del período.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ ES UNA SERVER ACTION Y NO UN PARÁMETRO EN LA URL
 * -----------------------------------------------------------------------------
 * La tentación es `?vista=<id>`: sería compartible y el botón de atrás lo
 * cerraría solo. Y no sirve acá, porque **cambiar la URL vuelve a renderizar la
 * página entera** — la lista con su filtro, sus cajones y sus filas.
 *
 * Lo que el patrón pide es justo lo contrario: mirar un período **sin perder el
 * filtro ni el lugar en la lista**. Con la URL, cada toque en una fila costaría
 * una consulta de listado y un salto de posición; con una acción, la lista no se
 * entera.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ LA ACCIÓN VUELVE A COMPROBARLO TODO
 * -----------------------------------------------------------------------------
 * Recibe un `periodoId` **del navegador**, así que no se cree nada: sesión,
 * tenant y capacidad se verifican acá otra vez. Que la fila estuviera en la
 * pantalla no prueba nada — quien llama a la acción puede no haber abierto esa
 * pantalla nunca.
 *
 * El gate es el mismo de la pantalla (`puedeEmitirFacturas`), y el aislamiento
 * final lo impone `armarVistaPreviaPeriodo`, que filtra por `tenant_id` en cada
 * consulta.
 */

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeEmitirFacturas } from "@/modules/identidad/capacidades";
import {
  armarVistaPreviaPeriodo,
  type VistaPreviaPeriodo,
} from "@/modules/dinero/vista-previa-periodo";

const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RespuestaVistaPreviaPeriodo =
  | { ok: true; datos: VistaPreviaPeriodo }
  | { ok: false };

export async function accionVistaPreviaPeriodo(
  periodoId: string,
): Promise<RespuestaVistaPreviaPeriodo> {
  // Forma antes que nada: un id que no es UUID no llega a tocar la base.
  if (!REGEX_UUID.test(periodoId)) return { ok: false };

  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario?.tenantId) return { ok: false };
  if (!puedeEmitirFacturas(sesion.usuario)) return { ok: false };

  try {
    const datos = await armarVistaPreviaPeriodo(
      crearClienteServiceRole(),
      sesion.usuario.tenantId,
      periodoId,
    );
    return datos ? { ok: true, datos } : { ok: false };
  } catch {
    // El panel dibuja su propio estado de fallo. No se propaga la excepción:
    // tumbar la pantalla entera por una previsualización sería peor que el
    // problema que vino a resolver.
    return { ok: false };
  }
}
