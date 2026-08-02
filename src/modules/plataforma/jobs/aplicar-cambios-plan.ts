/**
 * Job · plataforma/aplicarCambiosPlan — aplica CAMBIOS DIFERIDOS de suscripción
 * (F2, items I y J): downgrades de plan y cambios de periodicidad (mensual↔anual).
 * =============================================================================
 * Trigger: Cron `0 5 * * *` (05:00 UTC, diario), ANTES del cron
 * `plataforma/generarPeriodos` (06:00 UTC) — así, si un cambio es efectivo
 * HOY, el período que ese cron genere a las 06:00 ya usa el plan/periodicidad
 * NUEVOS.
 *
 * Cubre dos cambios diferidos, con el MISMO mecanismo
 * (`plan_anterior_id` = plan destino, `cambio_efectivo_desde` = fecha efectiva,
 * y `periodicidad_pendiente` = periodicidad destino cuando aplica):
 *  - Downgrade de plan (precio más barato): `periodicidad_pendiente` = null.
 *  - Cambio de periodicidad (mensual↔anual): NO se prorratea, se difiere aquí
 *    (fix de dinero ALTO, Ola 2); puede venir junto a un cambio de plan destino.
 * El swap aplica `plan_id = plan_anterior_id` y `periodicidad = periodicidad_pendiente ?? periodicidad`.
 *
 * MODELO DE DOWNGRADE DIFERIDO (ver el bloque de comentarios sobre
 * `cambiarPlanCourier` en `superficie-courier.ts`, y el JSDoc de
 * `Suscripcion.planAnteriorId` en `tipos.ts`, para el razonamiento completo):
 * mientras un downgrade está PENDIENTE, `plan_id` sigue siendo el plan
 * ACTUAL/viejo (nunca se toca en el momento de la solicitud) y
 * `plan_anterior_id` se REUTILIZA temporalmente para guardar el plan DESTINO.
 * Este job es el ÚNICO lugar que hace el swap real:
 *   `plan_id = plan_anterior_id` (aplica el destino)
 *   `plan_anterior_id = null`, `cambio_efectivo_desde = null` (limpia el pendiente)
 * para toda suscripción con `cambio_efectivo_desde <= hoy(Santiago)`.
 *
 * Idempotente: el SELECT solo trae suscripciones con
 * `cambio_efectivo_desde IS NOT NULL AND plan_anterior_id IS NOT NULL AND
 * cambio_efectivo_desde <= hoy`; el UPDATE, además, exige
 * `plan_anterior_id = <valor leído>` como guarda adicional a nivel BD (evita
 * una carrera si, entre el SELECT y el UPDATE, otro proceso ya lo aplicó o lo
 * cambió). Una vez aplicado, ambos campos quedan `null` — el mismo cron ya no
 * vuelve a tocar esa suscripción en corridas siguientes. `Promise.allSettled`:
 * un fallo no cancela los demás.
 *
 * Bitácora ANTES del efecto (actor sistema) — RNF-04. Este job NUNCA cobra
 * nada — un downgrade jamás genera un cargo (ver `cambiarPlanCourier`).
 *
 * F2 "Ola 3" ítem M (ciclo de vida y comunicaciones): al aplicar el swap
 * PUBLICA `plataforma/plan.cambiado` — es el punto en que un cambio DIFERIDO
 * (downgrade / cambio de periodicidad) se vuelve EFECTIVO por primera vez (a
 * diferencia del upgrade inmediato, que lo publica `cambiarPlanCourier` en el
 * momento de la solicitud). `tipo` es `'periodicidad'` si el swap incluyó un
 * cambio de periodicidad pendiente, o `'downgrade'` si solo cambió el plan.
 * `actorUsuarioId: null` — lo aplica el cron, no hay actor humano en este
 * instante (el actor original de la SOLICITUD no se persiste en el modelo de
 * datos del downgrade diferido, ver `tipos.ts`).
 */

import { inngest } from '@/lib/inngest/cliente';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import { ahoraEnSantiago } from '@/lib/fecha-santiago';

// =============================================================================
// Lógica pura (sin I/O) — exportada para probarla directamente sin runtime de
// Inngest ni BD (mismo patrón que `decidirAccionAutoCobro`,
// `jobs/cobrar-periodo-auto.ts`).
// =============================================================================

/**
 * Decide si una suscripción tiene un downgrade PENDIENTE que ya debe
 * aplicarse hoy. Refleja el filtro del Step 1 del job.
 */
export function debeAplicarCambioPlan(args: {
  planAnteriorId: string | null;
  cambioEfectivoDesde: string | null;
  hoy: string;
}): boolean {
  if (!args.planAnteriorId || !args.cambioEfectivoDesde) return false;
  return args.cambioEfectivoDesde <= args.hoy;
}

