/**
 * Job F19 · dinero/ejecutarPayout
 * =====================================================================
 * Trigger: evento `dinero/liquidacion.pago-solicitado`
 * (publicado SOLO por la acción humana `emitirPagoLiquidacion`, gate
 *  `puedeGestionarLiquidacionesConductores` — compuerta de pago a conductor).
 *
 * NUNCA se dispara automáticamente desde un cron: la transferencia de dinero
 * real al conductor exige que una persona con permiso lo solicite.
 *
 * Responsabilidad:
 * - Leer la liquidación y verificar idempotencia (estado 'pagada' → early return).
 * - Leer datos bancarios del conductor.
 * - Calcular el monto líquido tras retención.
 * - Insertar idempotentemente en `dinero.payouts_conductor`.
 * - Llamar al adaptador del puerto `PuertoPayout` (Fintoc / stub / manual).
 * - Proyectar estado: payout → 'enviado' o terminal; liquidación → 'pagada'.
 * - Registrar bitácora del resultado.
 *
 * Invariantes de dinero saliente:
 * - `UNIQUE (tenant_id, liquidacion_id)` en `payouts_conductor` es la barrera
 *   de doble-pago: un segundo INSERT choca con 23505 en vez de transferir dos veces.
 * - `idempotencyKey = payout-${liquidacionId}` — NUNCA aleatoria. Si el job se
 *   reintenta, el mismo key hace que Fintoc/stub deduplique externamente.
 * - Secretos (API keys) NUNCA en logs ni en errores.
 *
 * Errores no-reintentables (NonRetriableError):
 * - `ErrorPayoutConfig`: falta config, falta cuenta bancaria del conductor,
 *   monto <= 0. Reintentar no ayuda: requiere acción del operador.
 * - Payout 'rechazado': el proveedor rechazó por causa de negocio. No reintentar.
 *
 * Errores reintentables (throw normal → Inngest reintenta hasta `retries: 3`):
 * - `ErrorPayoutOperativo`: timeout, red, 5xx. El mismo `idempotencyKey` evita
 *   la doble transferencia al reintentar.
 */

import { NonRetriableError } from 'inngest';
import { inngest } from '@/lib/inngest/cliente';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import { obtenerPuertoPayout } from '@/modules/integraciones/pagos/payout/fabrica-payout';
import { ErrorPayoutConfig } from '@/modules/integraciones/pagos/payout/errores';
import { calcularMontoPayout } from './calculo-payout';

