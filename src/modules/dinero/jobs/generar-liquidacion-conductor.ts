/**
 * Job C4 · dinero/generarLiquidacionConductor
 * =====================================================================
 * Trigger: Cron `0 2 * * *` (02:00 hora Santiago, todos los días)
 *
 * Responsabilidad:
 * - Detectar líneas de liquidación sin `liquidacion_id` asignada.
 * - Agrupar por conductor y período.
 * - Crear `dinero.liquidaciones` si no existe para ese conductor + rango.
 * - Generar PDF de liquidación (stub en el MVP — @react-pdf/renderer no está instalado).
 * - Guardar PDF en Storage: `{tenant_id}/liquidaciones/{liquidacion_id}/liquidacion.pdf`
 * - Actualizar `liquidaciones.pdf_ref` y `estado = 'emitida'`.
 *
 * Idempotencia:
 * - UNIQUE (tenant_id, driver_id, fecha_inicio, fecha_fin) en `liquidaciones`.
 * - Las líneas con liquidacion_id ya asignado no se procesan de nuevo.
 *
 * Nota sobre PDF:
 * @react-pdf/renderer no está instalado en el MVP. Se usa un stub que retorna
 * un Buffer vacío. Cuando se instale, reemplazar generarPdfLiquidacionStub
 * por la implementación real con @react-pdf/renderer.
 */

import { inngest } from '@/lib/inngest/cliente';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';

const TZ = 'America/Santiago';

function hoyEnSantiago(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * Genera el PDF de una liquidación.
 * TODO: implementar con @react-pdf/renderer cuando se instale el paquete.
 * Por ahora retorna un Buffer vacío como stub.
 */
async function generarPdfLiquidacionStub(
  _liquidacionId: string,
  _totalEntregas: number,
  _montoTotalClp: number,
): Promise<Buffer> {
  // TODO: implementar con @react-pdf/renderer
  // import { renderToBuffer } from '@react-pdf/renderer';
  // return renderToBuffer(<LiquidacionDoc ... />);
  return Buffer.from('');
}

export const jobGenerarLiquidacionConductor = inngest.createFunction(
  {
    id: 'dinero/generarLiquidacionConductor',
    name: 'Dinero · Generar liquidaciones de conductor',
    triggers: [{ cron: '0 2 * * *' }],
    retries: 2,
  },
  async ({ step, logger, runId }) => {
    // Paso 1: Detectar liquidaciones en estado 'borrador' con líneas asignadas.
    const liquidacionesPendientes = await step.run(
      'listar-liquidaciones-borrador',
      async () => {
        const supabase = crearClienteServiceRole();
        const hoy = hoyEnSantiago();

        // Buscar liquidaciones en borrador cuya fecha_fin < hoy.
        const { data, error } = await supabase
          .schema('dinero')
          .from('liquidaciones')
          .select('id, tenant_id, driver_id, fecha_inicio, fecha_fin, tipo_relacion_conductor')
          .eq('estado', 'borrador')
          .lt('fecha_fin', hoy);

        if (error) throw new Error(`Error al listar liquidaciones: ${error.message}`);
        return data ?? [];
      },
    );

    logger.info(`Liquidaciones a procesar: ${liquidacionesPendientes.length}`);

    if (liquidacionesPendientes.length === 0) {
      return { resultado: 'sin_liquidaciones_pendientes' };
    }

    // Paso 2: Procesar cada liquidación.
    const resultados = await step.run('procesar-liquidaciones', async () => {
      const supabase = crearClienteServiceRole();

      const resultadosProcesados = await Promise.allSettled(
        liquidacionesPendientes.map(async (liq) => {
          const liqId = liq.id as string;
          const tenantId = liq.tenant_id as string;
          const driverId = liq.driver_id as string;

          try {
            // Contar y sumar líneas de la liquidación.
            const { data: lineas, error: lineasError } = await supabase
              .schema('dinero')
              .from('lineas_liquidacion')
              .select('monto_final_clp')
              .eq('tenant_id', tenantId)
              .eq('liquidacion_id', liqId);

            if (lineasError) throw new Error(`Error al leer líneas: ${lineasError.message}`);

            const totalEntregas = (lineas ?? []).length;
            const montoTotal = (lineas ?? []).reduce(
              (acc, l) => acc + Math.round(Number(l.monto_final_clp)),
              0,
            );

            // Generar PDF (stub en el MVP).
            const pdfBuffer = await generarPdfLiquidacionStub(liqId, totalEntregas, montoTotal);

            // Guardar PDF en Storage (path: {tenant_id}/liquidaciones/{liq_id}/liquidacion.pdf).
            const storagePath = `${tenantId}/liquidaciones/${liqId}/liquidacion.pdf`;
            let pdfRef: string | null = null;

            if (pdfBuffer.length > 0) {
              const { error: storageError } = await supabase.storage
                .from('liquidaciones')
                .upload(storagePath, pdfBuffer, {
                  contentType: 'application/pdf',
                  upsert: true,
                });

              if (storageError) {
                logger.warn(`Error al subir PDF de liquidación ${liqId}: ${storageError.message}`);
                // No fallar el job por el PDF — la liquidación se emite sin PDF
                pdfRef = null;
              } else {
                pdfRef = storagePath;
              }
            }

            // Actualizar liquidación: totales + estado + pdf_ref.
            const { error: updateError } = await supabase
              .schema('dinero')
              .from('liquidaciones')
              .update({
                estado: 'emitida',
                total_entregas: totalEntregas,
                monto_total_clp: montoTotal,
                pdf_ref: pdfRef,
                generado_en: new Date().toISOString(),
                actualizado_en: new Date().toISOString(),
              })
              .eq('id', liqId)
              .eq('tenant_id', tenantId)
              .eq('estado', 'borrador');

            if (updateError) {
              throw new Error(`Error al actualizar liquidación ${liqId}: ${updateError.message}`);
            }

            await registrarEnBitacora(supabase, {
              tenantId,
              actorUsuarioId: null,
              actorTipo: 'sistema',
              accion: 'dinero.liquidacion_emitida',
              entidadTipo: 'liquidacion',
              entidadId: liqId,
              detalle: {
                driver_id: driverId,
                total_entregas: totalEntregas,
                monto_total_clp: montoTotal,
                job_run_id: runId,
              },
            });

            return { liquidacionId: liqId, estado: 'emitida', totalEntregas, montoTotal };
          } catch (err) {
            logger.error(`Error al procesar liquidación ${liqId}: ${(err as Error).message}`);
            return { liquidacionId: liqId, estado: 'error', error: (err as Error).message };
          }
        }),
      );

      return resultadosProcesados.map((r) =>
        r.status === 'fulfilled' ? r.value : { estado: 'error', error: String(r.reason) },
      );
    });

    const emitidas = resultados.filter((r) => r && 'estado' in r && r.estado === 'emitida').length;
    const errores = resultados.filter((r) => r && 'estado' in r && r.estado === 'error').length;

    logger.info(`Liquidaciones emitidas: ${emitidas}. Errores: ${errores}.`);

    return { emitidas, errores, detalle: resultados };
  },
);
