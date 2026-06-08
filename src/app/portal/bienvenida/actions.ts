"use server";

/**
 * Server Actions — Pantalla L (bienvenida del seller, §3.2).
 *
 * Solo lectura: resuelve el nombre del courier (`tenants.nombre_fantasia`) y
 * la razón social del propio seller para personalizar el saludo ("[courier]
 * te invitó a su portal de despachos"). Cliente con sesión de usuario — RLS
 * (P1 + P2) ya garantiza que el seller solo ve su propia fila de `sellers` y
 * el `tenants` de su propio courier (`tenants_select_propio`,
 * `sellers_select` — ver migraciones 0001/0002).
 */

import { createClient } from "@/lib/supabase/server";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";

export interface DatosBienvenidaSeller {
  nombreCourier: string;
  razonSocialSeller: string;
}

export type ResultadoBienvenida =
  | { ok: true; datos: DatosBienvenidaSeller }
  | { ok: false; mensaje: string };

export async function obtenerDatosBienvenida(): Promise<ResultadoBienvenida> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId || sesion.usuario.tipoUsuario !== "seller" || !sesion.usuario.sellerId) {
    return { ok: false, mensaje: "No hay una sesión de seller activa." };
  }

  const supabase = await createClient();
  const [{ data: tenant, error: errorTenant }, { data: seller, error: errorSeller }] = await Promise.all([
    supabase.from("tenants").select("nombre_fantasia").eq("id", sesion.usuario.tenantId).maybeSingle(),
    supabase.from("sellers").select("razon_social").eq("id", sesion.usuario.sellerId).maybeSingle(),
  ]);

  if (errorTenant || errorSeller || !tenant || !seller) {
    return { ok: false, mensaje: "No pudimos cargar tu información por un problema de nuestro sistema." };
  }

  return {
    ok: true,
    datos: {
      nombreCourier: tenant.nombre_fantasia as string,
      razonSocialSeller: seller.razon_social as string,
    },
  };
}
