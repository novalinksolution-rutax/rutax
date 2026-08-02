/**
 * Lista de sellers del tenant para filtros/selectores — cacheada.
 * =====================================================================
 * La misma consulta (sellers del courier, ordenados) se repite en varias
 * pantallas (operaciones, incidencias, formulario same-day) y cambia poco: un
 * seller se agrega por invitación/conexión, no en el camino caliente.
 *
 * Se cachea con `unstable_cache` por `tenantId` (clave que aísla el caché entre
 * couriers). Seguridad: usa el cliente service-role (NO lee cookies/headers, así
 * que es válido dentro de unstable_cache) y el `tenant_id` va en la consulta.
 *
 * TTL corto (60s) → consistencia eventual SIN riesgo de "olvidé revalidar": un
 * seller nuevo aparece en los selectores en ≤1 min aunque nada invalide el
 * caché. Para frescura inmediata, una mutación de sellers puede llamar
 * `revalidateTag('sellers-<tenantId>')`.
 */

import { unstable_cache } from "next/cache";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";

export interface SellerFiltro {
  id: string;
  nombre: string;
}

/** Tag de revalidación de la lista de sellers de un tenant. */
export function tagSellers(tenantId: string): string {
  return `sellers-${tenantId}`;
}

async function consultarSellers(tenantId: string): Promise<SellerFiltro[]> {
  const cliente = crearClienteServiceRole();
  const { data } = await cliente
    .from("sellers")
    .select("id, razon_social")
    .eq("tenant_id", tenantId)
    .order("razon_social");

  return ((data ?? []) as Array<{ id: string; razon_social: string }>).map((s) => ({
    id: s.id,
    nombre: s.razon_social,
  }));
}

export function obtenerSellersDelTenant(tenantId: string): Promise<SellerFiltro[]> {
  return unstable_cache(() => consultarSellers(tenantId), ["sellers-filtro", tenantId], {
    revalidate: 60,
    tags: [tagSellers(tenantId)],
  })();
}
