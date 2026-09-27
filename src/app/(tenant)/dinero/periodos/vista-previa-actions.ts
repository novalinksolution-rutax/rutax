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
import { puedeEmitirFacturas, puedeVerPeriodosCobro } from "@/modules/identidad/capacidades";
import { cargarFichaPeriodo, type FichaPeriodo } from "./_ficha/datos";

const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RespuestaVistaPreviaPeriodo =
  | { ok: true; datos: FichaPeriodo }
  | { ok: false };

export async function accionVistaPreviaPeriodo(
  periodoId: string,
): Promise<RespuestaVistaPreviaPeriodo> {
  // Forma antes que nada: un id que no es UUID no llega a tocar la base.
  if (!REGEX_UUID.test(periodoId)) return { ok: false };

  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario?.tenantId) return { ok: false };
  // El gate de la PANTALLA (ver): la ficha reemplaza a la página de detalle,
  // que ya se abría con esta capacidad. Las acciones de dinero piden además
  // `emitir_facturas`, y el dominio lo vuelve a validar al ejecutarlas.
  if (!puedeVerPeriodosCobro(sesion.usuario)) return { ok: false };

  try {
    const datos = await cargarFichaPeriodo(crearClienteServiceRole(), sesion.usuario.tenantId, periodoId, {
      puedeEmitir: puedeEmitirFacturas(sesion.usuario),
      autorNombre: sesion.nombreCompleto ?? "Tu cuenta",
    });
    return datos ? { ok: true, datos } : { ok: false };
  } catch {
    // El panel dibuja su propio estado de fallo. No se propaga la excepción:
    // tumbar la pantalla entera por una previsualización sería peor que el
    // problema que vino a resolver.
    return { ok: false };
  }
}
