/**
 * Consumo real del tenant frente a los límites de su plan (backstage
 * `plataforma`, pantalla "Mi plan" del courier).
 *
 * Distinto de `obtenerEntitlementsTenant` (superficie-courier.ts): esa función
 * resuelve los LÍMITES del plan (qué habilita), esta resuelve el USO real —
 * cuánto ha consumido el tenant este mes. La pantalla "Mi plan" combina ambas
 * para dibujar las barras de consumo.
 *
 * Replica el patrón de conteo de `src/modules/operacion/metricas.ts`
 * (`count: 'exact', head: true` filtrando siempre por `tenant_id`), pero con
 * `service_role` — el courier no puede filtrar esto vía RLS de sesión porque
 * `plataforma` (destino de esta consulta, vía Entitlements) es deny-all; para
 * mantener un único cliente/patrón en todo este módulo, esta función también
 * usa `service_role` incluso al leer `operacion`/`identidad` (mismo criterio
 * que ya aplica `obtenerMiPlan`/`obtenerEntitlementsTenant` en este módulo).
 *
 * Solo lectura. Sin datos personales — agregados de conteo.
 */

import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { ahoraEnSantiago } from "@/lib/fecha-santiago";

export interface ConsumoTenant {
  /** Pedidos creados en el mes calendario en curso (zona Santiago). */
  pedidosMes: number;
  /** Conductores con `estado='activo'`, independiente del mes. */
  conductoresActivos: number;
}

/**
 * Consumo del tenant en el mes calendario en curso. Aproximación consistente
 * con `obtenerResumenFinancieroDelMes` (metricas.ts): los límites de mes se
 * calculan sobre fechas 'YYYY-MM-DD' y se comparan contra `creado_en`
 * (timestamptz) usando medianoche UTC como borde — igual que el resto del
 * módulo de métricas, no es un requisito de precisión al segundo (el aviso de
 * consumo es informativo/blando, nunca gatilla bloqueos).
 */
export async function obtenerConsumoTenant(tenantId: string): Promise<ConsumoTenant> {
  const supabase = crearClienteServiceRole();

  const { fecha } = ahoraEnSantiago(); // 'YYYY-MM-DD' en hora local Santiago
  const [anioStr, mesStr] = fecha.split("-");
  const anio = Number(anioStr);
  const mes = Number(mesStr); // 1-12
  const primerDiaMes = `${anioStr}-${mesStr}-01`;
  const mesSiguiente = mes === 12 ? 1 : mes + 1;
  const anioSiguiente = mes === 12 ? anio + 1 : anio;
  const primerDiaMesSiguiente = `${anioSiguiente}-${String(mesSiguiente).padStart(2, "0")}-01`;

  const [pedidosRes, conductoresRes] = await Promise.all([
    supabase
      .schema("operacion")
      .from("pedidos")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .gte("creado_en", `${primerDiaMes}T00:00:00.000Z`)
      .lt("creado_en", `${primerDiaMesSiguiente}T00:00:00.000Z`),
    supabase
      .schema("identidad")
      .from("conductores")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("estado", "activo"),
  ]);

  if (pedidosRes.error) {
    throw new Error(`Error al contar pedidos del mes: ${pedidosRes.error.message}`);
  }
  if (conductoresRes.error) {
    throw new Error(`Error al contar conductores activos: ${conductoresRes.error.message}`);
  }

  return {
    pedidosMes: pedidosRes.count ?? 0,
    conductoresActivos: conductoresRes.count ?? 0,
  };
}
