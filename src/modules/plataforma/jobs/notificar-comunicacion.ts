/**
 * Job · plataforma/notificarComunicacion (F3 · Gap 7 — comunicaciones a couriers).
 * =============================================================================
 * Trigger: evento `plataforma/comunicacion.publicada` (publicado EXCLUSIVAMENTE
 * por `crearComunicacion`, `plataforma/comunicaciones.ts`, cuando la comunicación
 * se creó con `enviarEmail=true`).
 *
 * Hace el FAN-OUT: envía el correo de la comunicación al dueño de CADA courier
 * activo (excluye tenants `suspendido`, mismo criterio que el watchdog de
 * integridad — `jobs/verificar-salud.ts`). El banner in-app NO depende de este
 * job (lo resuelve `obtenerComunicacionesActivasParaCourier` directo en cada
 * render del layout `(tenant)`); este job es solo el broadcast por correo.
 *
 * Idempotencia:
 * - El productor emite el evento con `id` determinístico
 *   (`comunicacion-publicada-${comunicacionId}`) — una comunicación nunca
 *   dispara dos veces el mismo evento.
 * - Dedup POR TENANT vía bitácora ("alguna vez" — `yaSeNotifico`, sin
 *   `soloHoy`): cada courier recibe el correo de una comunicación dada una
 *   sola vez, incluso si el job se reintenta.
 * - Un fallo al notificar a un courier NO bloquea a los demás
 *   (`Promise.allSettled`, mismo patrón que `jobs/generar-periodos.ts` /
 *   `jobs/verificar-salud.ts`).
 */

import { inngest } from '@/lib/inngest/cliente';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import {
  resolverDestinatarioCourier,
  yaSeNotifico,
  registrarNotificacionEnviada,
  enviarNotificacionEmail,
  construirEmailComunicacion,
} from '@/modules/plataforma/notificaciones';

const ACCION_BITACORA = 'plataforma.notificacion_comunicacion';

type ResultadoTenant = 'enviado' | 'deduplicado' | 'sin_destinatario';

export const jobNotificarComunicacion = inngest.createFunction(
  {
    id: 'plataforma/notificarComunicacion',
    name: 'Plataforma · Notificar comunicación (broadcast a couriers)',
    triggers: [{ event: 'plataforma/comunicacion.publicada' }],
    retries: 2,
  },
  async ({ event, step, logger }) => {
    const { comunicacionId, titulo, cuerpo } = event.data as {
      comunicacionId: string;
      titulo: string;
      cuerpo: string;
      tipo: 'info' | 'mantencion' | 'novedad' | 'alerta';
      nivel: 'informativo' | 'importante' | 'urgente';
    };

    const resumen = await step.run('broadcast-couriers', async () => {
      const supabase = crearClienteServiceRole();

      const { data: tenants, error: errTenants } = await supabase
        .schema('identidad')
        .from('tenants')
        .select('id')
        .neq('estado', 'suspendido');
      if (errTenants) throw new Error(`Error al listar tenants: ${errTenants.message}`);

      const listaTenants = tenants ?? [];
      if (listaTenants.length === 0) {
        return { enviados: 0, deduplicados: 0, sinDestinatario: 0, errores: 0, totalTenants: 0 };
      }

      const resultados = await Promise.allSettled(
        listaTenants.map(async (t): Promise<ResultadoTenant> => {
          const tenantId = t.id as string;

          if (await yaSeNotifico(supabase, { tenantId, accion: ACCION_BITACORA, entidadId: comunicacionId })) {
            return 'deduplicado';
          }

          const { email, nombreTenant } = await resolverDestinatarioCourier(supabase, tenantId);

          const contenido = construirEmailComunicacion({
            nombreTenant: nombreTenant ?? 'tu courier',
            titulo,
            cuerpo,
          });

          // Bitácora ANTES del envío (RNF-04 / patrón del proyecto) — marca de
          // deduplicación para la próxima corrida, aunque el envío falle después.
          await registrarNotificacionEnviada(supabase, {
            tenantId,
            accion: ACCION_BITACORA,
            entidadTipo: 'comunicacion',
            entidadId: comunicacionId,
            detalle: { titulo, email_resuelto: Boolean(email) },
          });

          const envio = await enviarNotificacionEmail({
            para: email,
            asunto: contenido.asunto,
            html: contenido.html,
            texto: contenido.texto,
          });

          if (envio.modo === 'sin_destinatario') return 'sin_destinatario';
          if (envio.modo === 'real' && !envio.enviado) {
            throw new Error(`tenant ${tenantId}: ${envio.errorDescripcion ?? 'fallo de envío sin detalle'}`);
          }
          return 'enviado';
        }),
      );

      let enviados = 0;
      let deduplicados = 0;
      let sinDestinatario = 0;
      let errores = 0;
      for (const r of resultados) {
        if (r.status === 'fulfilled') {
          if (r.value === 'enviado') enviados++;
          else if (r.value === 'deduplicado') deduplicados++;
          else sinDestinatario++;
        } else {
          errores++;
        }
      }

      return { enviados, deduplicados, sinDestinatario, errores, totalTenants: listaTenants.length };
    });

    logger.info(
      `Comunicación ${comunicacionId}: ${resumen.totalTenants} courier(s) — ` +
        `enviados=${resumen.enviados} deduplicados=${resumen.deduplicados} ` +
        `sin_destinatario=${resumen.sinDestinatario} errores=${resumen.errores}`,
    );

    if (resumen.errores > 0) {
      throw new Error(`Comunicación ${comunicacionId}: ${resumen.errores} error(es) al notificar couriers (ver logs).`);
    }

    return resumen;
  },
);
