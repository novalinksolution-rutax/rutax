/**
 * Job · plataforma/generarPeriodos
 * =====================================================================
 * Trigger: Cron `0 6 1 * *` (día 1 de cada mes a las 06:00 UTC)
 *
 * Responsabilidad:
 * - Listar todas las suscripciones activas o en trial.
 * - Para cada una, generar el período de cobro del MES ACTUAL con
 *   ON CONFLICT DO NOTHING (idempotencia: si el cron corre dos veces el
 *   día 1, no duplica el período gracias al UNIQUE (suscripcion_id, periodo_inicio)).
 * - Los trials generan un período con monto 0 (no se cobra, pero queda registro).
 *
 * Idempotencia:
 * - El UNIQUE (suscripcion_id, periodo_inicio) en BD impide períodos duplicados.
 * - Si el INSERT hace conflict (período ya existe), maybeSingle() devuelve null
 *   y lo contamos como "omitido".
 * - Un fallo en una suscripción no cancela las demás (Promise.allSettled).
 *
 * Este job NO emite facturas ni cobra — solo genera el registro de período.
 * El cobro real (link Fintoc) y la reconciliación de pagos son procesos separados.
 */

import { inngest } from '@/lib/inngest/cliente';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';

export const jobGenerarPeriodosSuscripcion = inngest.createFunction(
  {
    id: 'plataforma/generarPeriodos',
    name: 'Plataforma · Generar períodos de suscripción',
    triggers: [{ cron: '0 6 1 * *' }],
    retries: 1,
  },
  async ({ step, logger }) => {
    // =========================================================================
    // Step 1: listar suscripciones activas y en trial
    // =========================================================================
    const suscripciones = await step.run('listar-suscripciones', async () => {
      const supabase = crearClienteServiceRole();

      const { data, error } = await supabase
        .schema('plataforma')
        .from('suscripciones')
        .select('id, tenant_id, plan_id, estado')
        .in('estado', ['activa', 'trial']);

      if (error) throw new Error(`Error al listar suscripciones activas: ${error.message}`);
      const suscLista = data ?? [];

      if (suscLista.length === 0) return [];

      // Leer los planes para obtener el precio mensual de cada suscripción
      const planIds = [...new Set(suscLista.map((s) => s.plan_id as string))];
      const { data: planesData, error: planesError } = await supabase
        .schema('plataforma')
        .from('planes')
        .select('id, precio_mensual_clp')
        .in('id', planIds);

      if (planesError) throw new Error(`Error al leer planes: ${planesError.message}`);
      const planesMap = new Map(
        (planesData ?? []).map((p) => [p.id as string, Number(p.precio_mensual_clp)]),
      );

      return suscLista.map((s) => ({
        id: s.id as string,
        tenantId: s.tenant_id as string,
        planId: s.plan_id as string,
        estado: s.estado as 'activa' | 'trial',
        precioMensualClp: planesMap.get(s.plan_id as string) ?? 0,
      }));
    });

    logger.info(`Suscripciones a procesar: ${suscripciones.length}`);

    if (suscripciones.length === 0) {
      return { generados: 0, omitidos: 0, resultado: 'sin_suscripciones_activas' };
    }

    // =========================================================================
    // Step 2: generar períodos del mes actual
    // =========================================================================
    const { generados, omitidos } = await step.run('generar-periodos', async () => {
      const supabase = crearClienteServiceRole();

      // Calcular fechas del mes actual (el cron corre el día 1 del mes nuevo)
      const hoy = new Date();
      const periodoInicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1)
        .toISOString()
        .slice(0, 10);
      const periodoFin = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0)
        .toISOString()
        .slice(0, 10);
      // Fecha de vencimiento: día 5 del mes siguiente
      const venceEn = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 5)
        .toISOString()
        .slice(0, 10);

      logger.info(`Generando períodos: ${periodoInicio} → ${periodoFin} (vence: ${venceEn})`);

      const promesas = suscripciones.map(async (susc) => {
        try {
          // Monto: 0 para trial (no se cobra), precio mensual del plan para activa
          const montoClp = susc.estado === 'trial' ? 0 : susc.precioMensualClp;

          // INSERT con ignorancia de conflicto (idempotencia del cron)
          // maybeSingle() devuelve null si el INSERT fue ignorado por conflict
          const { data, error } = await supabase
            .schema('plataforma')
            .from('periodos_suscripcion')
            .insert({
              suscripcion_id: susc.id,
              tenant_id: susc.tenantId,
              periodo_inicio: periodoInicio,
              periodo_fin: periodoFin,
              monto_clp: montoClp,
              estado: 'pendiente',
              vence_en: venceEn,
            })
            .select('id')
            .maybeSingle();

          if (error) {
            // Supabase devuelve error.code '23505' para unique_violation.
            // Si el conflict estaba configurado con .upsert() lo manejaría solo,
            // pero con .insert() necesitamos capturar el 23505 como omitido.
            if (error.code === '23505') {
              return { suscripcionId: susc.id, resultado: 'omitido' as const };
            }
            throw new Error(error.message);
          }

          // data === null significa que el INSERT hizo ON CONFLICT (no vino error
          // pero tampoco devolvió fila — esto puede pasar con algunas versiones).
          if (!data) {
            return { suscripcionId: susc.id, resultado: 'omitido' as const };
          }

          return {
            suscripcionId: susc.id,
            periodoId: data.id as string,
            resultado: 'generado' as const,
          };
        } catch (err) {
          logger.error(
            `Error al generar período para suscripción ${susc.id}: ${(err as Error).message}`,
          );
          return {
            suscripcionId: susc.id,
            resultado: 'error' as const,
            error: (err as Error).message,
          };
        }
      });

      const settled = await Promise.allSettled(promesas);
      const resultados = settled.map((r) =>
        r.status === 'fulfilled' ? r.value : { resultado: 'error' as const, error: String(r.reason) },
      );

      const generadosCount = resultados.filter((r) => r.resultado === 'generado').length;
      const omitidosCount = resultados.filter((r) => r.resultado === 'omitido').length;
      const erroresCount = resultados.filter((r) => r.resultado === 'error').length;

      if (erroresCount > 0) {
        logger.error(`Errores al generar períodos: ${erroresCount}`);
      }

      return { generados: generadosCount, omitidos: omitidosCount, errores: erroresCount };
    });

    logger.info(`Períodos generados: ${generados}. Omitidos (ya existían): ${omitidos}.`);

    return { generados, omitidos };
  },
);