export const jobAplicarCambiosPlan = inngest.createFunction(
  {
    id: 'plataforma/aplicarCambiosPlan',
    name: 'Plataforma · Aplicar cambios de plan diferidos (downgrade)',
    triggers: [{ cron: '0 5 * * *' }],
    retries: 1,
  },
  async ({ step, logger }) => {
    const hoy = ahoraEnSantiago().fecha;

    // =========================================================================
    // Step 1: listar suscripciones con downgrade pendiente cuya fecha ya llegó.
    // =========================================================================
    const pendientes = await step.run('listar-pendientes', async () => {
      const supabase = crearClienteServiceRole();

      const { data, error } = await supabase
        .schema('plataforma')
        .from('suscripciones')
        .select('id, tenant_id, plan_id, plan_anterior_id, periodicidad, periodicidad_pendiente, cambio_efectivo_desde')
        .not('plan_anterior_id', 'is', null)
        .not('cambio_efectivo_desde', 'is', null)
        .lte('cambio_efectivo_desde', hoy);

      if (error) throw new Error(`Error al listar cambios de plan pendientes: ${error.message}`);
      return (data ?? []).filter((s) =>
        debeAplicarCambioPlan({
          planAnteriorId: (s.plan_anterior_id as string | null) ?? null,
          cambioEfectivoDesde: (s.cambio_efectivo_desde as string | null) ?? null,
          hoy,
        }),
      );
    });

    logger.info(`Cambios de plan pendientes por aplicar hoy (${hoy}): ${pendientes.length}`);

    if (pendientes.length === 0) {
      return { aplicados: 0, errores: 0 };
    }

    // =========================================================================
    // Step 2: aplicar el swap de cada suscripción — bitácora ANTES del UPDATE.
    // =========================================================================
    const resultado = await step.run('aplicar-swaps', async () => {
      const supabase = crearClienteServiceRole();

      const settled = await Promise.allSettled(
        pendientes.map(async (susc) => {
          const suscripcionId = susc.id as string;
          const tenantId = susc.tenant_id as string;
          const planOrigenId = susc.plan_id as string;
          const planDestinoId = susc.plan_anterior_id as string;
          // Periodicidad pendiente (cambio de periodicidad diferido, migración
          // 20260712000006). `null` = solo cambia el plan (downgrade), la
          // periodicidad se conserva. Si viene, se aplica en el MISMO swap.
          const periodicidadPendiente = (susc.periodicidad_pendiente as string | null) ?? null;
          const periodicidadActual = (susc.periodicidad as string | null) ?? 'mensual';
          const periodicidadFinal = periodicidadPendiente ?? periodicidadActual;

          // Bitácora ANTES del UPDATE — actor sistema (el cron), RNF-04.
          await registrarEnBitacora(supabase, {
            tenantId,
            actorUsuarioId: null,
            actorTipo: 'sistema',
            accion: 'plataforma.cambio_diferido_aplicado',
            entidadTipo: 'suscripcion',
            entidadId: suscripcionId,
            detalle: {
              desde: planOrigenId,
              hacia: planDestinoId,
              periodicidad_desde: periodicidadActual,
              periodicidad_hacia: periodicidadFinal,
            },
          });

          const { error } = await supabase
            .schema('plataforma')
            .from('suscripciones')
            .update({
              plan_id: planDestinoId,
              periodicidad: periodicidadFinal,
              plan_anterior_id: null,
              periodicidad_pendiente: null,
              cambio_efectivo_desde: null,
              actualizado_en: new Date().toISOString(),
            })
            .eq('id', suscripcionId)
            // Guarda adicional a nivel BD: solo aplica si el cambio diferido
            // sigue apuntando al MISMO plan destino leído en el Step 1 (evita
            // una carrera si, entre el SELECT y el UPDATE, otro proceso ya lo
            // aplicó o lo cambió).
            .eq('plan_anterior_id', planDestinoId);
          if (error) throw new Error(`Error al aplicar el cambio diferido de ${suscripcionId}: ${error.message}`);

          // Notificación de ciclo de vida (F2 "Ola 3", ítem M) — el cambio
          // DIFERIDO recién se vuelve efectivo AHORA. `id` determinístico por
          // suscripción + día: si el cron corriera dos veces el mismo día, el
          // guard `.eq('plan_anterior_id', planDestinoId)` de arriba ya impide
          // un segundo UPDATE real, pero el `id` es una segunda red de
          // seguridad para el propio evento.
          await inngest.send({
            name: 'plataforma/plan.cambiado',
            id: `plan-cambiado-aplicado-${suscripcionId}-${hoy}`,
            data: {
              tenantId,
              suscripcionId,
              planDesdeId: planOrigenId,
              planHaciaId: planDestinoId,
              tipo: periodicidadPendiente ? ('periodicidad' as const) : ('downgrade' as const),
              periodicidadDesde: periodicidadActual as 'mensual' | 'anual',
              periodicidadHacia: periodicidadFinal as 'mensual' | 'anual',
              montoAjusteClp: null,
              efectivoDesde: hoy,
              actorUsuarioId: null,
            },
          });

          return suscripcionId;
        }),
      );

      const aplicados = settled.filter((r) => r.status === 'fulfilled').length;
      const errores = settled.filter((r) => r.status === 'rejected');
      for (const err of errores) {
        if (err.status === 'rejected') {
          logger.error(`Error al aplicar un downgrade de plan: ${String(err.reason)}`);
        }
      }
      return { aplicados, errores: errores.length };
    });

    logger.info(
      `Cambios de plan: ${resultado.aplicados} downgrade(s) aplicado(s), ${resultado.errores} error(es).`,
    );
    return resultado;
  },
);
