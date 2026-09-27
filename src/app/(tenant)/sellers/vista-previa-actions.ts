"use server";

/**
 * El lector de la ficha del seller para el panel lateral.
 *
 * Mismo cierre que el resto de las vistas previas: un id que no es UUID, una
 * sesión sin tenant o un seller de otro tenant responden igual, `{ ok: false }`.
 */

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { fechaLocalEnSantiago } from "@/lib/fecha-santiago";
import {
  puedeInvitarUsuarios,
  puedeSincronizarConexionesMl,
} from "@/modules/identidad/capacidades";
import { cargarFichaSeller, type FichaSeller } from "./_ficha/datos";

const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RespuestaFichaSeller = { ok: true; datos: FichaSeller } | { ok: false };

export async function accionVistaPreviaSeller(sellerId: string): Promise<RespuestaFichaSeller> {
  if (!REGEX_UUID.test(sellerId)) return { ok: false };

  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario?.tenantId) return { ok: false };
  if (sesion.usuario.tipoUsuario !== "interno") return { ok: false };

  try {
    const datos = await cargarFichaSeller(
      crearClienteServiceRole(),
      sesion.usuario.tenantId,
      sellerId,
      fechaLocalEnSantiago(new Date()),
      {
        puedeSincronizar: puedeSincronizarConexionesMl(sesion.usuario),
        puedeInvitar: puedeInvitarUsuarios(sesion.usuario),
      },
    );
    return datos ? { ok: true, datos } : { ok: false };
  } catch {
    return { ok: false };
  }
}
