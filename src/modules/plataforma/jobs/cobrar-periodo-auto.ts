/**
 * Job · plataforma/cobrarPeriodoAuto (F1-E — auto-cobro por mandato Fintoc)
 * =====================================================================
 * Trigger: evento `plataforma/suscripcion.periodo-generado` (publicado por
 * `plataforma/generarPeriodos` — SOLO para períodos cobrables de suscripciones
 * `activa`, nunca para trials).
 *
 * GATE — solo intenta auto-cobro si AMBAS condiciones son ciertas:
 *   `plataforma.suscripciones.auto_cobro_habilitado = true` (opt-in del
 *   courier) Y `mandato_estado = 'activo'` (mandato confirmado por el webhook
 *   `mandato_activado`). Si falta cualquiera → NO-OP: el período queda
 *   `pendiente` y cae al cobro manual existente (link Fintoc, super-admin,
 *   `generarLinkCobroPeriodo`). Este job NUNCA es la única vía de cobro.
 *
 * Responsabilidad:
 * - Leer la suscripción del período (gate + `mandato_ref`).
 * - Si procede: descifrar el token del mandato EN EL PUNTO DE USO
 *   (`descifrarSecreto`) — nunca se loguea, nunca se persiste en claro.
 * - Bitácora ANTES del efecto externo (llamada al proveedor) — RNF-04, actor sistema.
 * - Instruir el cobro (`PuertoSuscripcionRecurrente.cobrarPeriodo`), idempotente
 *   vía `idempotencyKey = susc-cobro-${periodoId}` (determinística — un
 *   reintento de este job NUNCA genera un segundo cargo).
 * - `estado:'enviado'` → inserta `pagos_plataforma` `pendiente` con
 *   `metodo:'fintoc_recurrente'` y `pago_externo_id = cobroExternoId`, para que
 *   el webhook (`fintoc-suscripcion-recurrente`) correlacione la confirmación.
 *   La confirmación real (período → `pagado`) SIEMPRE llega por webhook — este
 *   job NUNCA marca el período pagado directamente.
 * - `estado:'rechazado'|'fallido'` → marca el intento `fallido` y publica
 *   `plataforma/cobro.fallido` (`reintentable`: rechazado=false — causa de
 *   negocio, requiere re-vinculación; fallido=true — transitorio, un futuro
 *   job de reintento podría intentar de nuevo). El cron de morosidad existente
 *   (`plataforma/marcarMorosidad`) marca `vencido` si nunca se paga; la
 *   suspensión sigue siendo manual.
 *
 * Idempotencia:
 * - El evento disparador ya tiene `id` determinístico por período
 *   (`suscripcion-periodo-generado-${periodoId}`) — Inngest deduplica la
 *   ejecución completa de este job para el mismo período.
 * - Si el período YA está `pagado` (p. ej. el super-admin lo cobró manual
 *   antes de que este job corriera), se omite sin error.
 * - `idempotencyKey` determinística además protege contra doble cargo si el
 *   proveedor reintenta internamente o si este job se reintenta.
 *
 * Secretos: el `mandatoToken` descifrado NUNCA se loguea ni se incluye en
 * bitácora/eventos — solo viaja al punto de uso (`puerto.cobrarPeriodo`).
 */

import { NonRetriableError } from 'inngest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { inngest } from '@/lib/inngest/cliente';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import { descifrarSecreto, comoReferenciaSecreto } from '@/modules/integraciones/secretos';
import {
  obtenerPuertoSuscripcionRecurrente,
  ErrorSuscripcionConfig,
  type ResultadoCobrarPeriodo,
} from '@/modules/integraciones/pagos/suscripcion-recurrente';

/** Descifra el `mandatoToken` en el punto de uso. Nunca se loguea. */
async function descifrarMandatoToken(mandatoRef: string): Promise<string> {
  const descifrado = await descifrarSecreto(comoReferenciaSecreto(mandatoRef));
  if (typeof descifrado.valor !== 'string') {
    throw new Error('el mandato descifrado no es texto');
  }
  return descifrado.valor;
}

// =============================================================================
// Lógica pura (sin I/O) — exportada para probarla directamente sin runtime de
// Inngest ni BD (mismo patrón que `calculo-payout.ts` / `matching-pago.ts`).
// =============================================================================

export type AccionAutoCobro =
  | 'ya_pagado'
  | 'omitido_sin_mandato'
  | 'omitido_sin_referencia'
  | 'cobrar';

/**
 * Decide qué hacer con el período: refleja el Step 1 del job (idempotencia +
 * gate). `mandatoRef` solo importa cuando el gate está abierto.
 */
