/**
 * Job · plataforma/notificarPagoConfirmado (F2 "Ola 3", ítem M).
 * =============================================================================
 * Trigger: evento `plataforma/pago.confirmado` (publicado por
 * `confirmarPeriodoPagado`, `plataforma/cobro.ts`, tras marcar el período
 * pagado — cubre tanto el cobro por link como el auto-cobro recurrente).
 *
 * Envía al dueño del courier un correo de "pago recibido / comprobante
 * disponible" vía el puerto de email (`integraciones/notificaciones/email`).
 *
 * Idempotencia:
 * - Dedup por bitácora (`plataforma.notificacion_pago_confirmado`,
 *   `entidadId = periodoId`, "alguna vez" — un período solo se paga una vez).
 * - El `id` del evento disparador YA es determinístico
 *   (`pago-confirmado-suscripcion-${periodoId}`), así que Inngest deduplica la
 *   ejecución completa del job para el mismo período.
 *
 * NO es una dependencia dura del camino crítico: el pago YA quedó confirmado
 * en BD antes de que este job corra (lo hizo `confirmarPeriodoPagado`). Un
 * fallo de envío en modo real lanza para que Inngest reintente (`retries`),
 * pero nunca puede revertir la confirmación del pago.
 */

import { inngest } from '@/lib/inngest/cliente';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import {
  resolverDestinatarioCourier,
  yaSeNotifico,
  registrarNotificacionEnviada,
  enviarNotificacionEmail,
  construirEmailPagoConfirmado,
} from '@/modules/plataforma/notificaciones';

const ACCION_BITACORA = 'plataforma.notificacion_pago_confirmado';

export const jobNotificarPagoConfirmado = inngest.createFunction(
  {
    id: 'plataforma/notificarPagoConfirmado',
    name: 'Plataforma · Notificar pago de suscripción confirmado',
    triggers: [{ event: 'plataforma/pago.confirmado' }],
    retries: 2,
  },
  async ({ event, step, logger }) => {
    const { tenantId, periodoId, montoClp } = event.data as {
      tenantId: string;
      suscripcionId: string;
      periodoId: string;
      montoClp: number;
      metodo: string;
      confirmadoEn: string;
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

      const contenido = construirEmailPagoConfirmado({
        nombreTenant: nombreTenant ?? 'tu courier',
        montoClp,
        periodoInicio: (periodo?.periodo_inicio as string | null) ?? '',
        periodoFin: (periodo?.periodo_fin as string | null) ?? '',
      });

      // Bitácora ANTES del efecto externo (envío) — dedup + auditoría.
      await registrarNotificacionEnviada(supabase, {
        tenantId,
        accion: ACCION_BITACORA,
        entidadTipo: 'periodo_suscripcion',
        entidadId: periodoId,
        detalle: { monto_clp: montoClp, email_resuelto: Boolean(email) },
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
      logger.info(`Pago confirmado del período ${periodoId}: notificación ya enviada. Omitiendo.`);
      return { resultado: 'deduplicado', periodoId };
    }

    const envio = resultado.envio;
    if (envio.modo === 'sin_destinatario') {
      logger.warn(`Pago confirmado del período ${periodoId}: sin destinatario resoluble para tenant ${tenantId}.`);
    } else if (envio.modo === 'real' && !envio.enviado) {
      // Falla real de envío → lanzar para que Inngest reintente (no revierte el pago, ya confirmado antes).
      throw new Error(`Fallo al enviar el correo de pago confirmado: ${envio.errorDescripcion ?? 'sin detalle'}`);
    } else {
      logger.info(`Pago confirmado del período ${periodoId}: notificación ${envio.modo} (enviado=${envio.enviado}).`);
    }

    return { resultado: 'procesado', periodoId };
  },
);
