import "server-only";

/**
 * El estado del seller para el formulario de alta: su hora de corte.
 * =============================================================================
 * Lo necesitan TRES sitios —el listado, el inicio y la página `nuevo`— porque
 * los tres pueden abrir el mismo formulario. Vive acá para que el aviso de corte
 * salga igual en los tres; calculado por separado, tarde o temprano uno queda
 * mostrando una hora vieja y nadie lo nota.
 *
 * ⚠️ **NO es un archivo `"use server"`.** Es un ayudante de servidor, no una
 * acción: en un `"use server"` cada export se vuelve un endpoint alcanzable, y
 * esto no tiene por qué serlo. `server-only` lo deja explícito y falla el build
 * si alguien lo importa desde el cliente.
 *
 * Se evalúa **sin zona** (`zonaId: null`) a propósito: la zona depende de la
 * comuna, que todavía no se escribió. La ventana por defecto del seller es la
 * que aplica salvo override por zona, y avisar con la general es mejor que no
 * avisar.
 */

import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { evaluarVentanaCorte } from "@/modules/operacion/ventanas-corte";
import type { EstadoSellerParaAlta } from "@/app/(tenant)/operaciones/nuevo/actions";

export async function obtenerEstadoAltaSeller(
  tenantId: string,
  sellerId: string,
): Promise<EstadoSellerParaAlta> {
  const evaluacion = await evaluarVentanaCorte(crearClienteServiceRole(), {
    tenantId,
    sellerId,
    zonaId: null,
    tipoEntrega: "same_day",
  }).catch(() => null);

  return {
    horaCorte: evaluacion?.ventana?.horaCorte ?? null,
    /**
     * Siempre `true`, y no es un dato falso escondido: el formulario compartido
     * usa este campo **solo** para pintarle al COURIER el aviso de «este seller
     * no tiene tarifa vigente». Es un hueco de configuración que el seller no
     * puede arreglar, y decírselo solo le genera una llamada a su courier.
     */
    tieneTarifa: true,
  };
}