export function decidirAccionAutoCobro(args: {
  periodoEstado: string;
  autoCobroHabilitado: boolean;
  mandatoEstado: string;
  mandatoRef: string | null;
}): AccionAutoCobro {
  if (args.periodoEstado === 'pagado') return 'ya_pagado';

  const gateAbierto = args.autoCobroHabilitado && args.mandatoEstado === 'activo';
  if (!gateAbierto) return 'omitido_sin_mandato';

  if (!args.mandatoRef) return 'omitido_sin_referencia';

  return 'cobrar';
}

export interface ClasificacionResultadoCobro {
  /** Estado con el que se persiste la fila de `pagos_plataforma` de este intento. */
  estadoPago: 'pendiente' | 'fallido';
  /** `true` → publicar `plataforma/cobro.fallido`. */
  publicarCobroFallido: boolean;
  /** Va en `data.reintentable` del evento — solo aplica cuando se publica. */
  reintentable: boolean;
}

/**
 * Clasifica el resultado de `puerto.cobrarPeriodo` — refleja el Step 3 del job.
 * `enviado` nunca marca el período pagado (eso lo hace SIEMPRE el webhook);
 * `rechazado`/`fallido` difieren solo en `reintentable` (negocio vs. transitorio).
 */
export function clasificarResultadoCobro(resultado: ResultadoCobrarPeriodo): ClasificacionResultadoCobro {
  if (resultado.estado === 'enviado') {
    return { estadoPago: 'pendiente', publicarCobroFallido: false, reintentable: false };
  }
  return {
    estadoPago: 'fallido',
    publicarCobroFallido: true,
    reintentable: resultado.estado === 'fallido',
  };
}

// =============================================================================
// ejecutarYPersistirAutoCobro — NÚCLEO COMPARTIDO (compón, no dupliques)
// =============================================================================
//
// Bitácora + descifrar mandato + instruir el cobro + persistir el resultado
// (nunca marca el período pagado — eso lo hace SIEMPRE el webhook de
// confirmación, ver `plataforma/cobro.ts`). Usado tanto por `jobCobrarPeriodoAuto`
// (evento `plataforma/suscripcion.periodo-generado`, el intento INICIAL) como
// por el cron de reintento de dunning `plataforma/reintentarCobroVencido`
// (`jobs/reintentar-cobro-vencido.ts`, F2 "Ola 3" ítem F) — la regla de dinero
// (idempotencyKey determinística, bitácora antes del efecto) vive en un solo
// lugar. Cada llamador la envuelve en su PROPIO `step.run` (nombres de step
// distintos por job — la memoización de Inngest es por-función, no cruza
// llamadores) y decide cómo manejar el `NonRetriableError` que puede lanzar.
//
// Precondición: el llamador YA verificó el gate (`decidirAccionAutoCobro` o
// una lectura equivalente) y que hay `mandatoRef`.
export async function ejecutarYPersistirAutoCobro(
  supabase: SupabaseClient,
  args: {
    tenantId: string;
    suscripcionId: string;
    periodoId: string;
    montoClp: number;
    periodoInicio: string;
    periodoFin: string;
    mandatoRef: string;
  },
): Promise<{ resultado: ResultadoCobrarPeriodo['estado'] }> {
  const { tenantId, suscripcionId, periodoId, montoClp, periodoInicio, periodoFin, mandatoRef } = args;

  // Bitácora ANTES del efecto externo (llamada al proveedor) — RNF-04.
  await registrarEnBitacora(supabase, {
    tenantId,
    actorUsuarioId: null,
    actorTipo: 'sistema',
    accion: 'plataforma.cobro_auto_intentado',
    entidadTipo: 'periodo_suscripcion',
    entidadId: periodoId,
    detalle: { monto_clp: montoClp, suscripcion_id: suscripcionId },
  });

  let mandatoToken: string;
  try {
    mandatoToken = await descifrarMandatoToken(mandatoRef);
  } catch {
    // No reintentable: un secreto que no descifra no se arregla reintentando
    // — requiere que el courier re-vincule el mandato.
    throw new NonRetriableError(
      `No se pudo descifrar el mandato de auto-cobro de la suscripción ${suscripcionId}.`,
    );
  }

  const puerto = obtenerPuertoSuscripcionRecurrente({ autoCobroHabilitado: true });

  let resultadoCobro: ResultadoCobrarPeriodo;
  try {
    resultadoCobro = await puerto.cobrarPeriodo({
      idempotencyKey: `susc-cobro-${periodoId}`,
      mandatoToken,
      montoClp,
      referencia: `Suscripción Rutax · período ${periodoInicio} a ${periodoFin}`,
      metadata: { periodo_id: periodoId, tenant_id: tenantId },
    });
  } catch (err) {
    // Config (mandato ausente/inválido en el proveedor) → no reintentable.
    if (err instanceof ErrorSuscripcionConfig) {
      throw new NonRetriableError(err.message);
    }
    throw err;
  }

  const clasificacion = clasificarResultadoCobro(resultadoCobro);
  const motivoSaneado = resultadoCobro.errorDescripcion ?? null;

  const { error: errInsert } = await supabase
    .schema('plataforma')
    .from('pagos_plataforma')
    .insert({
      periodo_id: periodoId,
      tenant_id: tenantId,
      monto_clp: montoClp,
      metodo: 'fintoc_recurrente',
      estado: clasificacion.estadoPago,
      pago_externo_id: resultadoCobro.cobroExternoId ?? null,
      notas: clasificacion.estadoPago === 'fallido' ? motivoSaneado : null,
    });
  if (errInsert) throw new Error(`Error al registrar el pago: ${errInsert.message}`);

  if (clasificacion.publicarCobroFallido) {
    // `id` determinístico POR PERÍODO (no por intento): un período solo genera
    // UNA notificación de "cobro fallido" al courier, aunque el dunning
    // reintente varias veces — evita spamear con un correo por cada reintento
    // (ver `jobs/notificar-cobro-fallido.ts`).
    await inngest.send({
      name: 'plataforma/cobro.fallido',
      id: `cobro-fallido-suscripcion-${periodoId}`,
      data: {
        tenantId,
        suscripcionId,
        periodoId,
        montoClp,
        motivoSaneado,
        reintentable: clasificacion.reintentable,
      },
    });
  }

  return { resultado: resultadoCobro.estado };
}

