/**
 * Monto por defecto que el courier le paga al conductor por CADA visita
 * cerrada a una bodega de seller — `identidad.courier_config_retiro`, 1:1 con
 * el tenant (migración `20260815000004`).
 *
 * Se lee desde DOS pantallas que no se conocen entre sí: Configuración →
 * Retiro (para editarlo) y Configuración → Bodegas (para mostrar el monto
 * EFECTIVO de cada bodega de seller, heredado o propio vía
 * `identidad.seller_bodegas.monto_visita_clp`). Vive en un solo lugar para no
 * duplicar la consulta ni, más importante, el significado del `null`: la
 * AUSENCIA de fila es "sin configurar" — nunca "cero" — ver el comentario de
 * la columna en la migración.
 *
 * Sin caché a propósito (a diferencia de `sellers.ts`): es una lectura de una
 * sola fila por PK, y el courier espera ver el cambio reflejado de inmediato
 * en Bodegas justo después de guardarlo en Retiro — son dos rutas distintas,
 * y cachear introduciría un desfase que no se paga con una consulta tan barata.
 */

import { crearClienteServiceRole } from "@/lib/supabase/service-role";

export async function obtenerMontoVisitaDefaultClp(tenantId: string): Promise<number | null> {
  const cliente = crearClienteServiceRole();
  const { data } = await cliente
    .schema("identidad")
    .from("courier_config_retiro")
    .select("monto_visita_bodega_clp")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  return data ? Number(data.monto_visita_bodega_clp) : null;
}
