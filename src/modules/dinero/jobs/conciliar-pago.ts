/**
 * Job · dinero/conciliarPago — matching de cobranza courier→seller (capa "pagado")
 * =====================================================================
 * Trigger: evento `dinero/pago.recibido` (lo publica el webhook de Fintoc).
 *
 * Responsabilidad (Decisión 6 del arquitecto, `docs/arquitectura/cobranza-fintoc.md`):
 * implementa la cascada de matching de un pago recibido, idempotente y con
 * reintentos. El trabajo pesado va aquí, NUNCA en el request del webhook.
 *
 *  1. UPSERT idempotente en `dinero.pagos_recibidos` por
 *     `(tenant_id, movimiento_externo_id)`. Si ya existe en estado terminal
 *     (`conciliado`/`descartado`), termina sin re-procesar.
 *  2. Atribuir seller por `contraparte_rut_normalizado` (mismo `normalizarRut`
 *     en ambos lados) → `atribuido`, o `sin_atribuir` si no hay RUT/seller.
 *  3. Conciliar contra períodos `facturado` con `estado_cobro in
 *     ('pendiente','parcial')` del seller cuyo saldo calce ±1 CLP:
 *       - calce total  → pago `conciliado`, período `estado_cobro='pagado'`.
 *       - abono parcial → pago `parcial`, período `estado_cobro='parcial'`.
 *       - sobrante / ambigüedad → `sobrante` (no adivina).
 *       - sin candidato → queda `atribuido`/`sin_atribuir`.
 *  4. Proyectar a `periodos_cobro` (estado_cobro/monto_pagado_clp/pagado_en):
 *     SOLO este job (service_role) escribe esa proyección.
 *  5. Emitir `dinero/pago.conciliado` cuando hubo imputación.
 *
 * La glosa NO se usa como llave automática (Decisión 6 + §5b del doc).
 *
 * Idempotencia:
 * - EventId del send aguas arriba + UNIQUE (tenant, movimiento_externo_id):
 *   un reintento no duplica la fila ni la imputación. La proyección al período
 *   solo se aplica cuando la fila TRANSICIONA a conciliado/parcial desde un
 *   estado no terminal (se detecta por el estado previo leído en el UPSERT).
 *
 * SEGURIDAD:
 * - Solo se loguean tenant_id e IDs — nunca RUT/nombre de contraparte, montos
 *   cruzados ni secretos. `link_token_ref` es una referencia opaca, no el token.
 */

import { inngest } from '@/lib/inngest/cliente';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { conciliarPagoPersistido } from '../aplicar-pago';

interface DatosPagoRecibido {
  tenantId: string;
  movimientoExternoId: string;
  montoClp: number;
  fechaMovimiento: string;
  contraparteRutNormalizado: string | null;
  contraparteNombre: string | null;
  linkTokenRef: string;
}

export const jobConciliarPago = inngest.createFunction(
  {
    id: 'dinero/conciliarPago',
    name: 'Dinero · Conciliar pago recibido (cobranza Fintoc)',
    triggers: [{ event: 'dinero/pago.recibido' }],
    retries: 3,
  },
  async ({ event, step, logger, runId }) => {
    const datos = event.data as DatosPagoRecibido;
    const { tenantId, movimientoExternoId } = datos;

    logger.info(
      `Conciliando pago ${movimientoExternoId} del tenant ${tenantId}.`,
    );

    // --- Paso 1: UPSERT idempotente en pagos_recibidos -----------------------
    const pagoId = await step.run('upsert-pago', async () => {
      const supabase = crearClienteServiceRole();

      // ¿Ya existe el movimiento (idempotencia por reintento del job/webhook)?
      const { data: existente } = await supabase
        .schema('dinero')
        .from('pagos_recibidos')
        .select('id, estado_match')
        .eq('tenant_id', tenantId)
        .eq('movimiento_externo_id', movimientoExternoId)
        .maybeSingle();

      if (existente) return existente.id as string;

      const { data: insertada, error } = await supabase
        .schema('dinero')
        .from('pagos_recibidos')
        .insert({
          tenant_id: tenantId,
          movimiento_externo_id: movimientoExternoId,
          monto_clp: Math.round(Number(datos.montoClp)),
          fecha_movimiento: datos.fechaMovimiento,
          contraparte_rut_normalizado: datos.contraparteRutNormalizado,
          contraparte_nombre: datos.contraparteNombre,
          link_token_ref: datos.linkTokenRef,
          estado_match: 'sin_atribuir',
          job_run_id: runId,
        })
        .select('id')
        .single();

      // Carrera: si dos ejecuciones insertan a la vez, el UNIQUE rechaza la
      // segunda — releemos la fila ganadora en vez de fallar.
      if (error) {
        const { data: tras } = await supabase
          .schema('dinero')
          .from('pagos_recibidos')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('movimiento_externo_id', movimientoExternoId)
          .maybeSingle();
        if (tras) return tras.id as string;
        throw new Error(`Error al ingerir pago: ${error.message}`);
      }

      return insertada.id as string;
    });

    // --- Pasos 2-5: cascada de matching + proyección + evento ----------------
    const resultado = await step.run('cascada-matching', async () => {
      return conciliarPagoPersistido(pagoId, tenantId, { jobRunId: runId });
    });

    if (resultado.resultado === 'conciliado' || resultado.resultado === 'parcial') {
      await step.run('emitir-pago-conciliado', async () => {
        await inngest.send({
          name: 'dinero/pago.conciliado',
          id: `pago-conciliado-${pagoId}-${resultado.periodoId}`,
          data: {
            tenantId,
            pagoRecibidoId: pagoId,
            sellerId: resultado.sellerId,
            periodoCobroId: resultado.periodoId,
            montoClp: resultado.montoClp,
            resultado:
              resultado.resultado === 'conciliado' ? 'pagado_total' : 'pagado_parcial',
          },
        });
      });
    }

    logger.info(
      `Pago ${movimientoExternoId} (tenant ${tenantId}) → estado '${resultado.resultado}'.`,
    );

    return { pagoId, resultado: resultado.resultado };
  },
);
