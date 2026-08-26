"use server";

/**
 * La lectura que alimenta la vista previa lateral de la liquidación.
 *
 * Mismo razonamiento que la de períodos: es una Server Action y no un parámetro
 * en la URL porque **cambiar la URL vuelve a renderizar la página entera**, y lo
 * que este panel resuelve es mirar una fila sin perder el filtro ni el lugar en
 * la lista.
 *
 * ⚠️ Recibe un `liquidacionId` **del navegador**, así que no se cree nada:
 * sesión, tenant y capacidad se verifican acá otra vez, con el mismo gate de la
 * pantalla. El aislamiento final lo impone `armarVistaPreviaLiquidacion`, que
 * filtra por `tenant_id` en cada consulta.
 */

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeGestionarLiquidacionesConductores } from "@/modules/identidad/capacidades";
import {
  armarVistaPreviaLiquidacion,
  type VistaPreviaLiquidacion,
} from "@/modules/dinero/vista-previa-liquidacion";

const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RespuestaVistaPreviaLiquidacion =
  | { ok: true; datos: VistaPreviaLiquidacion }
  | { ok: false };

export async function accionVistaPreviaLiquidacion(
  liquidacionId: string,
): Promise<RespuestaVistaPreviaLiquidacion> {
  if (!REGEX_UUID.test(liquidacionId)) return { ok: false };

  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario?.tenantId) return { ok: false };
  if (!puedeGestionarLiquidacionesConductores(sesion.usuario)) return { ok: false };

  try {
    const datos = await armarVistaPreviaLiquidacion(
      crearClienteServiceRole(),
      sesion.usuario.tenantId,
      liquidacionId,
    );
    return datos ? { ok: true, datos } : { ok: false };
  } catch {
    return { ok: false };
  }
}
