/**
 * Job C6 · dinero/conciliarPeriodo
 * =====================================================================
 * Trigger: evento `dinero/periodo.cerrado`
 * (corre en PARALELO con C3, que emite el DTE)
 *
 * Responsabilidad:
 * Implementa los 4 checks de conciliación del §8 del documento de arquitectura:
 *
 * 1. `pedido_entregado_sin_linea_cobro` — pedidos entregados del período sin
 *    línea de cobro generada.
 * 2. `pedido_entregado_sin_linea_liquidacion` — análogo para liquidación.
 * 3. `monto_dte_difiere_de_lineas` — monto_total del DTE ≠ SUM(lineas_cobro).
 * 4. `periodo_cerrado_con_lineas_sueltas` — líneas con periodo_cobro_id IS NULL
 *    dentro del rango de fechas.
 *
 * Para cada diferencia encontrada: INSERT en `dinero.eventos_conciliacion`.
 * Se verifica que no existe evento previo del mismo tipo para el período.
 *
 * Idempotencia:
 * - EventId = `dinero-conciliar-${periodoCobroidId}` — Inngest deduplica.
 * - Se verifica la existencia del evento antes de insertar (no duplicar alertas).
 *
 * SEGURIDAD:
 * - Solo se loguean tenant_id y IDs de entidades — nunca datos financieros
 *   de otros tenants.
 */

import { inngest } from '@/lib/inngest/cliente';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';

