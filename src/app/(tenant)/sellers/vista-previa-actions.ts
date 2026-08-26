"use server";

/**
 * La lectura que alimenta la vista previa lateral del seller.
 *
 * ⚠️ Recibe un `sellerId` **del navegador**, así que no se cree nada: sesión y
 * tenant se verifican acá otra vez.
 *
 * ⚠️ **Y exige `tipoUsuario === "interno"`, aunque la pantalla no lo haga.** La
 * pantalla no lo necesita porque `(tenant)` ya está fuera del alcance de un
 * seller; una Server Action, en cambio, se puede invocar desde cualquier sesión
 * autenticada que conozca su id. Sin este filtro, una sesión de seller podría
 * pedir la ficha comercial de OTRO seller del mismo courier — volumen, fallidos
 * y lo que se le está cobrando. Es la clase de fuga que no se ve en ninguna
 * pantalla.
 */

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { fechaLocalEnSantiago } from "@/lib/fecha-santiago";
import {
  armarVistaPreviaSellerCourier,
  type VistaPreviaSellerCourier,
} from "@/modules/identidad/vista-previa-seller-courier";

const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RespuestaVistaPreviaSeller =
  | { ok: true; datos: VistaPreviaSellerCourier }
  | { ok: false };

export async function accionVistaPreviaSeller(
  sellerId: string,
): Promise<RespuestaVistaPreviaSeller> {
  if (!REGEX_UUID.test(sellerId)) return { ok: false };

  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario?.tenantId) return { ok: false };
  if (sesion.usuario.tipoUsuario !== "interno") return { ok: false };

  try {
    const datos = await armarVistaPreviaSellerCourier(
      crearClienteServiceRole(),
      sesion.usuario.tenantId,
      sellerId,
      fechaLocalEnSantiago(new Date()),
    );
    return datos ? { ok: true, datos } : { ok: false };
  } catch {
    return { ok: false };
  }
}
