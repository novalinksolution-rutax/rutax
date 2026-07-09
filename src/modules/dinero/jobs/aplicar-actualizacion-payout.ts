/**
 * Job F19/Fase 3 · dinero/aplicarActualizacionPayout
 * =====================================================================
 * Trigger: evento `dinero/payout.actualizacion-externa` (publicado SOLO por
 * `api/webhooks/fintoc-payout/route.ts`, tras validar la firma del webhook y
 * registrar en bitácora la recepción del evento).
 *
 * Responsabilidad: delega TODA la lógica de transición a la función
 * compartida `aplicarTransicionPayout` (`./transicion-payout.ts`) — la MISMA
 * que usa el polling de respaldo (`jobConsultarEstadoPayout`), para que
 * webhook y polling nunca diverjan.
 *
 * Si el resultado es 'confirmado', emite `dinero/payout.confirmado` para
 * disparar la conciliación inmediata (`jobConciliarPayoutConfirmado`) sin
 * esperar el cron diario C7. El `id` determinístico del evento
 * (`payout-confirmado-${payoutId}`) hace que Inngest deduplique una
 * re-confirmación (replay/reintento) — no dispara la conciliación dos veces.
 *
 * Idempotencia:
 * - La barrera DURA ya ocurrió en el webhook (UNIQUE `evento_externo_id` en
 *   `dinero.eventos_payout_externos`): un evento de Fintoc reentregado nunca
 *   llega a este job una segunda vez desde la MISMA entrega del proveedor.
 * - `aplicarTransicionPayout` es en sí misma idempotente (guards `.eq('estado', …)`)
 *   por si Inngest reintenta el STEP de este job (fallo transitorio a mitad
 *   de camino) o si el webhook reintrega el mismo evento por timeout del courier.
 */

import { inngest } from '@/lib/inngest/cliente';
import { aplicarTransicionPayout } from './transicion-payout';

interface DatosActualizacionExternaPayout {
  tenantId: string;
  payoutId: string;
  liquidacionId: string;
  transferExternoId: string;
  eventoExternoId: string;
  estadoExterno: 'confirmado' | 'pendiente' | 'fallido' | 'rechazado' | 'desconocido';
  motivo: string | null;
  comprobanteRef: string | null;
}

export const jobAplicarActualizacionPayout = inngest.createFunction(
  {
    id: 'dinero/aplicarActualizacionPayout',
    name: 'Dinero · Aplicar actualización externa de payout (webhook Fintoc)',
    triggers: [{ event: 'dinero/payout.actualizacion-externa' }],
    retries: 3,
  },
  async ({ event, step, logger, runId }) => {
    const datos = event.data as DatosActualizacionExternaPayout;

    const resultado = await step.run('aplicar-transicion', async () => {
      return aplicarTransicionPayout({
        tenantId: datos.tenantId,
        payoutId: datos.payoutId,
        estadoExterno: datos.estadoExterno,
        motivo: datos.motivo,
        comprobanteRef: datos.comprobanteRef,
        origen: 'webhook',
        jobRunId: runId,
      });
    });

    if (resultado.resultado === 'confirmado') {
      await step.run('emitir-payout-confirmado', async () => {
        await inngest.send({
          name: 'dinero/payout.confirmado',
          id: `payout-confirmado-${resultado.payoutId}`,
          data: {
            tenantId: datos.tenantId,
            payoutId: resultado.payoutId,
            liquidacionId: resultado.liquidacionId,
            driverId: resultado.driverId,
          },
        });
      });
    }

    logger.info(
      `Actualización externa de payout ${datos.payoutId} (evt=${datos.eventoExternoId}) → ` +
        `${resultado.resultado} (transición aplicada=${resultado.transicionAplicada}, ` +
        `liquidación revertida=${resultado.liquidacionRevertida}).`,
    );

    return resultado;
  },
);