export const jobEjecutarPayout = inngest.createFunction(
  {
    id: 'dinero/ejecutarPayout',
    name: 'Dinero · Ejecutar pago a conductor',
    triggers: [{ event: 'dinero/liquidacion.pago-solicitado' }],
    retries: 3,
  },
  async ({ event, step, logger }) => {
    const { liquidacionId, tenantId, driverId, montoTotalClp, solicitadoPorUsuarioId } =
      event.data as {
        liquidacionId: string;
        tenantId: string;
        driverId: string;
        montoTotalClp: number;
        solicitadoPorUsuarioId: string;
      };

    // -------------------------------------------------------------------------
    // Step 1 — Verificar idempotencia: leer liquidación + fila previa en payouts
    // -------------------------------------------------------------------------
    const contextoInicial = await step.run('verificar-idempotencia', async () => {
      const supabase = crearClienteServiceRole();

      // Leer la liquidación.
      const { data: liq, error: errLiq } = await supabase
        .schema('dinero')
        .from('liquidaciones')
        .select('id, tenant_id, driver_id, estado, monto_total_clp, bono_clp, penalizacion_clp, tipo_relacion_conductor')
        .eq('id', liquidacionId)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (errLiq) throw new Error(`Error al leer liquidación: ${errLiq.message}`);
      if (!liq) throw new NonRetriableError(`Liquidación ${liquidacionId} no encontrada.`);

      // Si ya está pagada: el job ya corrió y completó — salida temprana.
      if (liq.estado === 'pagada') {
        return { yaCompletado: true as const, liquidacion: liq, payoutExistente: null };
      }

      // A-1: Solo procesar liquidaciones en estado 'emitida'. Cualquier otro estado
      // (borrador, etc.) indica que la compuerta humana no se completó correctamente.
      if (liq.estado !== 'emitida') {
        throw new NonRetriableError(
          `La liquidación está en estado '${liq.estado}' — solo se puede pagar en estado 'emitida'.`,
        );
      }

      // Verificar si existe un payout no-terminal para esta liquidación.
      const { data: payoutExistente, error: errPayout } = await supabase
        .schema('dinero')
        .from('payouts_conductor')
        .select('id, estado')
        .eq('tenant_id', tenantId)
        .eq('liquidacion_id', liquidacionId)
        .maybeSingle();

      if (errPayout) throw new Error(`Error al leer payout existente: ${errPayout.message}`);

      if (payoutExistente) {
        const estadoPayout = payoutExistente.estado as string;
        // Si ya está confirmado o en curso, no hacer nada más.
        if (estadoPayout === 'confirmado' || estadoPayout === 'enviado' || estadoPayout === 'procesando') {
          logger.info(`Payout ${payoutExistente.id} ya está en estado '${estadoPayout}' — nada que hacer.`);
          return { yaCompletado: true as const, liquidacion: liq, payoutExistente };
        }
        // Si está en estado terminal reintentable (fallido/rechazado): continuar
        // con el flujo para intentar de nuevo.
      }

      return { yaCompletado: false as const, liquidacion: liq, payoutExistente };
    });

    if (contextoInicial.yaCompletado) {
      return { resultado: 'ya_completado', liquidacionId };
    }

    const { liquidacion } = contextoInicial;

    // -------------------------------------------------------------------------
    // Step 2 — Leer datos bancarios del conductor
    // -------------------------------------------------------------------------
    const datosConductor = await step.run('leer-conductor', async () => {
      const supabase = crearClienteServiceRole();

      const { data: conductor, error } = await supabase
        .schema('identidad')
        .from('conductores')
        .select('id, nombre_completo, rut, banco, tipo_cuenta, numero_cuenta, tipo_relacion')
        .eq('id', driverId)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (error) throw new Error(`Error al leer conductor: ${error.message}`);
      if (!conductor) {
        throw new NonRetriableError(
          `Conductor ${driverId} no encontrado en el tenant — no se puede ejecutar el payout.`,
        );
      }

      // Datos bancarios son necesarios para la transferencia. Si no están
      // configurados, no reintentar (requiere acción del operador).
      const fila = conductor as Record<string, unknown>;
      const banco = typeof fila.banco === 'string' ? fila.banco : null;
      const tipoCuenta = typeof fila.tipo_cuenta === 'string' ? fila.tipo_cuenta : null;
      const numeroCuenta = typeof fila.numero_cuenta === 'string' ? fila.numero_cuenta : null;

      if (!banco || !tipoCuenta || !numeroCuenta) {
        throw new NonRetriableError(
          `El conductor no tiene datos bancarios completos (banco, tipo_cuenta, numero_cuenta). ` +
            `Configure la cuenta destino antes de solicitar el pago.`,
        );
      }

      return {
        rut: fila.rut as string,
        nombreCompleto: fila.nombre_completo as string,
        banco,
        tipoCuenta,
        numeroCuenta,
        tipoRelacion: fila.tipo_relacion as string,
      };
    });

    // -------------------------------------------------------------------------
    // Step 3 — Calcular monto líquido (bruto − retención)
    // -------------------------------------------------------------------------
    const montoLiquidoClp = await step.run('calcular-monto-liquido', async () => {
      const supabase = crearClienteServiceRole();

      // Leer configuración de payout del tenant (retención, método, mínimos).
      const { data: config, error: errConfig } = await supabase
        .schema('identidad')
        .from('courier_config_payout')
        .select('porcentaje_retencion, metodo_default, minimo_retiro_clp')
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (errConfig) throw new Error(`Error al leer config de payout: ${errConfig.message}`);

      // Si no hay config aún: porcentaje 0, sin mínimo (modo permisivo — el
      // courier no ha configurado retención todavía).
      const configData = config as Record<string, unknown> | null;
      const porcentajeRetencion =
        configData && typeof configData.porcentaje_retencion === 'number'
          ? configData.porcentaje_retencion
          : 0;

      const minimoRetiroClp =
        configData && typeof configData.minimo_retiro_clp === 'number'
          ? configData.minimo_retiro_clp
          : 0;

      // A-2: La base de pago real incluye bono y descuenta penalizaciones.
      // montoTotalClp del evento = solo suma de líneas (sin bono/penalización).
      // Usamos los valores frescos de BD leídos en el step 1.
      const liqData = liquidacion as Record<string, unknown>;

      // Fórmula compartida con `preflightEmitirPago` (`../calculo-payout.ts`) —
      // ambos DEBEN usar la misma función para que el preflight y el job nunca
      // diverjan en el monto que muestran/transfieren.
      const { montoBrutoClp, montoRetencionClp, montoLiquidoClp: monto } = calcularMontoPayout({
        montoTotalClp: (liqData.monto_total_clp as number) ?? 0,
        bonoClp: (liqData.bono_clp as number) ?? 0,
        penalizacionClp: (liqData.penalizacion_clp as number) ?? 0,
        tipoRelacion: datosConductor.tipoRelacion as 'dependiente' | 'independiente',
        porcentajeRetencion,
      });

      if (monto <= 0) {
        throw new NonRetriableError(
          `El monto líquido calculado es ${monto} CLP — no se puede ejecutar un payout de monto no positivo.`,
        );
      }

      if (minimoRetiroClp > 0 && monto < minimoRetiroClp) {
        throw new NonRetriableError(
          `El monto líquido ${monto} CLP es menor al mínimo de retiro configurado (${minimoRetiroClp} CLP). ` +
            `Ajuste la configuración o acumule más entregas antes de pagar.`,
        );
      }

      const porcentajeEfectivo = datosConductor.tipoRelacion === 'independiente' ? porcentajeRetencion : 0;
      return { montoLiquidoClp: monto, montoBrutoClp, montoRetencionClp, porcentajeRetencion: porcentajeEfectivo, tipoRelacion: datosConductor.tipoRelacion };
    });

    const { montoLiquidoClp: montoLiquido, montoBrutoClp, montoRetencionClp } = montoLiquidoClp;

    // -------------------------------------------------------------------------
    // Step 4 — Insertar en payouts_conductor (idempotente vía ON CONFLICT)
    // -------------------------------------------------------------------------
    const payoutId = await step.run('insertar-payout', async () => {
      const supabase = crearClienteServiceRole();

      // Leer método para persistir en el payout.
      const { data: config } = await supabase
        .schema('identidad')
        .from('courier_config_payout')
        .select('metodo_default')
        .eq('tenant_id', tenantId)
        .maybeSingle();

      const configData = config as Record<string, unknown> | null;
      const metodo =
        configData && typeof configData.metodo_default === 'string'
          ? configData.metodo_default
          : 'manual';

      // Intentar insertar. Si ya existe (estado fallido/rechazado de un intento
      // anterior), el ON CONFLICT DO UPDATE lo restablece a 'pendiente' para
      // reintentar. Si existe en estado no-terminal, la barrera UNIQUE + filtro
      // del WHERE lo deja intacto.
      //
      // Nota: Supabase/PostgREST no soporta ON CONFLICT con WHERE clause parcial
      // directamente en upsert. Usamos insert con ignoreDuplicates=false para
      // capturar el conflicto y luego leemos la fila existente.
      const { data: inserted, error: errInsert } = await supabase
        .schema('dinero')
        .from('payouts_conductor')
        .insert({
          tenant_id: tenantId,
          driver_id: driverId,
          liquidacion_id: liquidacionId,
          monto_bruto_clp: montoBrutoClp,
          monto_retencion_clp: montoRetencionClp,
          monto_liquido_clp: montoLiquido,
          tipo_relacion_conductor: liquidacion.tipo_relacion_conductor as string,
          metodo,
          estado: 'pendiente',
          solicitado_por_usuario_id: solicitadoPorUsuarioId,
        })
        .select('id')
        .maybeSingle();

      if (errInsert) {
        // Error 23505 = unique_violation (payout ya existe para esta liquidación).
        // Leer la fila existente y devolver su id.
        if ((errInsert as { code?: string }).code === '23505') {
          const { data: existente, error: errExistente } = await supabase
            .schema('dinero')
            .from('payouts_conductor')
            .select('id, estado')
            .eq('tenant_id', tenantId)
            .eq('liquidacion_id', liquidacionId)
            .maybeSingle();

          if (errExistente) throw new Error(`Error al leer payout existente: ${errExistente.message}`);
          if (!existente) throw new Error('Conflicto de unicidad pero payout no encontrado.');

          const estadoExistente = (existente as Record<string, unknown>).estado as string;
          // Si ya está en un estado no-reintentable desde este job, salir.
          if (estadoExistente === 'confirmado' || estadoExistente === 'enviado') {
            logger.info(
              `Payout ${(existente as Record<string, unknown>).id} ya existe en estado '${estadoExistente}'.`,
            );
            return (existente as Record<string, unknown>).id as string;
          }

          // Estado fallido/rechazado de un intento previo: actualizar a pendiente
          // para reintentar (el idempotencyKey evita doble transferencia).
          if (estadoExistente === 'fallido' || estadoExistente === 'rechazado') {
            const { error: errUpdate } = await supabase
              .schema('dinero')
              .from('payouts_conductor')
              .update({ estado: 'pendiente', error_descripcion: null, actualizado_en: new Date().toISOString() })
              .eq('tenant_id', tenantId)
              .eq('liquidacion_id', liquidacionId);
            if (errUpdate) throw new Error(`Error al restablecer payout: ${errUpdate.message}`);
          }

          return (existente as Record<string, unknown>).id as string;
        }
        throw new Error(`Error al insertar payout: ${errInsert.message}`);
      }

      return (inserted as Record<string, unknown> | null)?.id as string;
    });

    // -------------------------------------------------------------------------
    // Step 5 — Llamar al puerto PuertoPayout
    // -------------------------------------------------------------------------
    const resultadoPayout = await step.run('llamar-puerto-payout', async () => {
      // Obtener el adaptador (stub, manual o Fintoc real según el gate).
      let puerto;
      try {
        puerto = await obtenerPuertoPayout(tenantId);
      } catch (err) {
        if (err instanceof ErrorPayoutConfig) {
          throw new NonRetriableError(err.message);
        }
        throw err;
      }

      const idempotencyKey = `payout-${liquidacionId}`;

      let resultado;
      try {
        resultado = await puerto.crearPayout({
          idempotencyKey,
          montoLiquidoClp: montoLiquido,
          destinatario: {
            rut: datosConductor.rut,
            nombreCuenta: datosConductor.nombreCompleto,
            banco: datosConductor.banco,
            tipoCuenta: datosConductor.tipoCuenta,
            numeroCuenta: datosConductor.numeroCuenta,
          },
          referencia: `Liquidacion ${liquidacionId.slice(0, 8)}`,
        });
      } catch (err) {
        // ErrorPayoutConfig: no reintentable (falta credencial, cuenta inválida, etc.)
        if (err instanceof ErrorPayoutConfig) {
          throw new NonRetriableError(err.message);
        }
        // Otros errores (red, 5xx) → Inngest reintenta.
        throw err;
      }

      return resultado;
    });

    // -------------------------------------------------------------------------
    // Step 6 — Persistir resultado y proyectar estado
    // -------------------------------------------------------------------------
    await step.run('persistir-resultado', async () => {
      const supabase = crearClienteServiceRole();
      const ahora = new Date().toISOString();

      const estadoMapeado =
        resultadoPayout.estado === 'enviado'
          ? 'enviado'
          : resultadoPayout.estado === 'rechazado'
            ? 'rechazado'
            : 'fallido';

      // Actualizar fila del payout con el resultado.
      const { error: errUpdatePayout } = await supabase
        .schema('dinero')
        .from('payouts_conductor')
        .update({
          estado: estadoMapeado,
          payout_externo_id: resultadoPayout.payoutExternoId ?? null,
          comprobante_ref: resultadoPayout.comprobanteRef ?? null,
          // errorDescripcion se limpia en 'enviado', se pone en 'rechazado'/'fallido'.
          error_descripcion:
            resultadoPayout.estado !== 'enviado'
              ? (resultadoPayout.errorDescripcion ?? null)
              : null,
          actualizado_en: ahora,
        })
        .eq('id', payoutId)
        .eq('tenant_id', tenantId);

      if (errUpdatePayout) {
        throw new Error(`Error al actualizar payout: ${errUpdatePayout.message}`);
      }

      // Si fue enviado: proyectar la liquidación a 'pagada'.
      if (resultadoPayout.estado === 'enviado') {
        const { error: errUpdateLiq } = await supabase
          .schema('dinero')
          .from('liquidaciones')
          .update({ estado: 'pagada', actualizado_en: ahora })
          .eq('id', liquidacionId)
          .eq('tenant_id', tenantId);

        if (errUpdateLiq) {
          throw new Error(`Error al proyectar liquidación a 'pagada': ${errUpdateLiq.message}`);
        }
      }

      // Bitácora del resultado — DESPUÉS de los writes pero DENTRO del mismo step
      // (acción financiera de sistema con trazabilidad, RNF-04). No incluimos
      // payout_externo_id en la bitácora (es un tracing ID, pero caution-first).
      await registrarEnBitacora(supabase, {
        tenantId,
        actorUsuarioId: null,
        actorTipo: 'sistema',
        accion: 'dinero.payout_ejecutado',
        entidadTipo: 'liquidacion',
        entidadId: liquidacionId,
        detalle: {
          payout_id: payoutId,
          driver_id: driverId,
          monto_bruto_clp: montoBrutoClp,
          monto_liquido_clp: montoLiquido,
          estado_payout: estadoMapeado,
          solicitado_por_usuario_id: solicitadoPorUsuarioId,
        },
      });

      return { estadoMapeado };
    });

    // Resultado rechazado: no actualizar liquidación a 'pagada', no reintentar.
    if (resultadoPayout.estado === 'rechazado') {
      throw new NonRetriableError(
        `El proveedor rechazó el payout para la liquidación ${liquidacionId}: ` +
          (resultadoPayout.errorDescripcion ?? 'causa no especificada por el proveedor.'),
      );
    }

    // Resultado fallido: lanzar para que Inngest reintente (el mismo idempotencyKey
    // evita doble transferencia en el reintento).
    if (resultadoPayout.estado === 'fallido') {
      throw new Error(
        `Error transitorio al ejecutar payout para la liquidación ${liquidacionId}. ` +
          'Inngest reintentará con el mismo idempotencyKey.',
      );
    }

    logger.info(
      `Payout para liquidación ${liquidacionId} ejecutado exitosamente (estado: enviado).`,
    );

    return {
      resultado: 'enviado',
      liquidacionId,
      payoutId,
    };
  },
);