export const jobCobrarPeriodoAuto = inngest.createFunction(
  {
    id: 'plataforma/cobrarPeriodoAuto',
    name: 'Plataforma · Auto-cobro de período de suscripción (mandato Fintoc)',
    triggers: [{ event: 'plataforma/suscripcion.periodo-generado' }],
    retries: 3,
  },
  async ({ event, step, logger }) => {
    const { tenantId, suscripcionId, periodoId, montoClp, periodoInicio, periodoFin } = event.data as {
      tenantId: string;
      suscripcionId: string;
      periodoId: string;
      montoClp: number;
      periodoInicio: string;
      periodoFin: string;
      periodicidad: 'mensual' | 'anual';
    };

    // -------------------------------------------------------------------------
    // Step 1 — Leer contexto: período (idempotencia) + gate de la suscripción.
    // -------------------------------------------------------------------------
    const contexto = await step.run('leer-contexto', async () => {
      const supabase = crearClienteServiceRole();

      const { data: periodo, error: errPeriodo } = await supabase
        .schema('plataforma')
        .from('periodos_suscripcion')
        .select('id, estado')
        .eq('id', periodoId)
        .maybeSingle();
      if (errPeriodo) throw new Error(`Error al leer período: ${errPeriodo.message}`);
      if (!periodo) throw new NonRetriableError(`Período ${periodoId} no encontrado.`);

      if (periodo.estado === 'pagado') {
        return { accion: 'ya_pagado' as const, mandatoRef: null as string | null };
      }

      const { data: susc, error: errSusc } = await supabase
        .schema('plataforma')
        .from('suscripciones')
        .select('id, auto_cobro_habilitado, mandato_estado, mandato_ref')
        .eq('id', suscripcionId)
        .maybeSingle();
      if (errSusc) throw new Error(`Error al leer suscripción: ${errSusc.message}`);
      if (!susc) throw new NonRetriableError(`Suscripción ${suscripcionId} no encontrada.`);

      const accion = decidirAccionAutoCobro({
        periodoEstado: periodo.estado as string,
        autoCobroHabilitado: Boolean(susc.auto_cobro_habilitado),
        mandatoEstado: susc.mandato_estado as string,
        mandatoRef: (susc.mandato_ref as string | null) ?? null,
      });

      return { accion, mandatoRef: (susc.mandato_ref as string | null) ?? null };
    });

    if (contexto.accion !== 'cobrar') {
      logger.info(`Auto-cobro del período ${periodoId}: ${contexto.accion} — se omite (queda para cobro manual).`);
      return { resultado: contexto.accion, periodoId };
    }
    const mandatoRef = contexto.mandatoRef as string;

    // -------------------------------------------------------------------------
    // Step 2 — cobrar y persistir (núcleo compartido, ver `ejecutarYPersistirAutoCobro`).
    // -------------------------------------------------------------------------
    const persistido = await step.run('cobrar-y-persistir', () =>
      ejecutarYPersistirAutoCobro(crearClienteServiceRole(), {
        tenantId,
        suscripcionId,
        periodoId,
        montoClp,
        periodoInicio,
        periodoFin,
        mandatoRef,
      }),
    );

    logger.info(`Auto-cobro del período ${periodoId}: resultado '${persistido.resultado}'.`);

    return { resultado: persistido.resultado, periodoId };
  },
);
