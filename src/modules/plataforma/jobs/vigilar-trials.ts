/**
 * Job · plataforma/vigilarTrials (F2 "Ola 3", ítem E — ciclo de vida del trial).
 * =============================================================================
 * Trigger: Cron `0 11 * * *` (11:00 hora Santiago, diario) — horario propio,
 * distinto de `aplicarCambiosPlan` (05:00), `generarPeriodos` (06:00) y
 * `marcarMorosidad` (08:00), para no competir por los mismos recursos.
 *
 * Cubre DOS responsabilidades del ciclo de vida del trial:
 *
 *  A. PRODUCTOR de `plataforma/trial.por-vencer` — para cada suscripción
 *     `estado='trial'` cuyo `trial_hasta` esté EXACTAMENTE a
 *     `UMBRAL_ALERTA_TRIAL_DIAS` días (hoy → trial_hasta), publica el evento
 *     UNA vez. Consumido por `jobs/notificar-trial-por-vencer.ts` (correo al
 *     courier). Idempotente: `id` determinístico por día
 *     (`trial-por-vencer-${suscripcionId}-${hoy}`) — un reintento del cron el
 *     mismo día no duplica el envío; al día siguiente `diasRestantes` ya no
 *     calza el umbral exacto, así que no se re-dispara en días distintos.
 *
 *  B. TRIAL VENCIDO SIN PAGO — para cada suscripción que SIGUE `estado='trial'`
 *     con `trial_hasta < hoy` (si hubiera llegado un pago, la transición
 *     trial→activa de `confirmarPeriodoPagado`, `plataforma/cobro.ts`, ya la
 *     habría movido a `estado='activa'` — por construcción, "sigue en trial
 *     vencido" == "vencido sin pago"), ALERTA al super-admin
 *     (`capturarMensaje` + bitácora por-tenant-por-día). NUNCA auto-suspende —
 *     la suspensión es SIEMPRE una acción manual del super-admin
 *     (`suspenderSuscripcion`), igual que la morosidad de períodos
 *     (`jobs/marcar-morosidad.ts`).
 *
 * Ninguna de las dos ramas muta `suscripciones` — este job es puramente
 * observador/notificador (la única escritura de estado de suscripción del
 * ciclo de trial vive en `confirmarPeriodoPagado`).
 */

import { inngest } from '@/lib/inngest/cliente';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import { capturarMensaje } from '@/lib/observabilidad';
import { ahoraEnSantiago, diferenciaEnDiasCalendario, combinarFechaHoraSantiago, sumarDiasCalendario } from '@/lib/fecha-santiago';

/** Días de anticipación para alertar que un trial está por vencer (F2, ítem E). */
export const UMBRAL_ALERTA_TRIAL_DIAS = 3;

const ACCION_ALERTA_VENCIDO = 'plataforma.alerta_trial_vencido_sin_pago';

/** Días restantes hasta `trialHasta` (positivo = todavía no vence). Función pura. */
export function calcularDiasRestantesTrial(trialHasta: string, hoy: string): number {
  return diferenciaEnDiasCalendario(hoy, trialHasta);
}

/** `true` si corresponde publicar `plataforma/trial.por-vencer` HOY. Función pura. */
export function debeAlertarTrialPorVencer(diasRestantes: number): boolean {
  return diasRestantes === UMBRAL_ALERTA_TRIAL_DIAS;
}

export const jobVigilarTrials = inngest.createFunction(
  {
    id: 'plataforma/vigilarTrials',
    name: 'Plataforma · Vigilar ciclo de vida de trials',
    triggers: [{ cron: '0 11 * * *' }],
    retries: 1,
  },
  async ({ step, logger }) => {
    const hoy = ahoraEnSantiago().fecha;

    const suscripcionesTrial = await step.run('listar-suscripciones-trial', async () => {
      const supabase = crearClienteServiceRole();
      const { data, error } = await supabase
        .schema('plataforma')
        .from('suscripciones')
        .select('id, tenant_id, trial_hasta')
        .eq('estado', 'trial')
        .not('trial_hasta', 'is', null);

      if (error) throw new Error(`Error al listar suscripciones en trial: ${error.message}`);
      return (data ?? []) as Array<{ id: string; tenant_id: string; trial_hasta: string }>;
    });

    logger.info(`Suscripciones en trial: ${suscripcionesTrial.length}`);

    if (suscripcionesTrial.length === 0) {
      return { porVencer: 0, vencidosSinPago: 0 };
    }

    // =========================================================================
    // A. Productor de `plataforma/trial.por-vencer`
    // =========================================================================
    const porVencer = await step.run('publicar-trial-por-vencer', async () => {
      let publicados = 0;
      for (const susc of suscripcionesTrial) {
        const diasRestantes = calcularDiasRestantesTrial(susc.trial_hasta, hoy);
        if (!debeAlertarTrialPorVencer(diasRestantes)) continue;

        await inngest.send({
          name: 'plataforma/trial.por-vencer',
          id: `trial-por-vencer-${susc.id}-${hoy}`,
          data: {
            tenantId: susc.tenant_id,
            suscripcionId: susc.id,
            trialHasta: susc.trial_hasta,
            diasRestantes,
          },
        });
        publicados++;
      }
      return publicados;
    });

    // =========================================================================
    // B. Trial vencido sin pago — alerta al super-admin, nunca auto-suspende.
    // =========================================================================
    const vencidosSinPago = suscripcionesTrial.filter(
      (s) => calcularDiasRestantesTrial(s.trial_hasta, hoy) < 0,
    );

    if (vencidosSinPago.length > 0) {
      await step.run('alertar-trials-vencidos-sin-pago', async () => {
        const supabase = crearClienteServiceRole();
        const inicioHoy = combinarFechaHoraSantiago(hoy, '00:00:00').toISOString();
        const inicioManana = combinarFechaHoraSantiago(sumarDiasCalendario(hoy, 1), '00:00:00').toISOString();

        for (const susc of vencidosSinPago) {
          const { data: alertaHoy } = await supabase
            .from('bitacora_auditoria')
            .select('id')
            .eq('tenant_id', susc.tenant_id)
            .eq('accion', ACCION_ALERTA_VENCIDO)
            .eq('entidad_id', susc.id)
            .gte('creado_en', inicioHoy)
            .lt('creado_en', inicioManana)
            .limit(1)
            .maybeSingle();

          if (alertaHoy) continue;

          await registrarEnBitacora(supabase, {
            tenantId: susc.tenant_id,
            actorUsuarioId: null,
            actorTipo: 'sistema',
            accion: ACCION_ALERTA_VENCIDO,
            entidadTipo: 'suscripcion',
            entidadId: susc.id,
            detalle: { trial_hasta: susc.trial_hasta },
          });

          logger.warn(`Suscripción ${susc.id} (tenant ${susc.tenant_id}): trial vencido (${susc.trial_hasta}) sin pago.`);
        }

        // Alerta AGREGADA al super-admin (observabilidad) — nunca auto-suspende;
        // la suspensión sigue siendo una acción MANUAL (`suspenderSuscripcion`).
        await capturarMensaje(
          `${vencidosSinPago.length} suscripción(es) con trial vencido sin pago. La suspensión es manual.`,
          'warning',
          {
            origen: 'job:plataforma/vigilarTrials',
            etiquetas: { vencidos_sin_pago: String(vencidosSinPago.length) },
          },
        );
      });
    }

    logger.info(
      `Trials: ${porVencer} alerta(s) de por-vencer publicada(s), ${vencidosSinPago.length} vencido(s) sin pago.`,
    );

    return { porVencer, vencidosSinPago: vencidosSinPago.length };
  },
);
