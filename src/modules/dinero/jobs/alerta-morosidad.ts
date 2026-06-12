/**
 * Job · dinero/alertaMorosidad — cobranza vencida sin pago
 * =====================================================================
 * Trigger: Cron `0 9 * * *` (09:00 hora Santiago, todos los días)
 *
 * Responsabilidad (Decisión 6 del arquitecto, `docs/arquitectura/cobranza-fintoc.md`):
 * - Detectar períodos `facturado` con `estado_cobro = 'pendiente'` cuyo
 *   `fecha_fin` + N días ya venció (impagos vencidos).
 * - Registrar una alerta de morosidad en bitácora (máx. 1 por período por día).
 *
 * N (días de gracia hasta considerar morosidad) es parametrizable por env
 * (`DINERO_MOROSIDAD_DIAS`, default 30). No se sobre-diseña: cuando se quiera
 * por-tenant, se mueve a `config_periodos`. Hoy es un umbral global.
 *
 * NO va en `eventos_conciliacion` (esa tabla es para diferencias
 * entregado↔facturado, otra semántica y otra RLS). La morosidad es una
 * notificación, igual que `alerta-folios-proximos` / incidencias sin gestión.
 *
 * Idempotencia:
 * - Antes de insertar, verifica que no exista una alerta del mismo período
 *   con `accion = 'dinero.alerta_morosidad'` de hoy en la bitácora.
 *
 * SEGURIDAD:
 * - El log/bitácora incluye SOLO tenant_id, IDs y días de atraso — nunca datos
 *   de contraparte, secretos ni montos cruzados entre tenants.
 */

import { inngest } from '@/lib/inngest/cliente';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';

const TZ = 'America/Santiago';

/** Días de gracia tras `fecha_fin` antes de marcar morosidad (default 30). */
const DIAS_MOROSIDAD = (() => {
  const v = Number(process.env.DINERO_MOROSIDAD_DIAS);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 30;
})();

function hoyEnSantiago(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Días enteros entre dos fechas ISO (date), positivo si `hasta` > `desde`. */
function diasEntre(desdeIso: string, hastaIso: string): number {
  const desde = new Date(`${desdeIso}T00:00:00Z`).getTime();
  const hasta = new Date(`${hastaIso}T00:00:00Z`).getTime();
  return Math.round((hasta - desde) / (1000 * 60 * 60 * 24));
}

export const jobAlertaMorosidad = inngest.createFunction(
  {
    id: 'dinero/alertaMorosidad',
    name: 'Dinero · Alertar cobranza vencida sin pago (morosidad)',
    triggers: [{ cron: '0 9 * * *' }],
    retries: 1,
  },
  async ({ step, logger }) => {
    const hoy = hoyEnSantiago();

    // Paso 1: detectar períodos facturados, pendientes y vencidos (+N días).
    const vencidos = await step.run('detectar-morosos', async () => {
      const supabase = crearClienteServiceRole();

      const { data, error } = await supabase
        .schema('dinero')
        .from('periodos_cobro')
        .select('id, tenant_id, seller_id, fecha_fin, monto_total_clp, monto_pagado_clp')
        .eq('estado', 'facturado')
        .eq('estado_cobro', 'pendiente');

      if (error) throw new Error(`Error al leer periodos_cobro: ${error.message}`);

      // El "vencimiento" = fecha_fin + N días. Se filtra en TS porque Supabase JS
      // no permite expresiones calculadas en el WHERE.
      return (data ?? [])
        .map((p) => ({
          id: p.id as string,
          tenantId: p.tenant_id as string,
          sellerId: p.seller_id as string,
          fechaFin: p.fecha_fin as string,
          diasAtraso: diasEntre(p.fecha_fin as string, hoy) - DIAS_MOROSIDAD,
          saldoClp:
            Math.round(Number(p.monto_total_clp ?? 0)) -
            Math.round(Number(p.monto_pagado_clp ?? 0)),
        }))
        .filter((p) => p.diasAtraso > 0);
    });

    logger.info(`Períodos morosos (>${DIAS_MOROSIDAD} días tras fecha_fin): ${vencidos.length}`);

    if (vencidos.length === 0) {
      return { resultado: 'sin_morosos' };
    }

    // Paso 2: emitir alerta por período (máx. 1 por período por día).
    const alertasEmitidas = await step.run('emitir-alertas-morosidad', async () => {
      const supabase = crearClienteServiceRole();
      let emitidas = 0;

      for (const periodo of vencidos) {
        // ¿Ya se alertó este período hoy?
        const { data: alertaHoy } = await supabase
          .from('bitacora_auditoria')
          .select('id')
          .eq('tenant_id', periodo.tenantId)
          .eq('accion', 'dinero.alerta_morosidad')
          .eq('entidad_id', periodo.id)
          .gte('creado_en', `${hoy}T00:00:00`)
          .lte('creado_en', `${hoy}T23:59:59`)
          .limit(1)
          .maybeSingle();

        if (alertaHoy) {
          logger.info(`Período ${periodo.id}: morosidad ya alertada hoy. Omitiendo.`);
          continue;
        }

        // SOLO datos no sensibles: días de atraso y saldo del propio período.
        await registrarEnBitacora(supabase, {
          tenantId: periodo.tenantId,
          actorUsuarioId: null,
          actorTipo: 'sistema',
          accion: 'dinero.alerta_morosidad',
          entidadTipo: 'periodo_cobro',
          entidadId: periodo.id,
          detalle: {
            seller_id: periodo.sellerId,
            dias_atraso: periodo.diasAtraso,
            saldo_clp: periodo.saldoClp,
            dias_gracia: DIAS_MOROSIDAD,
          },
        });

        logger.warn(
          `Tenant ${periodo.tenantId}: período ${periodo.id} moroso ` +
            `(${periodo.diasAtraso} días de atraso tras la gracia).`,
        );

        emitidas++;
      }

      return emitidas;
    });

    logger.info(`Alertas de morosidad emitidas: ${alertasEmitidas}.`);

    return { alertasEmitidas, periodosMorosos: vencidos.length };
  },
);
