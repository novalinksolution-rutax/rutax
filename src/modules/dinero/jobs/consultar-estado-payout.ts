/**
 * Job F19 · dinero/consultarEstadoPayout
 * =====================================================================
 * Trigger: Cron `0 *\/6 * * *` (cada 6 horas)
 *
 * Responsabilidad — RED DE SEGURIDAD del webhook de confirmación instantánea
 * (`api/webhooks/fintoc-payout`, Fase 3), no la vía principal de confirmación:
 * - Re-consultar en el proveedor (Fintoc / manual / stub) el estado de:
 *     (a) payouts en `estado = 'enviado'` con `payout_externo_id` conocido
 *         (aún sin confirmar por el webhook), y
 *     (b) payouts YA `estado = 'confirmado'` en los últimos
 *         `DIAS_RECONSULTA_CONFIRMADOS` días — cierra el punto ciego de una
 *         reversión post-confirmación (`succeeded` → `returned`/`failed`) que
 *         el webhook no haya llegado a entregar (caída del endpoint, timeout,
 *         mala configuración del Webhook Endpoint en Fintoc, etc.).
 * - Delegar TODA la transición de estado a la función compartida
 *   `aplicarTransicionPayout` (`./transicion-payout.ts`) — la MISMA que usa
 *   el webhook — para que polling y webhook nunca diverjan en la tabla de
 *   traducción `estado_externo → payout/liquidación`.
 *
 * Antes de esta refactorización el polling SOLO miraba `estado = 'enviado'`:
 * una vez `confirmado`, la fila dejaba de re-consultarse — por eso una
 * reversión posterior (`succeeded → returned`) quedaba invisible si el
 * webhook no llegaba. El re-chequeo de confirmados recientes tapa ese hueco.
 *
 * Idempotencia:
 * - `aplicarTransicionPayout` guarda cada mutación con `.eq('estado', <esperado>)`
 *   — reintentos/re-ejecuciones de este cron no duplican efectos ni fallan.
 *
 * Este job NO mueve dinero: solo actualiza el estado del payout ya ejecutado.
 * El dinero se movió en `jobEjecutarPayout` al recibir 'enviado' del proveedor.
 *
 * Nota: para el `StubPayoutAdapter` y `ManualPayoutAdapter`, `consultarPayout`
 * devuelve 'pendiente' hasta que un humano confirme manualmente; el polling
 * idempotente no les hace daño.
 */

import { inngest } from '@/lib/inngest/cliente';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { obtenerPuertoPayout } from '@/modules/integraciones/pagos/payout/fabrica-payout';
import { aplicarTransicionPayout } from './transicion-payout';

/** Ventana de re-chequeo de payouts ya `confirmado` (días). Configurable por env. */
const DIAS_RECONSULTA_CONFIRMADOS = (() => {
  const v = Number(process.env.DINERO_DIAS_RECONSULTA_PAYOUT_CONFIRMADO);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 5;
})();

export const jobConsultarEstadoPayout = inngest.createFunction(
  {
    id: 'dinero/consultarEstadoPayout',
    name: 'Dinero · Consultar estado de pago a conductor',
    // Cada 6 horas: red de seguridad del webhook de confirmación instantánea
    // (transfer.outbound.*), no la vía principal de confirmación.
    triggers: [{ cron: '0 */6 * * *' }],
    retries: 1,
  },
  async ({ step, logger, runId }) => {
    // Step 1 — Listar payouts a re-consultar: 'enviado' (sin confirmar aún) +
    // 'confirmado' recientes (red de seguridad de reversión post-confirmación).
    const payoutsARevisar = await step.run('listar-payouts-a-revisar', async () => {
      const supabase = crearClienteServiceRole();

      const { data: enviados, error: errEnviados } = await supabase
        .schema('dinero')
        .from('payouts_conductor')
        .select('id, tenant_id, payout_externo_id')
        .eq('estado', 'enviado')
        .not('payout_externo_id', 'is', null);

      if (errEnviados) throw new Error(`Error al listar payouts enviados: ${errEnviados.message}`);

      const desdeIso = new Date(
        Date.now() - DIAS_RECONSULTA_CONFIRMADOS * 24 * 60 * 60 * 1000,
      ).toISOString();

      const { data: confirmadosRecientes, error: errConfirmados } = await supabase
        .schema('dinero')
        .from('payouts_conductor')
        .select('id, tenant_id, payout_externo_id')
        .eq('estado', 'confirmado')
        .not('payout_externo_id', 'is', null)
        .gte('confirmado_en', desdeIso);

      if (errConfirmados) {
        throw new Error(`Error al listar payouts confirmados recientes: ${errConfirmados.message}`);
      }

      return [...(enviados ?? []), ...(confirmadosRecientes ?? [])];
    });

    logger.info(`Payouts a re-consultar: ${payoutsARevisar.length}`);

    if (payoutsARevisar.length === 0) {
      return { resultado: 'sin_payouts_a_revisar' };
    }

    // Step 2 — Consultar estado de cada payout en el proveedor y aplicar la
    // transición compartida.
    const resultados = await step.run('consultar-y-aplicar', async () => {
      const procesados = await Promise.allSettled(
        payoutsARevisar.map(async (payout) => {
          const payoutFila = payout as Record<string, unknown>;
          const payoutId = payoutFila.id as string;
          const tenantId = payoutFila.tenant_id as string;
          const payoutExternoId = payoutFila.payout_externo_id as string;

          try {
            const puerto = await obtenerPuertoPayout(tenantId);
            const estadoExterno = await puerto.consultarPayout({ payoutExternoId });

            const resultado = await aplicarTransicionPayout({
              tenantId,
              payoutId,
              // `EstadoExternoPayout` (3 valores) es subconjunto de
              // `EstadoExternoEventoPayout` (5 valores): el polling nunca
              // produce 'fallido' ni 'desconocido', solo el webhook los usa.
              estadoExterno: estadoExterno.estado,
              motivo: estadoExterno.descripcion,
              comprobanteRef: estadoExterno.comprobanteRef,
              origen: 'polling',
              jobRunId: runId,
            });

            return {
              payoutId,
              resultado: resultado.resultado,
              liquidacionRevertida: resultado.liquidacionRevertida,
            };
          } catch (err) {
            logger.error(
              `Error al re-consultar/aplicar el estado del payout ${payoutId}: ${(err as Error).message}`,
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
    const fallidos = resultados.filter((r) => r && 'resultado' in r && r.resultado === 'fallido').length;
    const pendientes = resultados.filter((r) => r && 'resultado' in r && r.resultado === 'pendiente').length;
    const reversiones = resultados.filter(
      (r) => r && 'liquidacionRevertida' in r && (r as { liquidacionRevertida?: boolean }).liquidacionRevertida,
    ).length;
    const errores = resultados.filter((r) => r && 'resultado' in r && r.resultado === 'error').length;

    logger.info(
      `Consulta de estados: confirmados=${confirmados}, rechazados=${rechazados}, fallidos=${fallidos}, ` +
        `pendientes=${pendientes}, reversiones_post_confirmacion=${reversiones}, errores=${errores}.`,
    );

    return { confirmados, rechazados, fallidos, pendientes, reversiones, errores, detalle: resultados };
  },
);
