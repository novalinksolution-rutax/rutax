/**
 * Job F19 · dinero/consultarEstadoPayout
 * =====================================================================
 * Trigger: Cron `0 *\/4 * * *` (cada 4 horas)
 *
 * Responsabilidad:
 * - Consultar en el proveedor (Fintoc / manual / stub) el estado de todos los
 *   payouts en estado 'enviado' con `payout_externo_id` conocido.
 * - Si 'confirmado': actualizar `estado_payout = 'confirmado'` y proyectar la
 *   liquidación a 'pagada' (si no lo estaba ya).
 * - Si 'rechazado': actualizar `estado_payout = 'rechazado'` y registrar en
 *   bitácora.
 * - Si 'pendiente': no hacer nada (el proveedor aún no confirmó).
 *
 * Idempotencia:
 * - Solo procesa filas en `estado = 'enviado'` (las confirmadas/rechazadas no
 *   se re-consultan).
 * - La proyección de la liquidación usa `.eq('estado', 'emitida')` como guard
 *   adicional en BD, por si otro proceso ya la marcó.
 *
 * Este job NO mueve dinero: solo actualiza el estado del payout ya ejecutado.
 * El dinero se movió en `jobEjecutarPayout` al recibir 'enviado' del proveedor.
 * Este polling cierra el loop de confirmación asíncrona de Fintoc.
 *
 * Nota: para el `StubPayoutAdapter` y `ManualPayoutAdapter`, `consultarPayout`
 * devuelve 'pendiente' hasta que un humano confirme manualmente; el polling
 * idempotente no les hace daño.
 */

import { inngest } from '@/lib/inngest/cliente';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import { obtenerPuertoPayout } from '@/modules/integraciones/pagos/payout/fabrica-payout';

