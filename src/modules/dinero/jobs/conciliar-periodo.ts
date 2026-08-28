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
import { leerTodasLasFilas, leerPorLotesDeIds } from '@/lib/supabase/leer-paginado';
import { camposClasificacionParaInsert } from '../conciliacion-clasificacion';
import type { TipoDiferenciaConciliacion } from '../tipos';
import { limitesDelDiaSantiago } from '@/lib/fecha-santiago';
import { listarPedidosEntregadosPorRutax } from '../pedidos-entregados-por-rutax';
import { obtenerAreasHabilitadas } from '@/modules/plataforma/superficie-courier';

/**
 * Calcula los 3 campos de clasificación de la bandeja de excepciones
 * (§1.1 P1: `categoria_negocio`, `accion_sugerida`, `fecha_limite`) para un
 * `tipo_diferencia` dado — evita triplicar la llamada en los 4 checks de este
 * job (ninguno comparte un helper de inserción como `conciliar-tres-fuentes.ts`).
 * `categoria_negocio` es NOT NULL sin default desde la migración
 * 20260708000001 — sin esto, cada INSERT de abajo fallaría con 23502.
 */
function clasificacion(tipoDiferencia: TipoDiferenciaConciliacion) {
  return camposClasificacionParaInsert(tipoDiferencia, new Date().toISOString());
}

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

    // 🔴 EL INTERRUPTOR DE RUTAX, EN EL ÚNICO JOB QUE LO NECESITA.
    //
    // Este job lo dispara `cerrar-periodo`, un cron que SIGUE corriendo aunque el
    // courier tenga apagada el área: cerrar ≠ facturar, y si dejara de cerrar, el
    // courier vería un solo período gigante que nunca rota y la pantalla de
    // «cuánto le debo a cada seller» dejaría de significar nada a las semanas.
    //
    // Pero si `conciliacion_cobranza` está apagada, el courier no tiene bandeja
    // donde ver las excepciones: generarlas sería llenarle en silencio una tabla
    // que no puede mirar, y encontrarse una pila el día que se encienda.
    //
    // Los otros dos jobs de dinero no necesitan esto: `ejecutar-payout` NUNCA se
    // dispara desde un cron —solo desde la acción humana, que la capacidad ya
    // bloquea— y `cerrar-periodo` es registro, no dinero que se mueve.
    const areas = await step.run('leer-areas-habilitadas', () =>
      obtenerAreasHabilitadas(tenantId),
    );
    if (!areas.includes('conciliacion_cobranza')) {
      logger.info(
        `Conciliación apagada para el tenant ${tenantId}: no se generan excepciones del período ${periodoCobroidId}.`,
      );
      return { omitido: 'area_apagada' as const, periodoCobroidId, tenantId };
    }

    logger.info(`Conciliando período ${periodoCobroidId} para tenant ${tenantId}.`);

    // CHECK 1: pedidos entregados del período sin línea de cobro.
    await step.run('check-pedidos-sin-linea-cobro', async () => {
      const supabase = crearClienteServiceRole();

      // ⚠️ Los pedidos que Rutax ENTREGÓ, no los que ML dice que están
      // entregados. La diferencia no es sutil: para un pedido Flex el estado lo
      // escribe Mercado Libre, así que uno que despachó el propio seller llega
      // igual a `entregado` en Rutax. Preguntar solo por el estado hacía que un
      // courier que **todavía no operaba** encontrara 109 excepciones de
      // «entregado sin línea de cobro» al cerrar su primer período — todas de
      // pedidos que nadie de Rutax tocó. Ver `pedidos-entregados-por-rutax.ts`.
      //
      // El detector hermano (liquidación, más abajo) llega a lo mismo por otra
      // vía: exige `driver_id_asignado`. Es más estricto porque además necesita
      // saber A QUIÉN pagarle, así que se deja como está.
      const pedidoIds = await listarPedidosEntregadosPorRutax(supabase, {
        tenantId,
        sellerId,
        rango: {
          // Ventana del período en calendario de SANTIAGO. Sin esto, un
          // timestamp sin offset se interpreta en la zona del servidor (UTC) y
          // el período se corre 3–4 horas: entregas de la noche del último día
          // quedaban fuera de la conciliación de su propio período.
          desdeIso: limitesDelDiaSantiago(fechaInicio).desde.toISOString(),
          hastaIso: limitesDelDiaSantiago(fechaFin).hasta.toISOString(),
        },
      });
      if (pedidoIds.length === 0) return;

      // Obtener pedido_ids que SÍ tienen línea de cobro. EN LOTES: la lista crece
      // con el volumen del seller y un `.in()` largo da `URI too long`.
      const lineasExistentes = await leerPorLotesDeIds<{ pedido_id: string }>(
        'líneas de cobro por pedido',
        pedidoIds,
        (lote) => supabase
          .schema('dinero')
          .from('lineas_cobro')
          .select('pedido_id')
          .eq('tenant_id', tenantId)
          .in('pedido_id', lote),
      );

      const pedidosConLinea = new Set(lineasExistentes.map((l) => l.pedido_id));
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
              ...clasificacion('pedido_entregado_sin_linea_cobro'),
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
      // ⚠️ PAGINADO — mismo motivo que la comparación de cobro de arriba.
      const pedidosConDriver = await leerTodasLasFilas<{ id: string; driver_id_asignado: string }>(
        `pedidos con conductor del seller ${sellerId}`,
        (desde, hasta) => supabase
        .schema('operacion')
        .from('pedidos')
        .select('id, driver_id_asignado')
        .eq('tenant_id', tenantId)
        .eq('seller_id', sellerId)
        .in('estado', ['entregado', 'entregado_manual'])
        .not('driver_id_asignado', 'is', null)
        // Ventana del período en calendario de SANTIAGO. Sin esto, un
        // timestamp sin offset se interpreta en la zona del servidor (UTC) y
        // el período se corre 3–4 horas: entregas de la noche del último día
        // quedaban fuera de la conciliación de su propio período.
        .gte('actualizado_en', limitesDelDiaSantiago(fechaInicio).desde.toISOString())
        .lt('actualizado_en', limitesDelDiaSantiago(fechaFin).hasta.toISOString())
        .order('id')
        .range(desde, hasta),
      );

      const pedidoIds = pedidosConDriver.map((p) => p.id);
      if (pedidoIds.length === 0) return;

      // EN LOTES: la lista crece con el volumen del seller.
      const lineasExistentes = await leerPorLotesDeIds<{ pedido_id: string }>(
        'líneas de liquidación por pedido',
        pedidoIds,
        (lote) => supabase
          .schema('dinero')
          .from('lineas_liquidacion')
          .select('pedido_id')
          .eq('tenant_id', tenantId)
          .in('pedido_id', lote),
      );

      const pedidosConLinea = new Set(lineasExistentes.map((l) => l.pedido_id));
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
              ...clasificacion('pedido_entregado_sin_linea_liquidacion'),
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
              ...clasificacion('monto_dte_difiere_de_lineas'),
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

      // Cuenta POSTGRES, no `.length` sobre las filas traídas: acá solo interesa
      // cuántas son, y traerlas para contarlas volvía a chocar con el corte en
      // `max_rows` (1000). Un período con más líneas sueltas que eso reportaba
      // "1000" para siempre, sin señal de que la cifra estaba tapada.
      const { count, error: errorSueltas } = await supabase
        .schema('dinero')
        .from('lineas_cobro')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('seller_id', sellerId)
        .is('periodo_cobro_id', null)
        .gte('fecha_hecho', fechaInicio)
        .lte('fecha_hecho', fechaFin);

      if (errorSueltas) throw new Error(`Error al contar líneas sueltas: ${errorSueltas.message}`);

      const cantidadSueltas = count ?? 0;

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
              ...clasificacion('periodo_cerrado_con_lineas_sueltas'),
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
