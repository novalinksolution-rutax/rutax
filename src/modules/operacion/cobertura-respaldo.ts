/**
 * Comunas que hoy se cobran por la zona de respaldo.
 * =============================================================================
 * Decisión del usuario (2026-09-28, Q6): una comuna sin zona **se cobra como
 * Periferia y se avisa**. Nunca una entrega sin cobrar. `resolver_tarifa_por_comuna`
 * hace lo primero y devuelve `zona_por_respaldo = true`; esto es lo segundo.
 *
 * ⚠️ NO persiste nada, a propósito. La alternativa era un tipo nuevo en
 * `eventos_conciliacion` (un CHECK de lista que hay que reponer entero, ver
 * CLAUDE.md) o una tabla de avisos: infraestructura para un hecho que se puede
 * RECALCULAR en cada lectura y que se resuelve solo cuando el courier mapea la
 * comuna. Un aviso persistido habría que apagarlo a mano; uno derivado desaparece
 * cuando deja de ser cierto. El rastro histórico ya queda en la línea de dinero:
 * `snapshot_regla.zona.por_respaldo` (v2).
 *
 * Mismo criterio de zona que la función SQL: la comuna cuenta como mapeada solo
 * si su zona está ACTIVA; una comuna fuera del catálogo canónico cae al respaldo.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { leerTodasLasFilas } from "@/lib/supabase/leer-paginado";
import { resolverComunaCanonica } from "@/modules/integraciones/geocoding/normalizacion";

export interface ComunaEnRespaldo {
  /** Como viene en el pedido (lo que el courier reconoce), no la canónica. */
  comuna: string;
  pedidos: number;
}

export interface CoberturaPorRespaldo {
  zonaRespaldoNombre: string;
  comunas: ComunaEnRespaldo[];
  totalPedidos: number;
}

const SIN_COMUNA = "Sin comuna";

/**
 * Pedidos aún por entregar de la fecha, agrupados por comuna, cuya comuna no está
 * mapeada a una zona activa y por eso se cobrarán como la zona de respaldo.
 * `null` si no hay nada que avisar (incluye: el tenant no tiene zona de respaldo,
 * en cuyo caso la resolución cae a la tarifa sin zona y no hay «cobro distinto»).
 */
export async function obtenerCoberturaPorRespaldo(
  cliente: SupabaseClient,
  entrada: { tenantId: string; fecha: string },
): Promise<CoberturaPorRespaldo | null> {
  const { data: respaldo, error: errRespaldo } = await cliente
    .schema("identidad")
    .from("zonas")
    .select("id, nombre")
    .eq("tenant_id", entrada.tenantId)
    .eq("es_respaldo", true)
    .eq("activa", true)
    .maybeSingle();
  if (errRespaldo) throw new Error(`Error al leer la zona de respaldo: ${errRespaldo.message}`);
  if (!respaldo) return null;

  const [zonasActivas, mapeos, pedidos] = await Promise.all([
    leerTodasLasFilas<{ id: string }>("zonas activas", (d, h) =>
      cliente.schema("identidad").from("zonas").select("id")
        .eq("tenant_id", entrada.tenantId).eq("activa", true).range(d, h),
    ),
    leerTodasLasFilas<{ zona_id: string; comuna: string }>("comunas mapeadas", (d, h) =>
      cliente.schema("identidad").from("zona_comunas").select("zona_id, comuna")
        .eq("tenant_id", entrada.tenantId).range(d, h),
    ),
    leerTodasLasFilas<{ destinatario_comuna: string | null }>("pedidos por entregar", (d, h) =>
      cliente.schema("operacion").from("pedidos").select("destinatario_comuna")
        .eq("tenant_id", entrada.tenantId)
        .eq("fecha_compromiso", entrada.fecha)
        .in("estado", ["pendiente_asignacion", "asignado", "en_ruta"])
        .range(d, h),
    ),
  ]);

  const activas = new Set(zonasActivas.map((z) => z.id));
  const mapeadas = new Set(mapeos.filter((m) => activas.has(m.zona_id)).map((m) => m.comuna));

  const porComuna = new Map<string, number>();
  for (const p of pedidos) {
    const declarada = p.destinatario_comuna?.trim() || null;
    const canonica = declarada ? resolverComunaCanonica(declarada) : null;
    if (canonica && mapeadas.has(canonica)) continue;
    const etiqueta = canonica ?? declarada ?? SIN_COMUNA;
    porComuna.set(etiqueta, (porComuna.get(etiqueta) ?? 0) + 1);
  }
  if (porComuna.size === 0) return null;

  const comunas = [...porComuna]
    .map(([comuna, n]) => ({ comuna, pedidos: n }))
    .sort((a, b) => b.pedidos - a.pedidos || a.comuna.localeCompare(b.comuna, "es"));

  return {
    zonaRespaldoNombre: respaldo.nombre as string,
    comunas,
    totalPedidos: comunas.reduce((s, c) => s + c.pedidos, 0),
  };
}
