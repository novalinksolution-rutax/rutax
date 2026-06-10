/**
 * Job C2 · dinero/cerrarPeriodo
 * =====================================================================
 * Trigger: Cron `0 2 * * *` (02:00 hora Santiago, todos los días)
 *
 * Responsabilidad:
 * - Detectar períodos de cobro con `estado='abierto'` y `fecha_fin < today`.
 * - Calcular totales (suma de monto_final_clp, cuenta de líneas).
 * - Actualizar estado a `cerrado`.
 * - Publicar evento `dinero/periodo.cerrado` para cada período cerrado.
 *   → Dispara SOLO C6 (conciliación), un chequeo detective de solo lectura.
 *   El cron NUNCA emite el DTE: cerrar ≠ facturar. La emisión exige la acción
 *   humana `emitirFacturaPeriodo` (compuerta de aprobación, B1-1).
 *
 * Idempotencia:
 * - La transición `abierto → cerrado` es idempotente: el UPDATE con
 *   WHERE estado='abierto' no afecta filas ya cerradas en reintentos.
 * - Un fallo en uno de los períodos no cancela los demás (Promise.allSettled).
 */

import { inngest } from '@/lib/inngest/cliente';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';

const TZ = 'America/Santiago';

/**
 * Devuelve la fecha de hoy en zona Santiago como string 'YYYY-MM-DD'.
 */
function hoyEnSantiago(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export const jobCerrarPeriodo = inngest.createFunction(
  {
    id: 'dinero/cerrarPeriodo',
    name: 'Dinero · Cerrar períodos de cobro vencidos',
    triggers: [{ cron: '0 2 * * *' }],
    retries: 2,
  },
  async ({ step, logger }) => {
    // Paso 1: Obtener períodos abiertos cuya fecha_fin < hoy.
    const periodosAbiertos = await step.run('listar-periodos-vencidos', async () => {
      const supabase = crearClienteServiceRole();
      const hoy = hoyEnSantiago();

      const { data, error } = await supabase
        .schema('dinero')
        .from('periodos_cobro')
        .select('id, tenant_id, seller_id, fecha_inicio, fecha_fin')
        .eq('estado', 'abierto')
        .lt('fecha_fin', hoy);

      if (error) throw new Error(`Error al listar períodos vencidos: ${error.message}`);
      return data ?? [];
    });

    logger.info(`Períodos vencidos a cerrar: ${periodosAbiertos.length}`);

    if (periodosAbiertos.length === 0) {
      return { resultado: 'sin_periodos_vencidos' };
    }

    // Paso 2: Procesar cada período. Un fallo no cancela los demás.
    const resultados = await step.run('cerrar-periodos', async () => {
      const supabase = crearClienteServiceRole();

      const promesas = periodosAbiertos.map(async (periodo) => {
        const pid = periodo.id as string;
        const tenantId = periodo.tenant_id as string;
        const sellerId = periodo.seller_id as string;

        try {
          // Calcular totales desde líneas de cobro del período.
          const { data: lineas, error: errorLineas } = await supabase
            .schema('dinero')
            .from('lineas_cobro')
            .select('monto_final_clp')
            .eq('tenant_id', tenantId)
            .eq('periodo_cobro_id', pid);

          if (errorLineas) throw new Error(`Error al leer líneas: ${errorLineas.message}`);

          const totalLineas = (lineas ?? []).length;
          const montoTotal = (lineas ?? []).reduce(
            (acc, l) => acc + Math.round(Number(l.monto_final_clp)),
            0,
          );

          // UPDATE a cerrado (idempotente: WHERE estado='abierto').
          const { error: errorUpdate } = await supabase
            .schema('dinero')
            .from('periodos_cobro')
            .update({
              estado: 'cerrado',
              total_lineas: totalLineas,
              monto_total_clp: montoTotal,
              cerrado_en: new Date().toISOString(),
              actualizado_en: new Date().toISOString(),
            })
            .eq('id', pid)
            .eq('tenant_id', tenantId)
            .eq('estado', 'abierto');

          if (errorUpdate) throw new Error(`Error al cerrar período ${pid}: ${errorUpdate.message}`);

          // Publicar evento para C3 y C6.
          await inngest.send({
            name: 'dinero/periodo.cerrado',
            id: `periodo-cerrado-cron-${pid}`,
            data: {
              periodoCobroidId: pid,
              tenantId,
              sellerId,
              fechaInicio: periodo.fecha_inicio as string,
              fechaFin: periodo.fecha_fin as string,
              montoTotalClp: montoTotal,
            },
          });

          return { periodoId: pid, estado: 'cerrado', totalLineas, montoTotal };
        } catch (err) {
          logger.error(`Error al cerrar período ${pid}: ${(err as Error).message}`);
          return { periodoId: pid, estado: 'error', error: (err as Error).message };
        }
      });

      const settled = await Promise.allSettled(promesas);
      return settled.map((r) => (r.status === 'fulfilled' ? r.value : { error: String(r.reason) }));
    });

    const cerrados = resultados.filter((r) => r && 'estado' in r && r.estado === 'cerrado').length;
    const errores = resultados.filter((r) => r && 'estado' in r && r.estado === 'error').length;

    logger.info(`Períodos cerrados: ${cerrados}. Errores: ${errores}.`);

    return { cerrados, errores, detalle: resultados };
  },
);
