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
 * Flujo `fallido → devuelto` (anulación pre-cierre):
 * Cuando llega `estadoNuevo = 'devuelto'` y YA EXISTE una línea para ese pedido,
 * el job anula la línea (soft-delete: `anulada = true`) SOLO si el período / la
 * liquidación todavía están en estado mutable:
 *   - cobro   : período `abierto`  → anular. cerrado/facturado → NO tocar; C6 detecta.
 *   - liquidac: liquidación `borrador` → anular. emitida/pagada → NO tocar; C6 detecta.
 * El `monto_final_clp` es GENERATED — no se puede setear. Para neutralizar el efecto
 * en los totales todos los cálculos de período / liquidación filtran `anulada = false`.
 *
 * Idempotencia:
 * - EventId = `dinero-lineas-${pedidoId}-${estadoNuevo}` — Inngest no deduplica
 *   eventos de estados distintos del mismo pedido (fix del bug original donde el
 *   EventId fijo hacía que el segundo evento financiero se deduplicase).
 * - INSERT ON CONFLICT (pedido_id) DO NOTHING — la BD absorbe el segundo intento.
 * - UPDATE con WHERE periodo_cobro_id IS NULL / liquidacion_id IS NULL — idempotente.
 * - Anular dos veces = no-op (la línea ya tiene `anulada = true`).
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

    // Paso 1b: Anulación pre-cierre (flujo fallido → devuelto).
    //
    // Si el estado nuevo NO genera cobro/liquidación Y ya existe una línea para
    // este pedido, hay que anularla — pero SOLO si el período / liquidación
    // todavía están en estado mutable (abierto / borrador). Si ya están cerrados /
    // facturados / emitidos / pagados, la compuerta humana manda: no tocar nada y
    // dejar que C6 (conciliación) detecte la discrepancia.
    //
    // Bitácora ANTES del efecto: se registra con accion 'dinero.lineas_anuladas_por_devolucion'
    // ANTES de hacer cualquier UPDATE (invariante CLAUDE.md).
    const anulacionRealizada = await step.run('anular-lineas-si-devolucion', async () => {
      // Solo aplica cuando el estado nuevo no genera cobro NI liquidación
      // (devuelto, cancelado, y el caso defensivo de estado no reconocido).
      if (elegibilidad.generaCobro || elegibilidad.generaLiquidacion) {
        return { anuloCobro: false, anuloLiquidacion: false };
      }

      const supabase = crearClienteServiceRole();
      let anuloCobro = false;
      let anuloLiquidacion = false;

      // --- Línea de cobro ---
      const { data: lineaCobro } = await supabase
        .schema('dinero')
        .from('lineas_cobro')
        .select('id, anulada, periodo_cobro_id')
        .eq('pedido_id', pedidoId)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (lineaCobro && !lineaCobro.anulada) {
        // Verificar estado del período antes de anular.
        let puedeAnularCobro = false;
        let estadoPeriodo: string | null = null;

        if (lineaCobro.periodo_cobro_id) {
          const { data: periodo } = await supabase
            .schema('dinero')
            .from('periodos_cobro')
            .select('estado')
            .eq('id', lineaCobro.periodo_cobro_id as string)
            .eq('tenant_id', tenantId)
            .maybeSingle();
          estadoPeriodo = periodo?.estado ?? null;
          puedeAnularCobro = estadoPeriodo === 'abierto';
        } else {
          // Línea sin período asignado aún — se puede anular libremente.
          puedeAnularCobro = true;
        }

        if (puedeAnularCobro) {
          // Bitácora ANTES del UPDATE (invariante financiero CLAUDE.md).
          await registrarEnBitacora(supabase, {
            tenantId,
            actorUsuarioId: null,
            actorTipo: 'sistema',
            accion: 'dinero.lineas_anuladas_por_devolucion',
            entidadTipo: 'pedido',
            entidadId: pedidoId,
            detalle: {
              tipo_linea: 'cobro',
              linea_id: lineaCobro.id,
              estado_pedido: estadoNuevo,
              periodo_cobro_id: lineaCobro.periodo_cobro_id ?? null,
              estado_periodo: estadoPeriodo,
              motivo: 'devolucion',
              job_run_id: runId,
            },
          });

          await supabase
            .schema('dinero')
            .from('lineas_cobro')
            .update({
              anulada: true,
              anulada_en: new Date().toISOString(),
              motivo_anulacion: 'devolucion',
              actualizado_en: new Date().toISOString(),
            })
            .eq('id', lineaCobro.id as string)
            .eq('tenant_id', tenantId)
            .eq('anulada', false); // idempotente: no re-anular si ya está anulada

          anuloCobro = true;

          // Resetear flag del pedido para reflejar que ya no tiene cobro activo.
          await supabase
            .schema('operacion')
            .from('pedidos')
            .update({
              cobro_generado: false,
              actualizado_en: new Date().toISOString(),
            })
            .eq('id', pedidoId)
            .eq('tenant_id', tenantId);
        } else {
          // Período ya cerrado/facturado — no tocar. C6 detectará la discrepancia.
          logger.info(
            `Pedido ${pedidoId}: línea de cobro no anulada — período en estado '${estadoPeriodo}' ` +
            `(solo se anulan en período 'abierto'). C6 (conciliación) detectará la discrepancia.`,
          );
        }
      }

      // --- Línea de liquidación ---
      const { data: lineaLiq } = await supabase
        .schema('dinero')
        .from('lineas_liquidacion')
        .select('id, anulada, liquidacion_id')
        .eq('pedido_id', pedidoId)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (lineaLiq && !lineaLiq.anulada) {
        let puedeAnularLiq = false;
        let estadoLiquidacion: string | null = null;

        if (lineaLiq.liquidacion_id) {
          const { data: liq } = await supabase
            .schema('dinero')
            .from('liquidaciones')
            .select('estado')
            .eq('id', lineaLiq.liquidacion_id as string)
            .eq('tenant_id', tenantId)
            .maybeSingle();
          estadoLiquidacion = liq?.estado ?? null;
          // Solo anular en borrador. 'emitida' y 'pagada' son inmutables.
          puedeAnularLiq = estadoLiquidacion === 'borrador';
        } else {
          // Línea sin liquidación asignada aún — se puede anular libremente.
          puedeAnularLiq = true;
        }

        if (puedeAnularLiq) {
          // Bitácora ANTES del UPDATE.
          await registrarEnBitacora(supabase, {
            tenantId,
            actorUsuarioId: null,
            actorTipo: 'sistema',
            accion: 'dinero.lineas_anuladas_por_devolucion',
            entidadTipo: 'pedido',
            entidadId: pedidoId,
            detalle: {
              tipo_linea: 'liquidacion',
              linea_id: lineaLiq.id,
              estado_pedido: estadoNuevo,
              liquidacion_id: lineaLiq.liquidacion_id ?? null,
              estado_liquidacion: estadoLiquidacion,
              motivo: 'devolucion',
              job_run_id: runId,
            },
          });

          await supabase
            .schema('dinero')
            .from('lineas_liquidacion')
            .update({
              anulada: true,
              anulada_en: new Date().toISOString(),
              motivo_anulacion: 'devolucion',
              actualizado_en: new Date().toISOString(),
            })
            .eq('id', lineaLiq.id as string)
            .eq('tenant_id', tenantId)
            .eq('anulada', false); // idempotente

          anuloLiquidacion = true;

          // Resetear flag del pedido.
          await supabase
            .schema('operacion')
            .from('pedidos')
            .update({
              liquidacion_generada: false,
              actualizado_en: new Date().toISOString(),
            })
            .eq('id', pedidoId)
            .eq('tenant_id', tenantId);
        } else {
          logger.info(
            `Pedido ${pedidoId}: línea de liquidación no anulada — liquidación en estado ` +
            `'${estadoLiquidacion}' (solo se anulan en 'borrador'). C6 detectará la discrepancia.`,
          );
        }
      }

      return { anuloCobro, anuloLiquidacion };
    });

    // Si ya anulamos líneas y el estado no genera nada nuevo, terminamos aquí.
    // No hace falta continuar con los pasos 2–6 (no hay líneas que insertar).
    if (!elegibilidad.generaCobro && !elegibilidad.generaLiquidacion) {
      logger.info(
        `Pedido ${pedidoId}: estado=${estadoNuevo} — no genera líneas nuevas. ` +
        `anuloCobro=${anulacionRealizada.anuloCobro}, anuloLiquidacion=${anulacionRealizada.anuloLiquidacion}.`,
      );
      return {
        pedidoId,
        generaCobro: false,
        lineaCobroId: null,
        generaLiquidacion: false,
        lineaLiquidacionId: null,
        anuloCobro: anulacionRealizada.anuloCobro,
        anuloLiquidacion: anulacionRealizada.anuloLiquidacion,
      };
    }

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

      // Conflicto: existe una línea con este pedido_id.
      // Si está anulada (reclasificación B1), reactivarla con los nuevos montos.
      const { data: existente } = await supabase
        .schema('dinero')
        .from('lineas_cobro')
        .select('id, anulada')
        .eq('pedido_id', pedidoId)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (!existente) return null;

      if (existente.anulada) {
        await supabase
          .schema('dinero')
          .from('lineas_cobro')
          .update({
            anulada: false,
            anulada_en: null,
            motivo_anulacion: null,
            monto_base_clp: montoBase,
            ajuste_incidencia_clp: ajuste,
            concepto,
            fecha_entrega: fechaEntrega,
            incidencia_id: incidencia?.id ?? null,
            origen_generacion: 'motor_automatico',
            actualizado_en: new Date().toISOString(),
          })
          .eq('id', existente.id as string)
          .eq('tenant_id', tenantId)
          .eq('anulada', true); // idempotente
      }

      return existente.id as string;
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

      // Conflicto: si la línea existente está anulada (reclasificación B1), reactivarla.
      const { data: existente } = await supabase
        .schema('dinero')
        .from('lineas_liquidacion')
        .select('id, anulada')
        .eq('pedido_id', pedidoId)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (!existente) return null;

      if (existente.anulada) {
        await supabase
          .schema('dinero')
          .from('lineas_liquidacion')
          .update({
            anulada: false,
            anulada_en: null,
            motivo_anulacion: null,
            monto_base_clp: montoBase,
            ajuste_incidencia_clp: ajuste,
            concepto,
            fecha_entrega: fechaEntrega,
            incidencia_id: incidencia?.id ?? null,
            origen_generacion: 'motor_automatico',
            actualizado_en: new Date().toISOString(),
          })
          .eq('id', existente.id as string)
          .eq('tenant_id', tenantId)
          .eq('anulada', true); // idempotente
      }

      return existente.id as string;
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
