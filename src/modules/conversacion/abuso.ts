/**
 * Tope de abuso y corte por barrido — §6.1 y §9 del documento de alcance.
 * =============================================================================
 * Se cuenta SOBRE `integraciones.whatsapp_mensajes_entrantes`, no sobre una
 * tabla de contadores nueva (§4 lo prohíbe para la v1) ni sobre
 * `infra.rate_limit_contadores` (ese es una ventana UNLOGGED que se borra
 * sola: sirve para frenar, no para auditar; acá la pregunta que hay que poder
 * responder seis meses después es «¿este número estuvo barriendo códigos?»).
 * Los índices que resuelven estas dos consultas ya existen en la migración
 * `20260920000001` (`idx_whatsapp_entrantes_contacto_hora`,
 * `idx_whatsapp_entrantes_sondeo_numerico`).
 *
 * ⚠️ Los topes YA NO son constantes acá: viven en
 * `integraciones.whatsapp_canal_consulta_config` (migración `20260920000002`)
 * y el llamador (`jobs/responder-mensaje.ts`) los lee una vez por mensaje con
 * `leerConfigCanalConsulta` y los pasa por parámetro. Dos fuentes para el
 * mismo número es la trampa que ya mordió con el tope de cuentas ML.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

const UNA_HORA_MS = 60 * 60 * 1000;

/** ¿Este contacto ya superó `topeConsultasHora` en la última hora? */
export async function excedeTopeDeAbuso(
  cliente: SupabaseClient,
  contactoId: string,
  topeConsultasHora: number,
  ahora: Date = new Date(),
): Promise<boolean> {
  const desde = new Date(ahora.getTime() - UNA_HORA_MS);

  const { count, error } = await cliente
    .schema("integraciones")
    .from("whatsapp_mensajes_entrantes")
    .select("id", { count: "exact", head: true })
    .eq("contacto_id", contactoId)
    .gte("recibido_en", desde.toISOString());

  if (error) {
    throw new Error(`No se pudo contar los mensajes entrantes de WhatsApp: ${error.message}`);
  }
  return (count ?? 0) >= topeConsultasHora;
}

/**
 * ¿Este contacto está barriendo códigos? `topeIntentosSinMatchHora`
 * `flex_manual` SIN match en la última hora, contados aparte del tope
 * general (§6.1).
 */
export async function detectaBarridoDeCodigos(
  cliente: SupabaseClient,
  contactoId: string,
  topeIntentosSinMatchHora: number,
  ahora: Date = new Date(),
): Promise<boolean> {
  const desde = new Date(ahora.getTime() - UNA_HORA_MS);

  const { count, error } = await cliente
    .schema("integraciones")
    .from("whatsapp_mensajes_entrantes")
    .select("id", { count: "exact", head: true })
    .eq("contacto_id", contactoId)
    .eq("clasificacion", "flex_manual")
    .eq("hubo_match", false)
    .gte("recibido_en", desde.toISOString());

  if (error) {
    throw new Error(`No se pudo contar el sondeo de códigos de WhatsApp: ${error.message}`);
  }
  return (count ?? 0) >= topeIntentosSinMatchHora;
}
