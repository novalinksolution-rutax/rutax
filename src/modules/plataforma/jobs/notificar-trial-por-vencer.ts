/**
 * Job · plataforma/notificarTrialPorVencer (F2 "Ola 3", ítem M/E).
 * =============================================================================
 * Trigger: evento `plataforma/trial.por-vencer` (publicado por el cron
 * `jobs/vigilar-trials.ts`, una vez por suscripción cuando faltan
 * `UMBRAL_ALERTA_TRIAL_DIAS` días para `trial_hasta`).
 *
 * Envía al dueño del courier un correo de "tu prueba vence pronto".
 *
 * Idempotencia:
 * - El productor ya emite el evento con `id` determinístico por día
 *   (`trial-por-vencer-${suscripcionId}-${hoy}`).
 * - Dedup adicional por bitácora, acotado al día (`soloHoy: true`) — defensa
 *   en profundidad, mismo patrón que `conexion-caida.ts`.
 */

import { inngest } from '@/lib/inngest/cliente';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import {
  resolverDestinatarioCourier,
  yaSeNotifico,
  registrarNotificacionEnviada,
  enviarNotificacionEmail,
  construirEmailTrialPorVencer,
} from '@/modules/plataforma/notificaciones';

const ACCION_BITACORA = 'plataforma.notificacion_trial_por_vencer';

export const jobNotificarTrialPorVencer = inngest.createFunction(
  {
    id: 'plataforma/notificarTrialPorVencer',
    name: 'Plataforma · Notificar trial por vencer',
    triggers: [{ event: 'plataforma/trial.por-vencer' }],
    retries: 2,
  },
  async ({ event, step, logger }) => {
    const { tenantId, suscripcionId, trialHasta, diasRestantes } = event.data as {
      tenantId: string;
      suscripcionId: string;
      trialHasta: string;
      diasRestantes: number;
    };

    const resultado = await step.run('resolver-y-enviar', async () => {
      const supabase = crearClienteServiceRole();

      if (
        await yaSeNotifico(supabase, {
          tenantId,
          accion: ACCION_BITACORA,
          entidadId: suscripcionId,
          soloHoy: true,
        })
      ) {
        return { resultado: 'deduplicado' as const };
      }

      const { email, nombreTenant } = await resolverDestinatarioCourier(supabase, tenantId);

      const contenido = construirEmailTrialPorVencer({
        nombreTenant: nombreTenant ?? 'tu courier',
        trialHasta,
        diasRestantes,
      });

      await registrarNotificacionEnviada(supabase, {
        tenantId,
        accion: ACCION_BITACORA,
        entidadTipo: 'suscripcion',
        entidadId: suscripcionId,
        detalle: { trial_hasta: trialHasta, dias_restantes: diasRestantes, email_resuelto: Boolean(email) },
      });

      const envio = await enviarNotificacionEmail({
        para: email,
        asunto: contenido.asunto,
        html: contenido.html,
        texto: contenido.texto,
      });

      return { resultado: 'procesado' as const, envio };
    });

    if (resultado.resultado === 'deduplicado') {
      logger.info(`Trial por vencer de suscripción ${suscripcionId}: notificación ya enviada hoy. Omitiendo.`);
      return { resultado: 'deduplicado', suscripcionId };
    }

    const envio = resultado.envio;
    if (envio.modo === 'sin_destinatario') {
      logger.warn(`Trial por vencer de suscripción ${suscripcionId}: sin destinatario resoluble para tenant ${tenantId}.`);
    } else if (envio.modo === 'real' && !envio.enviado) {
      throw new Error(`Fallo al enviar el correo de trial por vencer: ${envio.errorDescripcion ?? 'sin detalle'}`);
    } else {
      logger.info(`Trial por vencer de suscripción ${suscripcionId}: notificación ${envio.modo} (enviado=${envio.enviado}).`);
    }

    return { resultado: 'procesado', suscripcionId };
  },
);
