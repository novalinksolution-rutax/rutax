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
 * F2 "Ola 3" ítem F (dunning) agrega: al marcar un período `vencido` por
 * PRIMERA vez, envía al courier un correo recordatorio ("tu suscripción venció
 * sin pago") — dedup "alguna vez" por período (un período solo vence una vez).
 * El REINTENTO del auto-cobro y el escalamiento por gracia agotada viven en
 * `jobs/reintentar-cobro-vencido.ts` (cron aparte, corre justo después).
 *
 * Idempotente: el UPDATE con WHERE estado='pendiente' no re-afecta filas ya
 * marcadas 'vencido' en corridas siguientes — por lo mismo, el correo
 * recordatorio solo se intenta para las filas RECIÉN marcadas en esta corrida.
 *
 * Excluye montos <= 0 (trials/cortesías): no hay nada que cobrar, no son mora.
 */

import { inngest } from '@/lib/inngest/cliente';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { capturarMensaje } from '@/lib/observabilidad';
import {
  resolverDestinatarioCourier,
  yaSeNotifico,
  registrarNotificacionEnviada,
  enviarNotificacionEmail,
  construirEmailPeriodoVencido,
} from '@/modules/plataforma/notificaciones';

const ACCION_NOTIFICACION_VENCIDO = 'plataforma.notificacion_periodo_vencido';

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
        .select('id, tenant_id, monto_clp, periodo_inicio, periodo_fin');

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

    // Recordatorio por email al courier — una vez por período (F2 "Ola 3", ítem F).
    const notificados = await step.run('notificar-periodos-vencidos', async () => {
      const supabase = crearClienteServiceRole();
      let enviados = 0;

      for (const periodo of vencidos) {
        const periodoId = periodo.id as string;
        const tenantId = periodo.tenant_id as string;

        if (await yaSeNotifico(supabase, { tenantId, accion: ACCION_NOTIFICACION_VENCIDO, entidadId: periodoId })) {
          continue;
        }

        const { email, nombreTenant } = await resolverDestinatarioCourier(supabase, tenantId);
        const contenido = construirEmailPeriodoVencido({
          nombreTenant: nombreTenant ?? 'tu courier',
          montoClp: Math.round(Number(periodo.monto_clp ?? 0)),
          periodoInicio: (periodo.periodo_inicio as string | null) ?? '',
          periodoFin: (periodo.periodo_fin as string | null) ?? '',
        });

        await registrarNotificacionEnviada(supabase, {
          tenantId,
          accion: ACCION_NOTIFICACION_VENCIDO,
          entidadTipo: 'periodo_suscripcion',
          entidadId: periodoId,
          detalle: { monto_clp: periodo.monto_clp, email_resuelto: Boolean(email) },
        });

        const envio = await enviarNotificacionEmail({
          para: email,
          asunto: contenido.asunto,
          html: contenido.html,
          texto: contenido.texto,
        });

        if (envio.modo === 'real' && !envio.enviado) {
          logger.warn(`Recordatorio de período vencido ${periodoId}: fallo de envío (${envio.errorDescripcion}).`);
        } else if (envio.enviado) {
          enviados++;
        }
      }

      return enviados;
    });

    logger.info(`Morosidad: ${vencidos.length} período(s) marcado(s) 'vencido', ${notificados} recordatorio(s) enviado(s).`);
    return { resultado: 'marcados', marcados: vencidos.length, recordatoriosEnviados: notificados };
  },
);
