/**
 * Job · `identidad/alertaCertificadoPorVencer`
 * =============================================================================
 * Cron `0 9 * * *` — 09:00 de Santiago, todos los días. Misma hora que la
 * alerta de folios, a propósito: son las dos cosas que **detienen la
 * facturación**, y el courier las revisa en el mismo momento del día.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ EXISTE
 * -----------------------------------------------------------------------------
 * `identidad.courier_config_dte.certificado_vence_en` estaba escrito y **nadie
 * lo miraba**. El certificado digital vence una vez al año, sin aviso previo de
 * nadie, y el día que vence el courier **deja de poder emitir facturas** — se
 * entera cuando intenta cerrar un período y el DTE falla.
 *
 * -----------------------------------------------------------------------------
 * TRES AVISOS Y NO UNO
 * -----------------------------------------------------------------------------
 * A 30, 7 y 1 día. No es insistencia: **renovar un certificado no es inmediato**
 * —lo emite un proveedor acreditado y hay que pagarlo, validar identidad y
 * descargarlo— así que un solo aviso a 7 días llega tarde para quien tiene que
 * hacer un trámite. El de 30 es para empezarlo, el de 7 para acordarse, y el de
 * 1 es el último antes de quedarse sin facturar.
 *
 * Y **uno más el día que ya venció**, que dice otra cosa: no «va a pasar» sino
 * «ya pasó y no puedes emitir».
 *
 * -----------------------------------------------------------------------------
 * LA DEDUPLICACIÓN ES POR HITO, NO POR DÍA
 * -----------------------------------------------------------------------------
 * ⚠️ La alerta de folios dedupea «una por tenant por día» porque su condición se
 * mantiene: mientras queden pocos folios, todos los días hay algo que avisar.
 * Acá es al revés — la condición se cumple **un día concreto** por hito— así que
 * la bitácora se consulta por el hito exacto (`dias_restantes` en el detalle).
 * Con la deduplicación por día, un tenant con dos configuraciones —imposible
 * hoy, la tabla tiene PK por tenant— o un reintento del cron a otra hora
 * mandarían el mismo aviso dos veces.
 */

import { inngest } from '@/lib/inngest/cliente';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import {
  enviarNotificacionEmail,
  resolverDestinatarioCourier,
} from '@/modules/plataforma/notificaciones';
import { construirEmailCertificadoPorVencer } from '@/modules/dinero/notificaciones-dinero';
import { resolverUrlBaseApp } from '@/modules/identidad/enlace-invitacion';
import { hoyEnSantiago } from '@/lib/fecha-santiago';

/** Los hitos, en días. El 0 es «ya venció» y dice otra cosa. */
export const HITOS_AVISO = [30, 7, 1, 0] as const;

/**
 * Cuántos días faltan, contando días CIVILES de Santiago.
 *
 * ⚠️ Las dos fechas son civiles (`YYYY-MM-DD`) y se convierten a UTC a mediodía
 * antes de restar. Sin el mediodía, el cambio de horario de verano —que mueve el
 * reloj una hora— puede dar 29,96 días donde hay 30, y `Math.floor` devolvería
 * 29: el aviso del hito 30 no saldría nunca.
 */
export function diasHasta(vence: string, hoy: string): number {
  const aUtcMediodia = (f: string) => {
    const [a, m, d] = f.slice(0, 10).split('-').map(Number);
    return Date.UTC(a, m - 1, d, 12, 0, 0);
  };
  return Math.round((aUtcMediodia(vence) - aUtcMediodia(hoy)) / 86_400_000);
}

/**
 * El hito que le corresponde a un plazo, o `null` si hoy no toca avisar.
 *
 * **Solo el día exacto.** Un `<=` haría que a partir del día 30 se avisara todos
 * los días, y treinta correos seguidos enseñan a archivar sin leer — que es
 * justo lo que no puede pasar con el último.
 */
export function hitoDe(diasRestantes: number): number | null {
  if (diasRestantes <= 0) return 0;
  return HITOS_AVISO.includes(diasRestantes as (typeof HITOS_AVISO)[number])
    ? diasRestantes
    : null;
}

