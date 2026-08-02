/**
 * Job · plataforma/notificarCobroFallido (F2 "Ola 3", ítem M).
 * =============================================================================
 * Trigger: evento `plataforma/cobro.fallido` (publicado por
 * `ejecutarYPersistirAutoCobro`, compartido entre el auto-cobro disparado por
 * `plataforma/suscripcion.periodo-generado` y el cron de reintento de dunning
 * `plataforma/reintentarCobroVencido`, `jobs/cobrar-periodo-auto.ts`).
 *
 * Envía al dueño del courier un correo de "no pudimos cobrar tu suscripción".
 *
 * DEDUP DELIBERADO "ALGUNA VEZ" (no por día): se notifica UNA sola vez por
 * período, aunque el dunning reintente el cobro varios días después y vuelva a
 * fallar — evita spamear al courier con un correo por cada reintento. Los
 * reintentos posteriores solo escalan internamente (alerta al super-admin
 * cuando se agota la gracia, ver `jobs/reintentar-cobro-vencido.ts`), no
 * generan un correo nuevo al courier.
 *
 * NO es una dependencia dura del camino crítico: el estado del pago YA quedó
 * persistido en BD antes de que este job corra.
 */

import { inngest } from '@/lib/inngest/cliente';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import {
  resolverDestinatarioCourier,
  yaSeNotifico,
  registrarNotificacionEnviada,
  enviarNotificacionEmail,
  construirEmailCobroFallido,
} from '@/modules/plataforma/notificaciones';

const ACCION_BITACORA = 'plataforma.notificacion_cobro_fallido';

export const jobNotificarCobroFallido = inngest.createFunction(
  {
    id: 'plataforma/notificarCobroFallido',
    name: 'Plataforma · Notificar cobro de suscripción fallido',
    triggers: [{ event: 'plataforma/cobro.fallido' }],
    retries: 2,
  },
  async ({ event, step, logger }) => {
    const { tenantId, periodoId, montoClp, reintentable } = event.data as {
      tenantId: string;
      suscripcionId: string;
      periodoId: string;
      montoClp: number;
      motivoSaneado: string | null;
      reintentable: boolean;
    };

    const resultado = await step.run('resolver-y-enviar', async () => {
      const supabase = crearClienteServiceRole();

      if (await yaSeNotifico(supabase, { tenantId, accion: ACCION_BITACORA, entidadId: periodoId })) {
        return { resultado: 'deduplicado' as const };
      }

      const { data: periodo } = await supabase
        .schema('plataforma')
        .from('periodos_suscripcion')
        .select('periodo_inicio, periodo_fin')
        .eq('id', periodoId)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      const { email, nombreTenant } = await resolverDestinatarioCourier(supabase, tenantId);

      const contenido = construirEmailCobroFallido({
        nombreTenant: nombreTenant ?? 'tu courier',
        montoClp,
        periodoInicio: (periodo?.periodo_inicio as string | null) ?? '',
        periodoFin: (periodo?.periodo_fin as string | null) ?? '',
        reintentable,
      });

      await registrarNotificacionEnviada(supabase, {
        tenantId,
        accion: ACCION_BITACORA,
        entidadTipo: 'periodo_suscripcion',
        entidadId: periodoId,
        detalle: { monto_clp: montoClp, reintentable, email_resuelto: Boolean(email) },
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
      logger.info(`Cobro fallido del período ${periodoId}: notificación ya enviada. Omitiendo.`);
      return { resultado: 'deduplicado', periodoId };
    }

    const envio = resultado.envio;
    if (envio.modo === 'sin_destinatario') {
      logger.warn(`Cobro fallido del período ${periodoId}: sin destinatario resoluble para tenant ${tenantId}.`);
    } else if (envio.modo === 'real' && !envio.enviado) {
      throw new Error(`Fallo al enviar el correo de cobro fallido: ${envio.errorDescripcion ?? 'sin detalle'}`);
    } else {
      logger.info(`Cobro fallido del período ${periodoId}: notificación ${envio.modo} (enviado=${envio.enviado}).`);
    }

    return { resultado: 'procesado', periodoId };
  },
);
