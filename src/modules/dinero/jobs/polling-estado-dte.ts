// Job C5 · dinero/pollingEstadoDte
// Trigger: Cron cada 6 horas (0 * /6 * * *)
// Responsabilidad:
// - Leer documentos_dte WHERE estado_sii = 'pendiente'.
// - Para cada DTE pendiente: consultar el proveedor DTE via puerto.
// - Actualizar estado_sii en BD.
// - Si rechazado: INSERT en dinero.eventos_conciliacion para revisión manual.
// Idempotencia: el UPDATE es idempotente. Eventos de conciliación se deduplicam.
// SEGURIDAD: las credenciales del proveedor DTE nunca aparecen en logs.

import { inngest } from '@/lib/inngest/cliente';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { obtenerPuertoDte } from '@/modules/integraciones/dte';

export const jobPollingEstadoDte = inngest.createFunction(
  {
    id: 'dinero/pollingEstadoDte',
    name: 'Dinero · Polling de estado de DTEs pendientes',
    triggers: [{ cron: '0 */6 * * *' }],
    retries: 2,
  },
  async ({ step, logger, runId }) => {
    // Paso 1: Obtener DTEs pendientes.
    const dtesPendientes = await step.run('listar-dtes-pendientes', async () => {
      const supabase = crearClienteServiceRole();

      const { data, error } = await supabase
        .schema('dinero')
        .from('documentos_dte')
        .select('id, tenant_id, seller_id, proveedor_dte_id_externo, periodo_cobro_id, monto_total_clp')
        .eq('estado_sii', 'pendiente')
        .not('proveedor_dte_id_externo', 'is', null);

      if (error) throw new Error(`Error al listar DTEs pendientes: ${error.message}`);
      return data ?? [];
    });

    logger.info(`DTEs pendientes a consultar: ${dtesPendientes.length}`);

    if (dtesPendientes.length === 0) {
      return { resultado: 'sin_dtes_pendientes' };
    }

    // Paso 2: Consultar estado de cada DTE.
    const resultados = await step.run('consultar-estados', async () => {
      const supabase = crearClienteServiceRole();

      const procesados = await Promise.allSettled(
        dtesPendientes.map(async (dte) => {
          const dteId = dte.id as string;
          const tenantId = dte.tenant_id as string;
          const sellerId = dte.seller_id as string;
          const idExterno = dte.proveedor_dte_id_externo as string;
          const periodoCobroidId = dte.periodo_cobro_id as string | null;

          try {
            // Consultar el proveedor DTE via puerto.
            // Las credenciales se descifran dentro de obtenerPuertoDte y no salen.
            const puerto = await obtenerPuertoDte(tenantId);
            const consultaResultado = await puerto.consultarEstadoDte(tenantId, idExterno);

            const estadoSii = consultaResultado.estadoSii;

            // Actualizar estado_sii en BD.
            const { error: updateError } = await supabase
              .schema('dinero')
              .from('documentos_dte')
              .update({
                estado_sii: estadoSii,
                actualizado_en: new Date().toISOString(),
              })
              .eq('id', dteId)
              .eq('tenant_id', tenantId);

            if (updateError) {
              throw new Error(`Error al actualizar estado DTE ${dteId}: ${updateError.message}`);
            }

            // Si rechazado: registrar evento de conciliación.
            if (estadoSii === 'rechazado') {
              // Verificar que no existe ya un evento del mismo tipo para este DTE.
              const { data: eventoExistente } = await supabase
                .schema('dinero')
                .from('eventos_conciliacion')
                .select('id')
                .eq('tenant_id', tenantId)
                .eq('tipo_diferencia', 'folio_consumido_sin_dte_persistido')
                .eq('periodo_cobro_id', periodoCobroidId ?? '')
                .maybeSingle();

              if (!eventoExistente && periodoCobroidId) {
                const descripcion = consultaResultado.descripcionSii
                  ? `DTE rechazado por SII. ${consultaResultado.descripcionSii}`
                  : 'DTE rechazado por SII — revisar estado del período';

                await supabase
                  .schema('dinero')
                  .from('eventos_conciliacion')
                  .insert({
                    tenant_id: tenantId,
                    seller_id: sellerId,
                    periodo_cobro_id: periodoCobroidId,
                    tipo_diferencia: 'folio_consumido_sin_dte_persistido',
                    descripcion,
                    monto_diferencia_clp: dte.monto_total_clp ? Math.round(Number(dte.monto_total_clp)) : null,
                    estado: 'pendiente',
                    job_run_id: runId,
                  });
              }

              logger.warn(`DTE ${dteId} rechazado por SII. Evento de conciliación insertado.`);
            }

            return { dteId, estadoSii };
          } catch (err) {
            logger.error(`Error al consultar DTE ${dteId}: ${(err as Error).message}`);
            return { dteId, error: (err as Error).message };
          }
        }),
      );

      return procesados.map((r) =>
        r.status === 'fulfilled' ? r.value : { error: String(r.reason) },
      );
    });

    const actualizados = resultados.filter((r) => r && 'estadoSii' in r).length;
    const rechazados = resultados.filter((r) => r && 'estadoSii' in r && r.estadoSii === 'rechazado').length;
    const errores = resultados.filter((r) => r && 'error' in r).length;

    logger.info(`DTEs actualizados: ${actualizados}. Rechazados: ${rechazados}. Errores: ${errores}.`);

    return { actualizados, rechazados, errores };
  },
);
