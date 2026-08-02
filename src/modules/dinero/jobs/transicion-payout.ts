/**
 * Transición de estado compartida de un payout a conductor (F19, Bloque 3).
 * =============================================================================
 *
 * FUENTE ÚNICA de la tabla de traducción `estado_externo → payout/liquidación`,
 * usada TANTO por el webhook de confirmación instantánea
 * (`jobs/aplicar-actualizacion-payout.ts`, evento `dinero/payout.actualizacion-externa`)
 * COMO por el polling de respaldo (`jobs/consultar-estado-payout.ts`). Antes
 * cada uno tenía su propia copia de esta lógica — ahora viven en un solo
 * lugar para que webhook y polling NUNCA diverjan.
 *
 * Tabla de transición (estado externo → efecto):
 * - `confirmado`  → payout → 'confirmado' (guard `.eq('estado','enviado')`,
 *   idempotente); proyecta liquidación `emitida→pagada` (no-op si ya estaba
 *   pagada — el caso normal, porque `jobEjecutarPayout` la marca 'pagada' de
 *   forma OPTIMISTA en cuanto el proveedor acepta el envío, sin esperar esta
 *   confirmación asíncrona).
 * - `rechazado`/`fallido` → payout → ese estado; SI la liquidación estaba
 *   'pagada' (el caso típico, por la marca optimista de arriba) → se revierte
 *   a 'emitida' + se crea una excepción de conciliación
 *   `payout_revertido_post_confirmacion` + se alerta a observabilidad (nivel
 *   `error` — es una reversión financiera real, no un evento silencioso).
 * - `pendiente` → no-op explícito (el proveedor aún no resolvió).
 * - `desconocido` → CERO mutación financiera. Solo alerta (warning) + una
 *   excepción de conciliación `payout_estado_no_reconocido` (categoría
 *   `integridad_datos`, acción `revisar_estado_externo` — NO
 *   `payout_revertido_post_confirmacion`/`gestionar_pago_conductor`: un
 *   status no reconocido no es un pago pendiente) para revisión humana
 *   (status no reconocido — p. ej. `reject_failed` de Fintoc).
 *
 * Idempotencia:
 * - Cada mutación va guardada con `.eq('estado', <esperado>)` (o `.select().maybeSingle()`
 *   para saber si el guard realmente aplicó) — reaplicar el mismo evento
 *   (replay del webhook, re-ejecución del polling) no duplica efectos.
 * - La excepción de conciliación se inserta a lo sumo una vez por liquidación
 *   (`existeEventoConciliacion`, misma barrera que usa C7).
 * - Esta función SIEMPRE relee el estado actual del payout desde BD — nunca
 *   confía en el estado que traiga el evento/caller (defensa contra eventos
 *   fuera de orden).
 *
 * SEGURIDAD: nunca recibe ni loguea el secreto del webhook ni credenciales del
 * proveedor — solo IDs de dominio y el motivo ya saneado por el adaptador.
 */

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import { capturarMensaje } from '@/lib/observabilidad';
import type { EstadoExternoEventoPayout } from '@/modules/integraciones/pagos';
import { existeEventoConciliacion, insertarEventoConciliacion } from '../conciliacion-insercion';
import type { EstadoLiquidacion, EstadoPayout } from '../tipos';

export type OrigenTransicionPayout = 'webhook' | 'polling';

export interface AplicarTransicionPayoutArgs {
  tenantId: string;
  payoutId: string;
  estadoExterno: EstadoExternoEventoPayout;
  /** Motivo de rechazo/reversión ya saneado (`return_reason` de Fintoc), o `null`. */
  motivo: string | null;
  /** Referencia al comprobante (`receipt_url` de Fintoc), o `null`. */
  comprobanteRef: string | null;
  /** Quién dispara la transición — solo para trazabilidad (bitácora/alertas). */
  origen: OrigenTransicionPayout;
  /** runId de Inngest, para correlacionar en observabilidad y en `job_run_id`. */
  jobRunId?: string | null;
}

export interface ResultadoTransicionPayout {
  resultado: EstadoExternoEventoPayout;
  payoutId: string;
  liquidacionId: string;
  driverId: string;
  /** true si ESTA llamada mutó el estado del payout (no fue un no-op idempotente). */
  transicionAplicada: boolean;
  /** true si ESTA llamada revirtió la liquidación de 'pagada' a 'emitida'. */
  liquidacionRevertida: boolean;
}

