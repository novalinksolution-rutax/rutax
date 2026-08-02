/**
 * Proyección de webhooks salientes.
 *
 * `proyectarWebhook` es la función de "fan-out": dado un evento de negocio,
 * inserta una fila en `integraciones.webhook_outbox` por cada endpoint activo
 * del tenant suscrito a ese tipo de evento. El job `jobEntregarWebhook` es
 * quien realmente hace el POST HTTP; esta función solo encola.
 *
 * Principios de diseño:
 * - Silenciosa: wrap completo en try/catch para no tumbar el flujo principal
 *   que la llama (ej. una transición de estado de pedido). Un error aquí
 *   NO debe fallar la operación de negocio.
 * - `Promise.allSettled`: los inserts van en paralelo; un insert fallido no
 *   cancela los demás.
 * - Usa service_role para bypasear RLS (webhook_outbox es solo-sistema).
 */

import { crearClienteServiceRole } from '@/lib/supabase/service-role';

/**
 * Encola un webhook saliente en `webhook_outbox` para cada endpoint activo
 * del tenant suscrito al `eventoTipo` indicado.
 *
 * No lanza excepciones — errores internos son silenciosos para no interrumpir
 * el flujo de negocio del llamador.
 */
export async function proyectarWebhook(
  tenantId: string,
  eventoTipo: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const supabase = crearClienteServiceRole();

    // Buscar endpoints activos suscritos a este tipo de evento.
    const { data: endpoints, error: errEndpoints } = await supabase
      .schema('integraciones')
      .from('webhook_endpoints')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('activo', true)
      .contains('eventos', [eventoTipo]);

    if (errEndpoints || !endpoints || endpoints.length === 0) {
      return;
    }

    const ahora = new Date().toISOString();

    // Insertar una fila en outbox por cada endpoint suscrito.
    const inserts = endpoints.map((ep) =>
      supabase
        .schema('integraciones')
        .from('webhook_outbox')
        .insert({
          tenant_id: tenantId,
          endpoint_id: ep.id as string,
          evento_tipo: eventoTipo,
          payload,
          estado: 'pendiente',
          proximo_intento_en: ahora,
        }),
    );

    await Promise.allSettled(inserts);
  } catch {
    // Silencioso: no propagar errores al flujo principal.
  }
}
