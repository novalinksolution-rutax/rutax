/**
 * Cierre de las tarifas legadas del tenant (decisión del usuario, 2026-09-29).
 *
 * Cuando un courier guarda tarifas en el modelo nuevo, sus tarifas por régimen
 * (`tipo_entrega` flex | same_day, sin seller) dejan de regir: si no, la
 * precedencia de `identidad.resolver_tarifa` (seller > fuente > régimen legado >
 * general) las prefiere a la tarifa por zona y las zonas no tendrían efecto.
 * La regla vive UNA vez, en SQL: `identidad.cerrar_tarifas_legadas_del_tenant`
 * (migración 20260928000004). Acá solo está el orden que exige el proyecto:
 * bitácora con autor ANTES del efecto.
 *
 * Los ids que se registran son las CANDIDATAS (lo que el cierre podría tocar); la
 * función decide al cerrar si hay general y qué cierra de verdad. Sobre-registrar
 * es el error correcto: la auditoría nunca queda corta.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarEnBitacora } from "./auditoria";

export const ACCION_LEGADAS_CERRADAS = "tarifa.legadas_cerradas";

type Cliente = Pick<SupabaseClient, "schema">;

export type ResultadoCierreLegadas = {
  hayGeneral: boolean;
  cerradas: string[];
  inactivadas: string[];
};

/**
 * Registra en bitácora las legadas candidatas. Devuelve sus ids (vacío = nada
 * que registrar). Lanza si la lectura o la bitácora fallan: el llamador no debe
 * seguir al efecto sin auditoría.
 */
export async function registrarLegadasPorCerrar(
  servicio: SupabaseClient,
  p: { tenantId: string; actorUsuarioId: string; hoy: string },
): Promise<string[]> {
  const { data, error } = await (servicio as Cliente)
    .schema("identidad")
    .rpc("tarifas_legadas_del_tenant", { p_tenant: p.tenantId, p_hoy: p.hoy });
  if (error) throw new Error(`No se pudieron leer las tarifas antiguas: ${error.message}`);
  const ids = (Array.isArray(data) ? data : []).filter((x): x is string => typeof x === "string");
  if (ids.length === 0) return [];

  await registrarEnBitacora(servicio, {
    tenantId: p.tenantId,
    actorUsuarioId: p.actorUsuarioId,
    actorTipo: "usuario",
    accion: ACCION_LEGADAS_CERRADAS,
    entidadTipo: "tenant",
    entidadId: p.tenantId,
    detalle: { tarifa_ids: ids, vigente_hasta_base: p.hoy, condicion: "solo_si_hay_tarifa_general" },
  });
  return ids;
}

/** Bitácora previa + cierre. Para quien no pasa por el guardado del paso 4. */
export async function cerrarTarifasLegadasDelTenant(
  servicio: SupabaseClient,
  p: { tenantId: string; actorUsuarioId: string; hoy: string },
): Promise<ResultadoCierreLegadas> {
  const ids = await registrarLegadasPorCerrar(servicio, p);
  if (ids.length === 0) return { hayGeneral: false, cerradas: [], inactivadas: [] };

  const { data, error } = await (servicio as Cliente)
    .schema("identidad")
    .rpc("cerrar_tarifas_legadas_del_tenant", { p_tenant: p.tenantId, p_hoy: p.hoy });
  if (error) throw new Error(`No se pudieron cerrar las tarifas antiguas: ${error.message}`);
  const r = (data ?? {}) as { hay_general?: boolean; cerradas?: string[]; inactivadas?: string[] };
  return {
    hayGeneral: r.hay_general === true,
    cerradas: r.cerradas ?? [],
    inactivadas: r.inactivadas ?? [],
  };
}