export const jobConciliarPeriodo = inngest.createFunction(
  {
    id: 'dinero/conciliarPeriodo',
    name: 'Dinero · Conciliar período cerrado',
    triggers: [{ event: 'dinero/periodo.cerrado' }],
    retries: 3,
  },
  async ({ event, step, logger, runId }) => {
    const { periodoCobroidId, tenantId, sellerId, fechaInicio, fechaFin, montoTotalClp } =
      event.data as {
        periodoCobroidId: string;
        tenantId: string;
        sellerId: string;
        fechaInicio: string;
        fechaFin: string;
        montoTotalClp: number;
      };

    logger.info(`Conciliando período ${periodoCobroidId} para tenant ${tenantId}.`);

    // CHECK 1: pedidos entregados del período sin línea de cobro.
    await step.run('check-pedidos-sin-linea-cobro', async () => {
      const supabase = crearClienteServiceRole();

      // Buscar pedidos del seller en el rango que estén entregados
      // pero sin línea de cobro correspondiente.
      const { data: pedidosEntregados } = await supabase
        .schema('operacion')
        .from('pedidos')
        .select('id, estado')
        .eq('tenant_id', tenantId)
        .eq('seller_id', sellerId)
        .in('estado', ['entregado', 'entregado_manual'])
        .gte('actualizado_en', `${fechaInicio}T00:00:00`)
        .lte('actualizado_en', `${fechaFin}T23:59:59`);

      const pedidoIds = (pedidosEntregados ?? []).map((p) => p.id as string);
      if (pedidoIds.length === 0) return;

      // Obtener pedido_ids que SÍ tienen línea de cobro.
      const { data: lineasExistentes } = await supabase
        .schema('dinero')
        .from('lineas_cobro')
        .select('pedido_id')
        .eq('tenant_id', tenantId)
        .in('pedido_id', pedidoIds);

      const pedidosConLinea = new Set((lineasExistentes ?? []).map((l) => l.pedido_id as string));
      const pedidosSinLinea = pedidoIds.filter((id) => !pedidosConLinea.has(id));

      for (const pedidoId of pedidosSinLinea) {
        // Verificar que no existe evento del mismo tipo para este pedido.
        const { data: eventoExistente } = await supabase
          .schema('dinero')
          .from('eventos_conciliacion')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('tipo_diferencia', 'pedido_entregado_sin_linea_cobro')
          .eq('pedido_id', pedidoId)
          .maybeSingle();

        if (!eventoExistente) {
          await supabase
            .schema('dinero')
            .from('eventos_conciliacion')
            .insert({
              tenant_id: tenantId,
              seller_id: sellerId,
              periodo_cobro_id: periodoCobroidId,
              tipo_diferencia: 'pedido_entregado_sin_linea_cobro',
              pedido_id: pedidoId,
              descripcion: `Pedido ${pedidoId} entregado sin línea de cobro generada.`,
              estado: 'pendiente',
              job_run_id: runId,
            });
        }
      }

      if (pedidosSinLinea.length > 0) {
        logger.warn(
          `Período ${periodoCobroidId}: ${pedidosSinLinea.length} pedidos entregados sin línea de cobro.`,
        );
      }
    });

    // CHECK 2: pedidos entregados del período sin línea de liquidación.
    await step.run('check-pedidos-sin-linea-liquidacion', async () => {
      const supabase = crearClienteServiceRole();

      // Pedidos con conductor asignado que estén entregados en el rango.
      const { data: pedidosConDriver } = await supabase
        .schema('operacion')
        .from('pedidos')
        .select('id, driver_id_asignado')
        .eq('tenant_id', tenantId)
        .eq('seller_id', sellerId)
        .in('estado', ['entregado', 'entregado_manual'])
        .not('driver_id_asignado', 'is', null)
        .gte('actualizado_en', `${fechaInicio}T00:00:00`)
        .lte('actualizado_en', `${fechaFin}T23:59:59`);

      const pedidoIds = (pedidosConDriver ?? []).map((p) => p.id as string);
      if (pedidoIds.length === 0) return;

      const { data: lineasExistentes } = await supabase
        .schema('dinero')
        .from('lineas_liquidacion')
        .select('pedido_id')
        .eq('tenant_id', tenantId)
        .in('pedido_id', pedidoIds);

      const pedidosConLinea = new Set((lineasExistentes ?? []).map((l) => l.pedido_id as string));
      const pedidosSinLinea = pedidoIds.filter((id) => !pedidosConLinea.has(id));

      for (const pedidoId of pedidosSinLinea) {
        const { data: eventoExistente } = await supabase
          .schema('dinero')
          .from('eventos_conciliacion')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('tipo_diferencia', 'pedido_entregado_sin_linea_liquidacion')
          .eq('pedido_id', pedidoId)
          .maybeSingle();

        if (!eventoExistente) {
          await supabase
            .schema('dinero')
            .from('eventos_conciliacion')
            .insert({
              tenant_id: tenantId,
              seller_id: sellerId,
              periodo_cobro_id: periodoCobroidId,
              tipo_diferencia: 'pedido_entregado_sin_linea_liquidacion',
              pedido_id: pedidoId,
              descripcion: `Pedido ${pedidoId} entregado (con conductor) sin línea de liquidación.`,
              estado: 'pendiente',
              job_run_id: runId,
            });
        }
      }

      if (pedidosSinLinea.length > 0) {
        logger.warn(
          `Período ${periodoCobroidId}: ${pedidosSinLinea.length} pedidos sin línea de liquidación.`,
        );
      }
    });

    // CHECK 3: monto del DTE difiere de la suma de líneas de cobro.
    await step.run('check-monto-dte-vs-lineas', async () => {
      const supabase = crearClienteServiceRole();

      // Leer el DTE del período (si ya fue emitido — C3 puede estar corriendo en paralelo).
      const { data: dte } = await supabase
        .schema('dinero')
        .from('documentos_dte')
        .select('id, monto_total_clp')
        .eq('tenant_id', tenantId)
        .eq('periodo_cobro_id', periodoCobroidId)
        .maybeSingle();

      if (!dte) {
        // C3 aún no emitió el DTE — este check se omite (C5 lo retomará si hay rechazo).
        logger.info(`Período ${periodoCobroidId}: DTE aún no emitido. Check 3 omitido.`);
        return;
      }

      const montoSumaLineas = montoTotalClp;
      const montoDte = Math.round(Number(dte.monto_total_clp));

      if (montoSumaLineas !== montoDte) {
        const { data: eventoExistente } = await supabase
          .schema('dinero')
          .from('eventos_conciliacion')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('tipo_diferencia', 'monto_dte_difiere_de_lineas')
          .eq('periodo_cobro_id', periodoCobroidId)
          .maybeSingle();

        if (!eventoExistente) {
          await supabase
            .schema('dinero')
            .from('eventos_conciliacion')
            .insert({
              tenant_id: tenantId,
              seller_id: sellerId,
              periodo_cobro_id: periodoCobroidId,
              tipo_diferencia: 'monto_dte_difiere_de_lineas',
              descripcion:
                `Monto del DTE (${montoDte} CLP) difiere de la suma de líneas ` +
                `(${montoSumaLineas} CLP). Diferencia: ${Math.abs(montoDte - montoSumaLineas)} CLP.`,
              monto_diferencia_clp: Math.abs(montoDte - montoSumaLineas),
              estado: 'pendiente',
              job_run_id: runId,
            });

          logger.warn(
            `Período ${periodoCobroidId}: diferencia de monto DTE vs líneas. ` +
            `DTE=${montoDte}, Líneas=${montoSumaLineas}.`,
          );
        }
      }
    });

    // CHECK 4: líneas de cobro con periodo_cobro_id IS NULL dentro del rango de fechas.
    await step.run('check-lineas-sueltas', async () => {
      const supabase = crearClienteServiceRole();

      const { data: lineasSueltas } = await supabase
        .schema('dinero')
        .from('lineas_cobro')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('seller_id', sellerId)
        .is('periodo_cobro_id', null)
        .gte('fecha_entrega', fechaInicio)
        .lte('fecha_entrega', fechaFin);

      const cantidadSueltas = (lineasSueltas ?? []).length;

      if (cantidadSueltas > 0) {
        const { data: eventoExistente } = await supabase
          .schema('dinero')
          .from('eventos_conciliacion')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('tipo_diferencia', 'periodo_cerrado_con_lineas_sueltas')
          .eq('periodo_cobro_id', periodoCobroidId)
          .maybeSingle();

        if (!eventoExistente) {
          await supabase
            .schema('dinero')
            .from('eventos_conciliacion')
            .insert({
              tenant_id: tenantId,
              seller_id: sellerId,
              periodo_cobro_id: periodoCobroidId,
              tipo_diferencia: 'periodo_cerrado_con_lineas_sueltas',
              descripcion:
                `${cantidadSueltas} línea(s) de cobro en el rango ${fechaInicio}–${fechaFin} ` +
                'sin período asignado (periodo_cobro_id IS NULL).',
              estado: 'pendiente',
              job_run_id: runId,
            });

          logger.warn(
            `Período ${periodoCobroidId}: ${cantidadSueltas} líneas sueltas en el rango.`,
          );
        }
      }
    });

    logger.info(`Conciliación completada para período ${periodoCobroidId}.`);

    return {
      resultado: 'conciliacion_completada',
      periodoCobroidId,
    };
  },
);