/**
 * Estados terminales NEGATIVOS del payout: una vez alcanzados, el proveedor no
 * "revive" el transfer — Fintoc no vuelve un transfer rechazado/devuelto a
 * `succeeded`. Defensa contra DESORDEN de entrega del webhook: un evento
 * `confirmado` (`succeeded`) que llega cuando el payout YA está aquí es
 * necesariamente un evento STALE/reordenado en el transporte (nunca puede ser
 * la verdad más reciente) — se ignora en vez de "revivir" el payout.
 */
const ESTADOS_PAYOUT_TERMINALES_NEGATIVOS: ReadonlySet<EstadoPayout> = new Set(['rechazado', 'fallido']);

/**
 * true si el evento es un `confirmado` que llega DESPUÉS de que el payout ya
 * quedó en un estado terminal negativo — el caso de DESORDEN que
 * `aplicarTransicionPayout` debe rechazar sin mutar nada. Pura — ningún I/O.
 */
export function esConfirmacionTardiaInvalida(
  estadoExterno: EstadoExternoEventoPayout,
  estadoPayoutActual: EstadoPayout,
): boolean {
  return estadoExterno === 'confirmado' && ESTADOS_PAYOUT_TERMINALES_NEGATIVOS.has(estadoPayoutActual);
}

/** Estado destino del payout para cada estado externo. `null` = sin mutación de payout. */
export function estadoPayoutDestino(estadoExterno: EstadoExternoEventoPayout): EstadoPayout | null {
  switch (estadoExterno) {
    case 'confirmado':
      return 'confirmado';
    case 'rechazado':
      return 'rechazado';
    case 'fallido':
      return 'fallido';
    case 'pendiente':
    case 'desconocido':
      return null;
  }
}

/**
 * true si, dado el estado externo del evento y el estado ACTUAL (fresco) de
 * la liquidación, corresponde revertirla de 'pagada' a 'emitida'. Pura —
 * ningún I/O.
 */
export function debeRevertirLiquidacion(
  estadoExterno: EstadoExternoEventoPayout,
  estadoLiquidacionActual: EstadoLiquidacion,
): boolean {
  if (estadoExterno !== 'rechazado' && estadoExterno !== 'fallido') return false;
  return estadoLiquidacionActual === 'pagada';
}

/** Accion de bitácora por estado externo (solo para 'confirmado'/'rechazado'/'fallido'). */
function accionBitacoraPorEstado(estadoExterno: EstadoExternoEventoPayout): string {
  switch (estadoExterno) {
    case 'confirmado':
      return 'dinero.payout_confirmado';
    case 'rechazado':
      return 'dinero.payout_rechazado';
    case 'fallido':
      return 'dinero.payout_fallido';
    default:
      return 'dinero.payout_evento_sin_mutacion';
  }
}

