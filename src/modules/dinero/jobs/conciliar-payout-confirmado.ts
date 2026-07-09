/**
 * Job F19/Fase 3 · dinero/conciliarPayoutConfirmado
 * =====================================================================
 * Trigger: evento `dinero/payout.confirmado` (publicado por
 * `jobAplicarActualizacionPayout` cuando el webhook confirma un payout).
 *
 * Responsabilidad: conciliación INMEDIATA y ACOTADA a la liquidación que
 * acaba de confirmarse — sin esperar el cron diario C7 (`conciliarTresFuentes`,
 * 02:30). En cuanto se confirma que el dinero salió de verdad hacia el
 * conductor, revisa los pedidos de ESA liquidación en busca de la fuga D1
 * (`pagado_conductor_sin_cobro_seller`): ¿se pagó al conductor un pedido cuya
 * línea de cobro al seller está anulada o no existe? Es la variante ACOTADA
 * (por liquidación) del detector D1 completo de `conciliar-tres-fuentes.ts`
 * (que sigue corriendo cada noche sobre TODO el tenant); esta versión da una
 * alerta temprana justo cuando el riesgo es más alto (el dinero ya se movió).
 *
 * Reusa los MISMOS helpers de inserción idempotente que C7
 * (`../conciliacion-insercion.ts`) — el cron nocturno NUNCA duplica un
 * hallazgo que esta conciliación inmediata ya insertó.
 *
 * Detective puro — NUNCA muta líneas, liquidaciones ni períodos. Solo
 * inserta en `dinero.eventos_conciliacion` cuando corresponde.
 *
 * Idempotencia:
 * - `existeEventoConciliacion` evita duplicar el hallazgo por pedido.
 * - El evento disparador ya trae un `id` determinístico
 *   (`payout-confirmado-${payoutId}`) — un reintento de Inngest no vuelve a
 *   correr dos veces la MISMA conciliación para el mismo payout.
 *
 * SEGURIDAD: solo se loguean tenant_id/IDs de entidades — nunca montos
 * cruzados entre tenants ni datos de conductores/sellers.
 */

import { inngest } from '@/lib/inngest/cliente';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { capturarMensaje } from '@/lib/observabilidad';
import { existeEventoConciliacion, insertarEventoConciliacion } from '../conciliacion-insercion';

interface DatosPayoutConfirmado {
  tenantId: string;
  payoutId: string;
  liquidacionId: string;
  driverId: string;
}

export const jobConciliarPayoutConfirmado = inngest.createFunction(
  {
    id: 'dinero/conciliarPayoutConfirmado',
    name: 'Dinero · Conciliación inmediata tras payout confirmado',
    triggers: [{ event: 'dinero/payout.confirmado' }],
    retries: 3,
  },
  async ({ event, step, logger, runId }) => {
    const datos = event.data as DatosPayoutConfirmado;

    const hallazgos = await step.run('conciliar-liquidacion-acotada', async () => {
      return conciliarLiquidacionAcotada(datos.tenantId, datos.liquidacionId, runId);
    });

    if (hallazgos > 0) {
      await step.run('alerta-fuga-inmediata', async () => {
        await capturarMensaje(
          `Conciliación inmediata: ${hallazgos} fuga(s) directa(s) detectada(s) tras confirmar el payout ${datos.payoutId}.`,
          'warning',
          {
            origen: 'job:dinero/conciliarPayoutConfirmado',
            tenantId: datos.tenantId,
            correlacionId: runId,
            etiquetas: { liquidacion_id: datos.liquidacionId, nuevas: String(hallazgos) },
          },
        );
      });
    }

    logger.info(
      `Conciliación inmediata de liquidación ${datos.liquidacionId} (payout ${datos.payoutId}): ${hallazgos} hallazgo(s).`,
    );

    return { resultado: 'completado', liquidacionId: datos.liquidacionId, hallazgos };
  },
);

/**
 * Variante ACOTADA del detector D1 (`pagado_conductor_sin_cobro_seller`),
 * restringida a los pedidos de UNA liquidación. Devuelve el número de
 * hallazgos nuevos insertados.
 */
async function conciliarLiquidacionAcotada(
  tenantId: string,
  liquidacionId: string,
  runId: string,
): Promise<number> {
  const supabase = crearClienteServiceRole();

  const { data: lineas, error } = await supabase
    .schema('dinero')
    .from('lineas_liquidacion')
    .select('pedido_id, driver_id, monto_final_clp')
    .eq('tenant_id', tenantId)
    .eq('liquidacion_id', liquidacionId)
    .eq('anulada', false);

  if (error) {
    throw new Error(`Error al leer líneas de la liquidación ${liquidacionId}: ${error.message}`);
  }
  if (!lineas || lineas.length === 0) return 0;

  let insertados = 0;

  for (const linea of lineas) {
    const pedidoId = linea.pedido_id as string;
    const driverId = linea.driver_id as string;
    const montoFinalClp = Math.round(Number(linea.monto_final_clp ?? 0));

    // ¿Existe línea de cobro para este pedido? (a lo sumo una por pedido — ver D1).
    const { data: lineaCobro, error: errCobro } = await supabase
      .schema('dinero')
      .from('lineas_cobro')
      .select('id, seller_id, periodo_cobro_id, anulada')
      .eq('tenant_id', tenantId)
      .eq('pedido_id', pedidoId)
      .maybeSingle();

    if (errCobro) {
      throw new Error(`Error al leer línea de cobro del pedido ${pedidoId}: ${errCobro.message}`);
    }

    // Sin línea de cobro en absoluto → puede ser gasto propio del courier
    // (mismo criterio que D1); se omite para no generar un falso positivo.
    if (!lineaCobro) continue;

    // Cobro vigente (anulada=false) → no es fuga.
    if (lineaCobro.anulada === false) continue;

    const yaExiste = await existeEventoConciliacion(
      supabase,
      tenantId,
      'pagado_conductor_sin_cobro_seller',
      { pedidoId },
    );
    if (yaExiste) continue;

    await insertarEventoConciliacion(supabase, {
      tenant_id: tenantId,
      seller_id: (lineaCobro.seller_id as string | null) ?? null,
      periodo_cobro_id: (lineaCobro.periodo_cobro_id as string | null) ?? null,
      pedido_id: pedidoId,
      driver_id: driverId,
      liquidacion_id: liquidacionId,
      tipo_diferencia: 'pagado_conductor_sin_cobro_seller',
      descripcion:
        `Pedido ${pedidoId}: el payout de la liquidación ${liquidacionId} se confirmó, pero la ` +
        `línea de cobro al seller está anulada. Fuga directa de ${montoFinalClp} CLP detectada por ` +
        `conciliación inmediata (sin esperar el cron C7).`,
      monto_diferencia_clp: montoFinalClp,
      estado: 'pendiente',
      job_run_id: runId,
    });
    insertados++;
  }

  return insertados;
}
