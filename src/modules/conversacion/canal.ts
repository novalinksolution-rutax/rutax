/**
 * Interruptor del canal de consulta por WhatsApp — migración
 * `20260920000002_integraciones_whatsapp_canal_consulta_config.sql`.
 * =============================================================================
 * La feature de consulta ya está desplegada respondiendo con copy provisional;
 * el interruptor la apaga a nivel de courier hasta que el copy pase por
 * `copywriter`. Ver el encabezado de la migración: el canal NACE APAGADO y
 * la ausencia de fila EQUIVALE a apagado.
 *
 * ⚠️ La lectura es SIEMPRE por la función `whatsapp_canal_consulta_config`,
 * nunca un `select` crudo a la tabla: un `select ... where tenant_id = ?`
 * sobre un tenant sin fila devuelve CERO FILAS, no `false`, y esa es
 * exactamente la trampa que la migración documenta. La función RPC falla
 * cerrado y siempre devuelve una fila.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface ConfigCanalConsulta {
  /** Interruptor. `false` cuando el courier no tiene fila (nace apagado). */
  canalActivo: boolean;
  /** Tope de consultas por contacto y por hora (§9). Reemplaza la constante vieja. */
  topeConsultasHora: number;
  /** Corte por barrido (§6.1): intentos `flex_manual` sin match en una hora. */
  topeIntentosSinMatchHora: number;
  /** `true` solo si el courier tiene fila propia en la tabla. */
  configurado: boolean;
}

interface FilaRpc {
  canal_activo: boolean;
  tope_consultas_hora: number;
  tope_intentos_sin_match_hora: number;
  configurado: boolean;
}

/**
 * Lee la configuración del canal de consulta para un courier. SIEMPRE
 * devuelve un valor (nunca `null`): sin fila, `canalActivo: false` y los
 * topes por defecto (20 / 5), igual que la función SQL.
 */
export async function leerConfigCanalConsulta(
  cliente: SupabaseClient,
  tenantId: string,
): Promise<ConfigCanalConsulta> {
  const { data, error } = await cliente
    .rpc("whatsapp_canal_consulta_config", { p_tenant_id: tenantId })
    .single<FilaRpc>();

  if (error) {
    throw new Error(`No se pudo leer la configuración del canal de WhatsApp: ${error.message}`);
  }
  if (!data) {
    throw new Error("whatsapp_canal_consulta_config no devolvió fila — no debería ocurrir nunca.");
  }

  return {
    canalActivo: data.canal_activo,
    topeConsultasHora: data.tope_consultas_hora,
    topeIntentosSinMatchHora: data.tope_intentos_sin_match_hora,
    configurado: data.configurado,
  };
}