export async function aplicarTransicionPayout(
  args: AplicarTransicionPayoutArgs,
): Promise<ResultadoTransicionPayout> {
  const supabase = crearClienteServiceRole();
  const ahora = new Date().toISOString();

  // Releer el payout SIEMPRE desde BD — nunca confiar en el estado que traiga
  // el evento/caller (defensa contra eventos fuera de orden o payloads viejos).
  const { data: payoutFila, error: errPayout } = await supabase
    .schema('dinero')
    .from('payouts_conductor')
    .select('id, driver_id, liquidacion_id, estado')
    .eq('id', args.payoutId)
    .eq('tenant_id', args.tenantId)
    .maybeSingle();

  if (errPayout) {
    throw new Error(`Error al leer payout ${args.payoutId}: ${errPayout.message}`);
  }
  if (!payoutFila) {
    throw new Error(`Payout ${args.payoutId} no encontrado en el tenant ${args.tenantId}.`);
  }

  const driverId = payoutFila.driver_id as string;
  const liquidacionId = payoutFila.liquidacion_id as string;
  const estadoPayoutActual = payoutFila.estado as EstadoPayout;

  const sinResultado = (resultado: EstadoExternoEventoPayout): ResultadoTransicionPayout => ({
    resultado,
    payoutId: args.payoutId,
    liquidacionId,
    driverId,
    transicionAplicada: false,
    liquidacionRevertida: false,
  });

  // 'pendiente': no-op explícito — el proveedor aún no resolvió.
  if (args.estadoExterno === 'pendiente') {
    return sinResultado('pendiente');
  }

  // 'desconocido': CERO mutación financiera. Alerta + excepción para revisión humana.
  if (args.estadoExterno === 'desconocido') {
    await capturarMensaje(
      `Webhook/polling de payout con estado externo no reconocido ('desconocido') — revisión manual requerida.`,
      'warning',
      {
        origen: `payout:${args.origen}`,
        tenantId: args.tenantId,
        correlacionId: args.jobRunId ?? undefined,
        etiquetas: { payout_id: args.payoutId, liquidacion_id: liquidacionId },
      },
    );

    const yaExiste = await existeEventoConciliacion(
      supabase,
      args.tenantId,
      'payout_estado_no_reconocido',
      { liquidacionId },
    );
    if (!yaExiste) {
      await insertarEventoConciliacion(supabase, {
        tenant_id: args.tenantId,
        driver_id: driverId,
        liquidacion_id: liquidacionId,
        tipo_diferencia: 'payout_estado_no_reconocido',
        descripcion:
          `Payout ${args.payoutId} (liquidación ${liquidacionId}): el proveedor reportó un ` +
          `estado no reconocido ('desconocido') en un evento de ${args.origen === 'webhook' ? 'webhook' : 'sondeo'}. ` +
          `No se aplicó ninguna mutación financiera — revisar manualmente contra el proveedor.`,
        monto_diferencia_clp: null,
        estado: 'pendiente',
        job_run_id: args.jobRunId ?? 'sin-run-id',
      });
    }

    return sinResultado('desconocido');
  }

  // DESORDEN: 'confirmado' que llega DESPUÉS de que el payout ya está en un
  // estado terminal negativo ('rechazado'/'fallido'). Los webhooks de Fintoc
  // pueden llegar fuera de orden; un 'succeeded' stale NUNCA debe "revivir" un
  // payout ya rechazado/devuelto ni reabrir su liquidación. CERO mutación —
  // solo alerta para visibilidad (no es una reversión financiera real, es un
  // evento tardío que ya no aplica).
  if (esConfirmacionTardiaInvalida(args.estadoExterno, estadoPayoutActual)) {
    await capturarMensaje(
      `Webhook/polling de payout: llegó 'confirmado' DESPUÉS de que el payout ${args.payoutId} ya está ` +
        `'${estadoPayoutActual}' — evento fuera de orden, se ignora (no revive el payout ni reabre la liquidación).`,
      'warning',
      {
        origen: `payout:${args.origen}`,
        tenantId: args.tenantId,
        correlacionId: args.jobRunId ?? undefined,
        etiquetas: {
          payout_id: args.payoutId,
          liquidacion_id: liquidacionId,
          estado_actual: estadoPayoutActual,
        },
      },
    );
    return sinResultado('confirmado');
  }

  // 'confirmado' | 'rechazado' | 'fallido': mutación guardada + idempotente.
  const estadoPayoutNuevo = estadoPayoutDestino(args.estadoExterno) as EstadoPayout;

  let transicionAplicada = false;

  if (estadoPayoutActual !== estadoPayoutNuevo) {
    const actualizacionPayout: Record<string, unknown> = {
      estado: estadoPayoutNuevo,
      actualizado_en: ahora,
    };
    if (estadoPayoutNuevo === 'confirmado') {
      actualizacionPayout.confirmado_en = ahora;
      actualizacionPayout.comprobante_ref = args.comprobanteRef ?? null;
    } else {
      actualizacionPayout.error_descripcion =
        args.motivo ?? `Estado '${estadoPayoutNuevo}' reportado por el proveedor.`;
    }

    const { data: actualizado, error: errUpdatePayout } = await supabase
      .schema('dinero')
      .from('payouts_conductor')
      .update(actualizacionPayout)
      .eq('id', args.payoutId)
      .eq('tenant_id', args.tenantId)
      .eq('estado', estadoPayoutActual) // guard anti-carrera: solo si sigue en el estado recién leído
      .select('id')
      .maybeSingle();

    if (errUpdatePayout) {
      throw new Error(`Error al actualizar payout a '${estadoPayoutNuevo}': ${errUpdatePayout.message}`);
    }
    transicionAplicada = actualizado !== null;
  }

  let liquidacionRevertida = false;

  if (args.estadoExterno === 'confirmado') {
    // Proyectar emitida→pagada. Casi siempre no-op: `jobEjecutarPayout` ya la
    // marcó 'pagada' de forma optimista al enviar el payout.
    const { error: errProyectar } = await supabase
      .schema('dinero')
      .from('liquidaciones')
      .update({ estado: 'pagada', actualizado_en: ahora })
      .eq('id', liquidacionId)
      .eq('tenant_id', args.tenantId)
      .eq('estado', 'emitida');

    if (errProyectar) {
      throw new Error(`Error al proyectar liquidación a 'pagada': ${errProyectar.message}`);
    }
  } else {
    // rechazado | fallido: leer el estado ACTUAL (fresco) de la liquidación
    // para decidir si corresponde revertir.
    const { data: liqFila, error: errLiq } = await supabase
      .schema('dinero')
      .from('liquidaciones')
      .select('id, estado')
      .eq('id', liquidacionId)
      .eq('tenant_id', args.tenantId)
      .maybeSingle();

    if (errLiq) {
      throw new Error(`Error al leer liquidación ${liquidacionId}: ${errLiq.message}`);
    }

    if (liqFila && debeRevertirLiquidacion(args.estadoExterno, liqFila.estado as EstadoLiquidacion)) {
      const { data: revertida, error: errRevertir } = await supabase
        .schema('dinero')
        .from('liquidaciones')
        .update({ estado: 'emitida', actualizado_en: ahora })
        .eq('id', liquidacionId)
        .eq('tenant_id', args.tenantId)
        .eq('estado', 'pagada') // guard anti-carrera / anti-doble-reversión
        .select('id')
        .maybeSingle();

      if (errRevertir) {
        throw new Error(`Error al revertir liquidación a 'emitida': ${errRevertir.message}`);
      }
      liquidacionRevertida = revertida !== null;

      if (liquidacionRevertida) {
        const yaExisteExcepcion = await existeEventoConciliacion(
          supabase,
          args.tenantId,
          'payout_revertido_post_confirmacion',
          { liquidacionId },
        );
        if (!yaExisteExcepcion) {
          await insertarEventoConciliacion(supabase, {
            tenant_id: args.tenantId,
            driver_id: driverId,
            liquidacion_id: liquidacionId,
            tipo_diferencia: 'payout_revertido_post_confirmacion',
            descripcion:
              `Payout ${args.payoutId} (liquidación ${liquidacionId}): el proveedor reportó ` +
              `'${args.estadoExterno}' DESPUÉS de que la liquidación ya se había marcado 'pagada'. ` +
              `Se revirtió la liquidación a 'emitida'. Motivo del proveedor: ${args.motivo ?? 'no informado'}.`,
            monto_diferencia_clp: null,
            estado: 'pendiente',
            job_run_id: args.jobRunId ?? 'sin-run-id',
          });
        }

        // Señal financiera real — SIEMPRE se alerta (aunque la excepción ya
        // existiera de una ejecución previa), porque cada reversión real es
        // un evento que el equipo debe ver.
        await capturarMensaje(
          `Reversión de payout post-confirmación: liquidación ${liquidacionId} vuelta a 'emitida' ` +
            `(estado externo del proveedor: ${args.estadoExterno}).`,
          'error',
          {
            origen: `payout:${args.origen}`,
            tenantId: args.tenantId,
            correlacionId: args.jobRunId ?? undefined,
            etiquetas: {
              payout_id: args.payoutId,
              liquidacion_id: liquidacionId,
              estado_externo: args.estadoExterno,
            },
          },
        );
      }
    }
  }

  // Bitácora — DESPUÉS de las escrituras (mismo patrón que
  // `consultar-estado-payout.ts`/`ejecutar-payout.ts`). Solo si hubo alguna
  // mutación real en esta ejecución (evita ruido en reintentos/no-ops).
  if (transicionAplicada || liquidacionRevertida) {
    await registrarEnBitacora(supabase, {
      tenantId: args.tenantId,
      actorUsuarioId: null,
      actorTipo: 'sistema',
      accion: accionBitacoraPorEstado(args.estadoExterno),
      entidadTipo: 'liquidacion',
      entidadId: liquidacionId,
      detalle: {
        payout_id: args.payoutId,
        driver_id: driverId,
        origen: args.origen,
        liquidacion_revertida: liquidacionRevertida,
      },
    });
  }

  return {
    resultado: args.estadoExterno,
    payoutId: args.payoutId,
    liquidacionId,
    driverId,
    transicionAplicada,
    liquidacionRevertida,
  };
}
