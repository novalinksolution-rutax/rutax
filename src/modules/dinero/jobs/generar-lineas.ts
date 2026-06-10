/**
 * Job C1 · dinero/generarLineas
 * =====================================================================
 * Trigger: evento `dinero/pedido.estado_financiero_relevante`
 * (publicado por `operacion/pedidos.ts` post-commit de actualizarEstadoPedido)
 *
 * Responsabilidad: generar las líneas de cobro y de liquidación para un pedido
 * en estado financieramente relevante. Asignarlas al período/liquidación abiertos.
 * Actualizar los flags en `operacion.pedidos`.
 *
 * Idempotencia:
 * - EventId = `dinero-lineas-${pedidoId}` — Inngest deduplica si el evento llega dos veces.
 * - INSERT ON CONFLICT (pedido_id) DO NOTHING — la BD absorbe el segundo intento.
 * - UPDATE con WHERE periodo_cobro_id IS NULL / liquidacion_id IS NULL — idempotente.
 *
 * SEGURIDAD:
 * - Nunca se loguean tokens, certificados ni credenciales.
 * - Solo se escriben cobro_generado, monto_cobro_clp, liquidacion_generada,
 *   monto_liquidacion_clp en operacion.pedidos (columnas de Fase C).
 */

import { inngest } from '@/lib/inngest/cliente';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import { evaluarElegibilidad } from '../motor';
import { obtenerOCrearPeriodoCobroAbierto, obtenerOCrearLiquidacionAbierta } from '../periodos';
import type { EstadoPedido } from '@/modules/operacion/tipos';

const TZ = 'America/Santiago';

/**
 * Extrae la fecha local en Santiago en formato 'YYYY-MM-DD' desde un string ISO.
 */
