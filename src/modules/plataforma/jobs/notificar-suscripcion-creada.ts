/**
 * Job · plataforma/notificarSuscripcionCreada (F2 "Ola 3", ítem M — opcional).
 * =============================================================================
 * Trigger: evento `plataforma/suscripcion.creada` (publicado por
 * `crearSuscripcionInicial`, `plataforma/superficie-courier.ts`, origen
 * `self_serve`).
 *
 * Envía al dueño del courier un correo de bienvenida ("tu prueba empezó").
 * Barato: una sola escritura + un envío por alta de courier.
 *
 * Idempotencia:
 * - El productor ya emite el evento con `id` determinístico
 *   (`suscripcion-creada-${suscripcionId}`).
 * - Dedup adicional por bitácora ("alguna vez" — una suscripción se crea una
 *   sola vez).
 */

import { inngest } from '@/lib/inngest/cliente';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import {
  resolverDestinatarioCourier,
  yaSeNotifico,
  registrarNotificacionEnviada,
  enviarNotificacionEmail,
  construirEmailSuscripcionCreada,
} from '@/modules/plataforma/notificaciones';

const ACCION_BITACORA = 'plataforma.notificacion_suscripcion_creada';

export const jobNotificarSuscripcionCreada = inngest.createFunction(
  {
    id: 'plataforma/notificarSuscripcionCreada',
    name: 'Plataforma · Notificar suscripción creada (bienvenida)',
    triggers: [{ event: 'plataforma/suscripcion.creada' }],
    retries: 2,
  },
  async ({ event, step, logger }) => {
    const { tenantId, suscripcionId, trialHasta } = event.data as {
      tenantId: string;
      suscripcionId: string;
      planId: string;
      estado: 'trial' | 'activa';
      trialHasta: string | null;
      origen: 'self_serve' | 'super_admin';
    };

    const resultado = await step.run('resolver-y-enviar', async () => {
      const supabase = crearClienteServiceRole();

      if (await yaSeNotifico(supabase, { tenantId, accion: ACCION_BITACORA, entidadId: suscripcionId })) {
        return { resultado: 'deduplicado' as const };
      }

      const { email, nombreTenant } = await resolverDestinatarioCourier(supabase, tenantId);

      const contenido = construirEmailSuscripcionCreada({
        nombreTenant: nombreTenant ?? 'tu courier',
        trialHasta,
      });

      await registrarNotificacionEnviada(supabase, {
        tenantId,
        accion: ACCION_BITACORA,
        entidadTipo: 'suscripcion',
        entidadId: suscripcionId,
        detalle: { trial_hasta: trialHasta, email_resuelto: Boolean(email) },
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
      logger.info(`Suscripción ${suscripcionId} creada: notificación de bienvenida ya enviada. Omitiendo.`);
      return { resultado: 'deduplicado', suscripcionId };
    }

    const envio = resultado.envio;
    if (envio.modo === 'sin_destinatario') {
      logger.warn(`Suscripción ${suscripcionId} creada: sin destinatario resoluble para tenant ${tenantId}.`);
    } else if (envio.modo === 'real' && !envio.enviado) {
      throw new Error(`Fallo al enviar el correo de bienvenida: ${envio.errorDescripcion ?? 'sin detalle'}`);
    } else {
      logger.info(`Suscripción ${suscripcionId} creada: notificación ${envio.modo} (enviado=${envio.enviado}).`);
    }

    return { resultado: 'procesado', suscripcionId };
  },
);
