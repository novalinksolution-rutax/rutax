/**
 * Rate limiting de endpoints públicos — contador de ventana fija en Postgres.
 * =============================================================================
 *
 * Infraestructura transversal (como `src/lib/inngest/`): la consumen los
 * webhooks públicos (`api/webhooks/ml/*`, `api/webhooks/fintoc/*`). NO vive en
 * `integraciones` porque no es un adaptador de servicio externo.
 *
 * Mecánica: una sola llamada RPC por request a `public.rate_limit_consumir`
 * (migración 20260612000001), que hace upsert-increment atómico sobre la tabla
 * UNLOGGED `infra.rate_limit_contadores` y devuelve el contador de la ventana
 * actual. La función solo es ejecutable por `service_role`.
 *
 * FAIL-OPEN (decisión A4 del arquitecto): si la RPC falla por cualquier razón
 * (Postgres caído, timeout, error inesperado), el helper devuelve
 * `permitido: true` y loguea un warning. Criterio: el limitador es defensa en
 * profundidad contra floods, NO autenticación — un fallo del limitador jamás
 * puede tumbar webhooks legítimos (perder una notificación de pago real por
 * proteger contra un flood hipotético es el trade-off equivocado). La
 * autenticidad la siguen garantizando el fetch-del-recurso (ML) y la firma
 * HMAC (Fintoc).
 *
 * SEGURIDAD: las llaves contienen identificadores no sensibles (user_id de ML,
 * tenantId del path). NUNCA construir llaves con tokens ni secretos.
 */

import { crearClienteServiceRole } from '@/lib/supabase/service-role';

export interface ResultadoRateLimit {
  permitido: boolean;
  /** Llamadas restantes en la ventana actual (0 si bloqueado). */
  restante: number;
  /** Segundos sugeridos para `Retry-After` cuando se bloquea. */
  reintentarEnSegundos: number;
}

/**
 * Consume 1 unidad del límite para `llave` en la ventana actual.
 *
 * @param llave   identificador de la dimensión a limitar (p. ej. `ml:{user_id}`,
 *                `fintoc:{tenantId}`). Sin secretos.
 * @param limite  máximo de llamadas permitidas por ventana.
 * @param ventanaSegundos largo de la ventana fija, en segundos.
 */
export async function consumirRateLimit(
  llave: string,
  limite: number,
  ventanaSegundos: number,
): Promise<ResultadoRateLimit> {
  try {
    const supabase = crearClienteServiceRole();
    const { data, error } = await supabase.rpc('rate_limit_consumir', {
      p_llave: llave,
      p_ventana_segundos: ventanaSegundos,
    });

    if (error || typeof data !== 'number') {
      // Fail-open: el limitador nunca tumba tráfico legítimo por fallas propias.
      console.warn(
        `[rate-limit] RPC falló para llave=${llave} — fail-open. ` +
          `Detalle: ${error?.message ?? 'respuesta no numérica'}`,
      );
      return { permitido: true, restante: limite, reintentarEnSegundos: 0 };
    }

    const contador = data;
    const permitido = contador <= limite;
    return {
      permitido,
      restante: permitido ? limite - contador : 0,
      reintentarEnSegundos: permitido ? 0 : ventanaSegundos,
    };
  } catch (err) {
    // Cualquier excepción inesperada (red, cliente) → fail-open con warning.
    console.warn(
      `[rate-limit] excepción para llave=${llave} — fail-open. ` +
        `Detalle: ${err instanceof Error ? err.message : 'desconocido'}`,
    );
    return { permitido: true, restante: limite, reintentarEnSegundos: 0 };
  }
}