export const jobConsultarEstadoPayout = inngest.createFunction(
  {
    id: 'dinero/consultarEstadoPayout',
    name: 'Dinero · Consultar estado de pago a conductor',
    // Cada hora mientras no haya webhook Fintoc configurado (B-2).
    // El mismo idempotencyKey garantiza que el polling no genera doble confirmación.
    triggers: [{ cron: '0 * * * *' }],
    retries: 1,
  },
  async ({ step, logger }) => {
    // Step 1 — Listar payouts en estado 'enviado' con payout_externo_id conocido.
    const payoutsEnviados = await step.run('listar-payouts-enviados', async () => {
      const supabase = crearClienteServiceRole();

      const { data, error } = await supabase
        .schema('dinero')
        .from('payouts_conductor')
        .select('id, tenant_id, driver_id, liquidacion_id, payout_externo_id, estado')
        .eq('estado', 'enviado')
        .not('payout_externo_id', 'is', null);

      if (error) throw new Error(`Error al listar payouts enviados: ${error.message}`);
      return data ?? [];
    });

    logger.info(`Payouts enviados a consultar: ${payoutsEnviados.length}`);

    if (payoutsEnviados.length === 0) {
      return { resultado: 'sin_payouts_enviados' };
    }

    // Step 2 — Consultar estado de cada payout en el proveedor.
    const resultados = await step.run('consultar-estados', async () => {
      const supabase = crearClienteServiceRole();

      const procesados = await Promise.allSettled(
        payoutsEnviados.map(async (payout) => {
          const payoutFila = payout as Record<string, unknown>;
          const payoutId = payoutFila.id as string;
          const tenantId = payoutFila.tenant_id as string;
          const liquidacionId = payoutFila.liquidacion_id as string;
          const driverId = payoutFila.driver_id as string;
          const payoutExternoId = payoutFila.payout_externo_id as string;

          try {
            const puerto = await obtenerPuertoPayout(tenantId);
            const estadoExterno = await puerto.consultarPayout({ payoutExternoId });

            const ahora = new Date().toISOString();

            if (estadoExterno.estado === 'confirmado') {
              // Actualizar payout a confirmado.
              const { error: errPayout } = await supabase
                .schema('dinero')
                .from('payouts_conductor')
                .update({
                  estado: 'confirmado',
                  comprobante_ref: estadoExterno.comprobanteRef ?? null,
                  confirmado_en: ahora,
                  actualizado_en: ahora,
                })
                .eq('id', payoutId)
                .eq('tenant_id', tenantId)
                .eq('estado', 'enviado'); // guard: no sobreescribir si ya cambió

              if (errPayout) {
                throw new Error(`Error al actualizar payout a confirmado: ${errPayout.message}`);
              }

              // Proyectar liquidación a 'pagada' (si aún no lo está).
              const { error: errLiq } = await supabase
                .schema('dinero')
                .from('liquidaciones')
                .update({ estado: 'pagada', actualizado_en: ahora })
                .eq('id', liquidacionId)
                .eq('tenant_id', tenantId)
                .eq('estado', 'emitida'); // guard: solo si aún 'emitida'

              if (errLiq) {
                throw new Error(`Error al proyectar liquidación a 'pagada': ${errLiq.message}`);
              }

              // Bitácora de confirmación.
              await registrarEnBitacora(supabase, {
                tenantId,
                actorUsuarioId: null,
                actorTipo: 'sistema',
                accion: 'dinero.payout_confirmado',
                entidadTipo: 'liquidacion',
                entidadId: liquidacionId,
                detalle: {
                  payout_id: payoutId,
                  driver_id: driverId,
                },
              });

              return { payoutId, resultado: 'confirmado' };
            }

            if (estadoExterno.estado === 'rechazado') {
              // Actualizar payout a rechazado.
              const { error: errPayout } = await supabase
                .schema('dinero')
                .from('payouts_conductor')
                .update({
                  estado: 'rechazado',
                  error_descripcion: estadoExterno.descripcion ?? 'Rechazado por el proveedor.',
                  actualizado_en: ahora,
                })
                .eq('id', payoutId)
                .eq('tenant_id', tenantId)
                .eq('estado', 'enviado');

              if (errPayout) {
                throw new Error(`Error al actualizar payout a rechazado: ${errPayout.message}`);
              }

              // Bitácora de rechazo.
              await registrarEnBitacora(supabase, {
                tenantId,
                actorUsuarioId: null,
                actorTipo: 'sistema',
                accion: 'dinero.payout_rechazado',
                entidadTipo: 'liquidacion',
                entidadId: liquidacionId,
                detalle: {
                  payout_id: payoutId,
                  driver_id: driverId,
                  descripcion: estadoExterno.descripcion,
                },
              });

              return { payoutId, resultado: 'rechazado' };
            }

            // 'pendiente': el proveedor aún no confirmó — no tocar nada.
            return { payoutId, resultado: 'pendiente' };
          } catch (err) {
            logger.error(
              `Error al consultar estado del payout ${payoutId}: ${(err as Error).message}`,
            );
            return { payoutId, resultado: 'error', error: (err as Error).message };
          }
        }),
      );

      return procesados.map((r) =>
        r.status === 'fulfilled' ? r.value : { resultado: 'error', error: String(r.reason) },
      );
    });

    const confirmados = resultados.filter((r) => r && 'resultado' in r && r.resultado === 'confirmado').length;
    const rechazados = resultados.filter((r) => r && 'resultado' in r && r.resultado === 'rechazado').length;
    const pendientes = resultados.filter((r) => r && 'resultado' in r && r.resultado === 'pendiente').length;
    const errores = resultados.filter((r) => r && 'resultado' in r && r.resultado === 'error').length;

    logger.info(
      `Consulta de estados: confirmados=${confirmados}, rechazados=${rechazados}, ` +
        `pendientes=${pendientes}, errores=${errores}.`,
    );

    return { confirmados, rechazados, pendientes, errores, detalle: resultados };
  },
);