export const jobAlertaCertificadoPorVencer = inngest.createFunction(
  {
    id: 'identidad/alertaCertificadoPorVencer',
    name: 'Identidad · Alertar certificado digital por vencer',
    triggers: [{ cron: '0 9 * * *' }],
    retries: 1,
  },
  async ({ step, logger }) => {
    const hoy = hoyEnSantiago();

    const porVencer = await step.run('detectar-certificados-por-vencer', async () => {
      const supabase = crearClienteServiceRole();
      const { data, error } = await supabase
        .schema('identidad')
        .from('courier_config_dte')
        .select('tenant_id, certificado_vence_en')
        .not('certificado_vence_en', 'is', null);

      if (error) throw new Error(`Error al leer courier_config_dte: ${error.message}`);

      // El filtro va en TypeScript porque depende de una diferencia de fechas
      // civiles, que PostgREST no sabe expresar sin una vista.
      return (data ?? [])
        .map((c) => {
          const dias = diasHasta(c.certificado_vence_en as string, hoy);
          return {
            tenantId: c.tenant_id as string,
            vence: c.certificado_vence_en as string,
            dias,
            hito: hitoDe(dias),
          };
        })
        .filter((c) => c.hito !== null);
    });

    logger.info(`Certificados con aviso hoy: ${porVencer.length}`);
    if (porVencer.length === 0) return { resultado: 'sin_avisos' };

    const avisados = await step.run('avisar', async () => {
      const supabase = crearClienteServiceRole();
      const base = resolverUrlBaseApp();
      let enviados = 0;

      for (const c of porVencer) {
        // Deduplicación POR HITO: se busca si ya se avisó este mismo hito para
        // este tenant, sin ventana de tiempo. Un certificado que se renueva y
        // vuelve a acercarse tiene otra fecha de vencimiento, así que el hito
        // vuelve a ser legítimo — y por eso el detalle lleva también la fecha.
        const { data: yaAvisado } = await supabase
          .from('bitacora_auditoria')
          .select('id')
          .eq('tenant_id', c.tenantId)
          .eq('accion', 'identidad.alerta_certificado_por_vencer')
          .contains('detalle', { hito: c.hito, vence_en: c.vence })
          .limit(1)
          .maybeSingle();

        if (yaAvisado) {
          logger.info(`Tenant ${c.tenantId}: hito ${c.hito} ya avisado. Omitiendo.`);
          continue;
        }

        // Bitácora ANTES del correo (invariante de CLAUDE.md): si el envío
        // falla, tiene que quedar registrado que la condición se cumplió.
        // SOLO datos no sensibles: nunca el certificado ni su referencia.
        await registrarEnBitacora(supabase, {
          tenantId: c.tenantId,
          actorUsuarioId: null,
          actorTipo: 'sistema',
          accion: 'identidad.alerta_certificado_por_vencer',
          entidadTipo: 'courier_config_dte',
          entidadId: c.tenantId,
          detalle: { hito: c.hito, vence_en: c.vence, dias_restantes: c.dias },
        });

        try {
          const destinatario = await resolverDestinatarioCourier(supabase, c.tenantId);
          const contenido = construirEmailCertificadoPorVencer({
            nombreCourier: destinatario.nombreTenant ?? 'tu courier',
            diasRestantes: Math.max(0, c.dias),
            fechaVencimiento: c.vence,
            urlCertificado: base ? `${base}/configuracion/facturacion` : null,
          });
          const envio = await enviarNotificacionEmail({
            para: destinatario.email,
            asunto: contenido.asunto,
            html: contenido.html,
            texto: contenido.texto,
          });
          if (envio.enviado) enviados++;
          else {
            logger.warn(
              `Tenant ${c.tenantId}: alerta de certificado registrada pero NO enviada ` +
                `(modo=${envio.modo}).`,
            );
          }
        } catch (err) {
          logger.warn(
            `Tenant ${c.tenantId}: falló el correo de certificado — ` +
              `${err instanceof Error ? err.message : 'error desconocido'}. La alerta quedó en bitácora.`,
          );
        }
      }

      return enviados;
    });

    logger.info(`Alertas de certificado enviadas: ${avisados} de ${porVencer.length}.`);
    return { avisados, detectados: porVencer.length };
  },
);
