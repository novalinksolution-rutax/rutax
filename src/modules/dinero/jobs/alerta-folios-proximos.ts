/**
 * Job C7 · dinero/alertaFoliosProximos
 * =====================================================================
 * Trigger: Cron `0 9 * * *` (09:00 hora Santiago, todos los días)
 *
 * Responsabilidad:
 * - Leer `identidad.folios_caf WHERE estado = 'vigente' AND (folio_hasta - folio_actual) < 50`.
 * - Insertar una alerta en bitácora (máx. 1 alerta por tenant por día).
 *
 * Idempotencia:
 * - Antes de insertar, verificar que no existe una alerta del mismo tenant
 *   con `accion = 'dinero.alerta_folios_proximos'` de hoy en la bitácora.
 *
 * SEGURIDAD:
 * - El log incluye SOLO: tenant_id, folios_restantes, folio_hasta.
 * - NUNCA el certificado digital, credenciales, ni datos del CAF sensibles.
 */

import { inngest } from '@/lib/inngest/cliente';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';

const TZ = 'America/Santiago';
const UMBRAL_FOLIOS = 50;

function hoyEnSantiago(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export const jobAlertaFoliosProximos = inngest.createFunction(
  {
    id: 'dinero/alertaFoliosProximos',
    name: 'Dinero · Alertar folios CAF próximos a agotarse',
    triggers: [{ cron: '0 9 * * *' }],
    retries: 1,
  },
  async ({ step, logger }) => {
    // Paso 1: Detectar CAFs con folios próximos a agotarse.
    const cafsProximos = await step.run('detectar-folios-proximos', async () => {
      const supabase = crearClienteServiceRole();

      const { data, error } = await supabase
        .schema('identidad')
        .from('folios_caf')
        .select('id, tenant_id, folio_actual, folio_hasta')
        .eq('estado', 'vigente');

      if (error) throw new Error(`Error al leer folios_caf: ${error.message}`);

      // Filtrar en TypeScript (Supabase JS no soporta expresiones calculadas en WHERE).
      return (data ?? []).filter(
        (caf) => (Number(caf.folio_hasta) - Number(caf.folio_actual)) < UMBRAL_FOLIOS,
      );
    });

    logger.info(`CAFs con folios próximos a agotarse: ${cafsProximos.length}`);

    if (cafsProximos.length === 0) {
      return { resultado: 'sin_folios_proximos' };
    }

    // Paso 2: Insertar alerta por cada CAF (máx. 1 alerta por tenant por día).
    const alertasEmitidas = await step.run('emitir-alertas', async () => {
      const supabase = crearClienteServiceRole();
      const hoy = hoyEnSantiago();
      let emitidas = 0;

      for (const caf of cafsProximos) {
        const tenantId = caf.tenant_id as string;
        const folioActual = Number(caf.folio_actual);
        const folioHasta = Number(caf.folio_hasta);
        const foliosRestantes = folioHasta - folioActual;

        // Verificar que no existe alerta del mismo tenant de hoy.
        const { data: alertaHoy } = await supabase
          .from('bitacora_auditoria')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('accion', 'dinero.alerta_folios_proximos')
          .gte('creado_en', `${hoy}T00:00:00`)
          .lte('creado_en', `${hoy}T23:59:59`)
          .limit(1)
          .maybeSingle();

        if (alertaHoy) {
          logger.info(`Tenant ${tenantId}: alerta de folios ya emitida hoy. Omitiendo.`);
          continue;
        }

        // Insertar alerta en bitácora.
        // SOLO datos no sensibles: tenant_id, folios_restantes, folio_hasta.
        // NUNCA certificado, credenciales, ni valor del CAF.
        await registrarEnBitacora(supabase, {
          tenantId,
          actorUsuarioId: null,
          actorTipo: 'sistema',
          accion: 'dinero.alerta_folios_proximos',
          entidadTipo: 'folios_caf',
          entidadId: caf.id as string,
          detalle: {
            folios_restantes: foliosRestantes,
            folio_hasta: folioHasta,
            // tenant_id ya está en el campo principal — no duplicar
          },
        });

        logger.warn(
          `Tenant ${tenantId}: folios CAF próximos a agotarse. ` +
          `Restantes: ${foliosRestantes} (hasta folio ${folioHasta}).`,
        );

        emitidas++;
      }

      return emitidas;
    });

    logger.info(`Alertas de folios emitidas: ${alertasEmitidas}.`);

    return { alertasEmitidas, cafsProximos: cafsProximos.length };
  },
);