function fechaLocalSantiago(isoStr: string): string {
  const d = new Date(isoStr);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export const jobGenerarLineas = inngest.createFunction(
  {
    id: 'dinero/generarLineas',
    name: 'Dinero · Generar líneas de cobro y liquidación',
    triggers: [{ event: 'dinero/pedido.estado_financiero_relevante' }],
    retries: 4,
  },
  async ({ event, step, logger, runId }) => {
    const {
      pedidoId,
      tenantId,
      sellerId,
      driverIdAsignado,
      estadoNuevo,
      fechaTransicion,
      tipoPedido,
      tarifaAplicableId,
    } = event.data as {
      pedidoId: string;
      tenantId: string;
      sellerId: string;
      driverIdAsignado: string | null;
      estadoNuevo: string;
      estadoAnterior: string;
      fechaTransicion: string;
      tipoPedido: 'flex' | 'same_day';
      tarifaAplicableId: string | null;
    };

    // Paso 1: Evaluar elegibilidad.
    const { elegibilidad, tarifa, incidencia, esGastoPropio } = await step.run(
      'evaluar-elegibilidad',
      async () => {
        const supabase = crearClienteServiceRole();

        // Leer tarifa (monto_clp para cobro, monto_conductor_clp para liquidación).
        let montoCobroBase = 0;
        let montoConductorBase = 0;
        if (tarifaAplicableId) {
          const { data: tarifaData } = await supabase
            .schema('identidad')
            .from('tarifas')
            .select('monto_clp, monto_conductor_clp')
            .eq('id', tarifaAplicableId)
            .eq('tenant_id', tenantId)
            .maybeSingle();

          montoCobroBase = tarifaData ? Math.round(Number(tarifaData.monto_clp)) : 0;
          montoConductorBase = tarifaData ? Math.round(Number(tarifaData.monto_conductor_clp ?? 0)) : 0;
        }

        // Leer incidencia abierta del pedido (afecta_cobro / afecta_liquidacion).
        const { data: incidenciaData } = await supabase
          .schema('operacion')
          .from('incidencias')
          .select('id, afecta_cobro, afecta_liquidacion')
          .eq('pedido_id', pedidoId)
          .eq('tenant_id', tenantId)
          .order('creado_en', { ascending: false })
          .limit(1)
          .maybeSingle();

        const afectaCobro = incidenciaData?.afecta_cobro ?? null;
        const afectaLiquidacion = incidenciaData?.afecta_liquidacion ?? null;

        // Leer seller_id_gasto_propio del tenant para detectar same_day gasto propio.
        const { data: tenantData } = await supabase
          .schema('identidad')
          .from('tenants')
          .select('seller_id_gasto_propio')
          .eq('id', tenantId)
          .maybeSingle();

        const gastoPropio = tipoPedido === 'same_day' &&
          tenantData?.seller_id_gasto_propio != null &&
          tenantData.seller_id_gasto_propio === sellerId;

        const resultado = evaluarElegibilidad({
          estadoPedido: estadoNuevo as EstadoPedido,
          afectaCobro: afectaCobro as boolean | null,
          afectaLiquidacion: afectaLiquidacion as boolean | null,
          esGastoPropio: gastoPropio,
          tieneDriverAsignado: driverIdAsignado !== null,
        });

        return {
          elegibilidad: resultado,
          tarifa: { montoCobroBase, montoConductorBase },
          incidencia: incidenciaData ? { id: incidenciaData.id as string } : null,
          esGastoPropio: gastoPropio,
        };
      },
    );

    const fechaEntrega = fechaLocalSantiago(fechaTransicion);

    // Paso 2: Generar línea de cobro (idempotente con ON CONFLICT DO NOTHING).
    const lineaCobroId = await step.run('generar-linea-cobro', async () => {
      if (!elegibilidad.generaCobro) {
        logger.info(`Pedido ${pedidoId}: no genera cobro (estado=${estadoNuevo}).`);
        return null;
      }

      const supabase = crearClienteServiceRole();
      const montoBase = tarifa.montoCobroBase;
      const ajuste = elegibilidad.ajusteCobroCLP;
      const concepto = `Servicio de entrega ${tipoPedido} — pedido ${pedidoId}`;

      // INSERT con ON CONFLICT (pedido_id) DO NOTHING para idempotencia.
      const { data: insertada, error } = await supabase
        .schema('dinero')
        .from('lineas_cobro')
        .insert({
          tenant_id: tenantId,
          seller_id: sellerId,
          pedido_id: pedidoId,
          tarifa_id: tarifaAplicableId!,
          monto_base_clp: montoBase,
          ajuste_incidencia_clp: ajuste,
          concepto,
          tipo_pedido: tipoPedido,
          fecha_entrega: fechaEntrega,
          incidencia_id: incidencia?.id ?? null,
          origen_generacion: 'motor_automatico',
        })
        .select('id')
        .maybeSingle();

      if (error && !error.message.includes('duplicate')) {
        throw new Error(`Error al insertar línea de cobro: ${error.message}`);
      }

      if (insertada) return insertada.id as string;

      // Si hubo conflicto (ya existía), leer el ID existente.
      const { data: existente } = await supabase
        .schema('dinero')
        .from('lineas_cobro')
        .select('id')
        .eq('pedido_id', pedidoId)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      return existente?.id as string ?? null;
    });

    // Paso 3: Asignar línea de cobro a su período.
    await step.run('asignar-periodo-cobro', async () => {
      if (!lineaCobroId) return;

      const supabase = crearClienteServiceRole();
      const periodoId = await obtenerOCrearPeriodoCobroAbierto(supabase, {
        tenantId,
        sellerId,
        fechaEntrega: new Date(fechaTransicion),
      });

      // UPDATE solo si la línea aún no tiene período asignado (idempotente).
      await supabase
        .schema('dinero')
        .from('lineas_cobro')
        .update({ periodo_cobro_id: periodoId, actualizado_en: new Date().toISOString() })
        .eq('id', lineaCobroId)
        .eq('tenant_id', tenantId)
        .is('periodo_cobro_id', null);
    });

    // Paso 4: Generar línea de liquidación (idempotente con ON CONFLICT DO NOTHING).
    const lineaLiquidacionId = await step.run('generar-linea-liquidacion', async () => {
      if (!elegibilidad.generaLiquidacion || !driverIdAsignado) {
        logger.info(`Pedido ${pedidoId}: no genera liquidación (estado=${estadoNuevo}, driver=${driverIdAsignado}).`);
        return null;
      }

      const supabase = crearClienteServiceRole();
      const montoBase = tarifa.montoConductorBase;
      const ajuste = elegibilidad.ajusteLiquidacionCLP;
      const concepto = `Liquidación entrega ${tipoPedido} — pedido ${pedidoId}`;

      const { data: insertada, error } = await supabase
        .schema('dinero')
        .from('lineas_liquidacion')
        .insert({
          tenant_id: tenantId,
          driver_id: driverIdAsignado,
          pedido_id: pedidoId,
          monto_base_clp: montoBase,
          ajuste_incidencia_clp: ajuste,
          concepto,
          fecha_entrega: fechaEntrega,
          incidencia_id: incidencia?.id ?? null,
          origen_generacion: 'motor_automatico',
        })
        .select('id')
        .maybeSingle();

      if (error && !error.message.includes('duplicate')) {
        throw new Error(`Error al insertar línea de liquidación: ${error.message}`);
      }

      if (insertada) return insertada.id as string;

      const { data: existente } = await supabase
        .schema('dinero')
        .from('lineas_liquidacion')
        .select('id')
        .eq('pedido_id', pedidoId)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      return existente?.id as string ?? null;
    });

    // Paso 5: Asignar línea de liquidación a su liquidación abierta.
    await step.run('asignar-liquidacion', async () => {
      if (!lineaLiquidacionId || !driverIdAsignado) return;

      const supabase = crearClienteServiceRole();
      const liquidacionId = await obtenerOCrearLiquidacionAbierta(supabase, {
        tenantId,
        driverId: driverIdAsignado,
        fechaEntrega: new Date(fechaTransicion),
      });

      await supabase
        .schema('dinero')
        .from('lineas_liquidacion')
        .update({ liquidacion_id: liquidacionId, actualizado_en: new Date().toISOString() })
        .eq('id', lineaLiquidacionId)
        .eq('tenant_id', tenantId)
        .is('liquidacion_id', null);
    });

    // Paso 6: Actualizar flags en operacion.pedidos.
    await step.run('actualizar-flags-pedido', async () => {
      const supabase = crearClienteServiceRole();

      // BUG FIX: la condición WHERE cobro_generado = false / liquidacion_generada = false
      // evita sobrescribir si el flag ya fue activado en un reintento previo.
      // Sin esta guarda, un segundo intento re-escribe el monto y el flag aunque
      // el INSERT haya sido absorbido por ON CONFLICT — comportamiento correcto
      // pero que puede sobreescribir un ajuste manual posterior.
      if (elegibilidad.generaCobro) {
        await supabase
          .schema('operacion')
          .from('pedidos')
          .update({
            cobro_generado: true,
            monto_cobro_clp: tarifa.montoCobroBase + elegibilidad.ajusteCobroCLP,
            actualizado_en: new Date().toISOString(),
          })
          .eq('id', pedidoId)
          .eq('tenant_id', tenantId)
          .eq('cobro_generado', false); // guarda idempotente
      }
      if (elegibilidad.generaLiquidacion) {
        await supabase
          .schema('operacion')
          .from('pedidos')
          .update({
            liquidacion_generada: true,
            monto_liquidacion_clp: tarifa.montoConductorBase + elegibilidad.ajusteLiquidacionCLP,
            actualizado_en: new Date().toISOString(),
          })
          .eq('id', pedidoId)
          .eq('tenant_id', tenantId)
          .eq('liquidacion_generada', false); // guarda idempotente
      }
    });

    // Paso 7: Bitácora de auditoría.
    await step.run('registrar-bitacora', async () => {
      const supabase = crearClienteServiceRole();
      await registrarEnBitacora(supabase, {
        tenantId,
        actorUsuarioId: null,
        actorTipo: 'sistema',
        accion: 'dinero.lineas_generadas',
        entidadTipo: 'pedido',
        entidadId: pedidoId,
        detalle: {
          estado_pedido: estadoNuevo,
          genera_cobro: elegibilidad.generaCobro,
          genera_liquidacion: elegibilidad.generaLiquidacion,
          monto_cobro: tarifa.montoCobroBase,
          monto_liquidacion: tarifa.montoConductorBase,
          es_gasto_propio: esGastoPropio,
          job_run_id: runId,
        },
      });
    });

    logger.info(
      `Pedido ${pedidoId}: líneas generadas. cobro=${elegibilidad.generaCobro}, ` +
      `liquidacion=${elegibilidad.generaLiquidacion}.`,
    );

    return {
      pedidoId,
      generaCobro: elegibilidad.generaCobro,
      lineaCobroId,
      generaLiquidacion: elegibilidad.generaLiquidacion,
      lineaLiquidacionId,
    };
  },
);
