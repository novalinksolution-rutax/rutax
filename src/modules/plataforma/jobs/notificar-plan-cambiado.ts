/**
 * Job · plataforma/notificarPlanCambiado (F2 "Ola 3", ítem M).
 * =============================================================================
 * Trigger: evento `plataforma/plan.cambiado` — publicado en el momento en que
 * el cambio de plan/periodicidad se vuelve EFECTIVO (inmediato para upgrade,
 * desde `cambiarPlanCourier`; diferido para downgrade/periodicidad, desde
 * `jobs/aplicar-cambios-plan.ts` cuando el cron lo aplica). Ver el JSDoc del
 * evento en `src/lib/inngest/eventos.ts`.
 *
 * Envía al dueño del courier un correo de confirmación del cambio.
 *
 * Idempotencia:
 * - El productor emite el evento con `id` determinístico (por suscripción +
 *   plan destino + día para el caso inmediato; por suscripción + día para el
 *   caso diferido) — ver los puntos de emisión.
 * - Dedup adicional por bitácora, `entidadId = suscripcionId` (columna `uuid`
 *   en `bitacora_auditoria` — NO se puede componer con el plan destino ahí),
 *   acotado al día (`soloHoy: true`). Trade-off aceptado: si el MISMO courier
 *   hiciera dos cambios de plan reales el mismo día, solo el primero dispara
 *   correo (el segundo se deduplica) — caso raro, y el courier de todas formas
 *   ve la confirmación en pantalla al hacer el cambio.
 */

import { inngest } from '@/lib/inngest/cliente';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import {
  resolverDestinatarioCourier,
  yaSeNotifico,
  registrarNotificacionEnviada,
  enviarNotificacionEmail,
  construirEmailPlanCambiado,
} from '@/modules/plataforma/notificaciones';

const ACCION_BITACORA = 'plataforma.notificacion_plan_cambiado';

export const jobNotificarPlanCambiado = inngest.createFunction(
  {
    id: 'plataforma/notificarPlanCambiado',
    name: 'Plataforma · Notificar cambio de plan',
    triggers: [{ event: 'plataforma/plan.cambiado' }],
    retries: 2,
  },
  async ({ event, step, logger }) => {
    const { tenantId, suscripcionId, planHaciaId, tipo, montoAjusteClp, efectivoDesde } = event.data as {
      tenantId: string;
      suscripcionId: string;
      planDesdeId: string;
      planHaciaId: string;
      tipo: 'upgrade' | 'downgrade' | 'periodicidad';
      periodicidadDesde: 'mensual' | 'anual';
      periodicidadHacia: 'mensual' | 'anual';
      montoAjusteClp: number | null;
      efectivoDesde: string;
      actorUsuarioId: string | null;
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

      const contenido = construirEmailPlanCambiado({
        nombreTenant: nombreTenant ?? 'tu courier',
        tipo,
        montoAjusteClp,
        efectivoDesde,
      });

      await registrarNotificacionEnviada(supabase, {
        tenantId,
        accion: ACCION_BITACORA,
        entidadTipo: 'suscripcion',
        entidadId: suscripcionId,
        detalle: { plan_hacia_id: planHaciaId, tipo, monto_ajuste_clp: montoAjusteClp, email_resuelto: Boolean(email) },
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
      logger.info(`Plan cambiado de suscripción ${suscripcionId}: notificación ya enviada hoy. Omitiendo.`);
      return { resultado: 'deduplicado', suscripcionId };
    }

    const envio = resultado.envio;
    if (envio.modo === 'sin_destinatario') {
      logger.warn(`Plan cambiado de suscripción ${suscripcionId}: sin destinatario resoluble para tenant ${tenantId}.`);
    } else if (envio.modo === 'real' && !envio.enviado) {
      throw new Error(`Fallo al enviar el correo de cambio de plan: ${envio.errorDescripcion ?? 'sin detalle'}`);
    } else {
      logger.info(`Plan cambiado de suscripción ${suscripcionId}: notificación ${envio.modo} (enviado=${envio.enviado}).`);
    }

    return { resultado: 'procesado', suscripcionId };
  },
);
