/**
 * Job · plataforma/marcarMorosidad — morosidad de suscripción (item 2).
 * =============================================================================
 * Trigger: Cron `0 8 * * *` (08:00 hora Santiago, diario).
 *
 * Política de negocio elegida por el fundador: MARCAR + ALERTAR, sin suspensión
 * automática. Este cron marca los períodos de suscripción vencidos e impagos
 * como `vencido` y alerta al super-admin. La suspensión sigue siendo una acción
 * MANUAL del super-admin (`suspenderSuscripcion`) — nunca automática.
 *
 * Idempotente: el UPDATE con WHERE estado='pendiente' no re-afecta filas ya
 * marcadas 'vencido' en corridas siguientes.
 *
 * Excluye montos <= 0 (trials/cortesías): no hay nada que cobrar, no son mora.
 */

import { inngest } from '@/lib/inngest/cliente';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { capturarMensaje } from '@/lib/observabilidad';

const TZ = 'America/Santiago';

function hoyEnSantiago(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export const jobMarcarMorosidad = inngest.createFunction(
  {
    id: 'plataforma/marcarMorosidad',
    name: 'Plataforma · Marcar morosidad de suscripción',
    triggers: [{ cron: '0 8 * * *' }],
    retries: 1,
  },
  async ({ step, logger, runId }) => {
    const hoy = hoyEnSantiago();

    // Marcar como 'vencido' los períodos pendientes cuya fecha de vencimiento ya
    // pasó y que tienen un monto cobrable. Devuelve las filas afectadas.
    const vencidos = await step.run('marcar-periodos-vencidos', async () => {
      const supabase = crearClienteServiceRole();

      const { data, error } = await supabase
        .schema('plataforma')
        .from('periodos_suscripcion')
        .update({ estado: 'vencido' })
        .eq('estado', 'pendiente')
        .lt('vence_en', hoy)
        .gt('monto_clp', 0)
        .select('id, tenant_id, monto_clp');

      if (error) throw new Error(`Error al marcar períodos vencidos: ${error.message}`);
      return data ?? [];
    });

    if (vencidos.length === 0) {
      logger.info('Morosidad: sin períodos nuevos por marcar.');
      return { resultado: 'sin_morosos', marcados: 0 };
    }

    // Alerta al super-admin (sin suspender — decisión de negocio).
    await step.run('alertar-morosidad', async () => {
      const montoTotal = vencidos.reduce((acc, p) => acc + Math.round(Number(p.monto_clp ?? 0)), 0);
      const tenantsAfectados = new Set(vencidos.map((p) => p.tenant_id as string)).size;
      await capturarMensaje(
        `Morosidad de suscripción: ${vencidos.length} período(s) vencido(s) e impago(s) ` +
          `en ${tenantsAfectados} courier(s), total ${montoTotal} CLP. La suspensión es manual.`,
        'warning',
        {
          origen: 'job:plataforma/marcarMorosidad',
          correlacionId: runId,
          etiquetas: { marcados: String(vencidos.length), tenants: String(tenantsAfectados) },
        },
      );
      return { alertado: true };
    });

    logger.info(`Morosidad: ${vencidos.length} período(s) marcado(s) 'vencido'.`);
    return { resultado: 'marcados', marcados: vencidos.length };
  },
);
