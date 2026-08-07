/**
 * Lista de conductores del tenant para filtros/selectores — cacheada.
 * =====================================================================
 * Hermana de `sellers.ts`, con el mismo patrón y por la misma razón: la lista
 * cambia poco (un conductor se da de alta en el onboarding, no en el camino
 * caliente) y la piden varias pantallas.
 *
 * Nace con el filtro por conductor de `/operaciones`, que a su vez existe para
 * los enlaces profundos de la Torre de control: la Torre no ejecuta, solo
 * enlaza, así que «Pérez · 12 de 40» tiene que llegar a la lista de pedidos con
 * el filtro puesto.
 *
 * **Se traen también los `inactivo`.** Un conductor dado de baja hoy puede tener
 * paradas del día todavía en la calle, y filtrar por él es justamente lo que
 * hace falta para saber qué quedó suyo. Es la misma corrección que se hizo en el
 * composer de la Torre por el «Conductor sin nombre».
 *
 * Seguridad: cliente service-role (no lee cookies ni headers, así que es válido
 * dentro de `unstable_cache`) y el `tenant_id` va SIEMPRE en la consulta.
 */

import { unstable_cache } from "next/cache";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";

export interface ConductorFiltro {
  id: string;
  nombre: string;
}

/** Tag de revalidación de la lista de conductores de un tenant. */
export function tagConductores(tenantId: string): string {
  return `conductores-${tenantId}`;
}

async function consultarConductores(tenantId: string): Promise<ConductorFiltro[]> {
  const cliente = crearClienteServiceRole();
  const { data } = await cliente
    .schema("identidad")
    .from("conductores")
    .select("id, nombre_completo")
    .eq("tenant_id", tenantId)
    .order("nombre_completo");

  return ((data ?? []) as Array<{ id: string; nombre_completo: string }>).map((c) => ({
    id: c.id,
    nombre: c.nombre_completo,
  }));
}

export function obtenerConductoresDelTenant(tenantId: string): Promise<ConductorFiltro[]> {
  return unstable_cache(
    () => consultarConductores(tenantId),
    ["conductores-filtro", tenantId],
    { revalidate: 60, tags: [tagConductores(tenantId)] },
  )();
}
