/**
 * Confirmación de pagos de suscripción disparada por WEBHOOKS de Fintoc.
 * =============================================================================
 * Lado SISTEMA (no super-admin): lo llaman los handlers de webhook tras validar
 * la firma. Marca el período `pagado` y el pago `confirmado`. Idempotente ante
 * entregas duplicadas del webhook.
 *
 * Dos flujos comparten el mismo núcleo de reconciliación (`confirmarPeriodoPagado`)
 * para no duplicar la regla de dinero (H-4):
 *  - `confirmarPagoSuscripcion`: cobro por LINK (`api/webhooks/fintoc-suscripcion`).
 *    Correlación por `periodo_id` (metadata) o por el id del payment link.
 *  - `confirmarCobroRecurrente`: AUTO-COBRO por mandato
 *    (`api/webhooks/fintoc-suscripcion-recurrente`, F1-E). Correlación por
 *    `periodo_id` (metadata) o por el id del cargo (`pago_externo_id`).
 *
 * Reconciliación de monto (H-4, defensa en profundidad): antes de marcar el
 * período `pagado`, se compara el monto informado por el evento contra
 * `periodo.monto_clp` (lo que se esperaba cobrar). Si difieren (pago parcial, o
 * un cobro mal configurado), el período NO se marca pagado a ciegas — queda
 * para revisión manual y el resultado `'monto_discrepante'` deja constancia en
 * bitácora. El webhook igual responde 200 (Fintoc no debe reintentar por un
 * no-match de monto, que no se resuelve reintentando).
 *
 * TRANSICIÓN trial→activa (F2 "Ola 3", ítem E): el PRIMER pago confirmado de un
 * período cobrable es la señal de que el courier terminó su trial y empezó a
 * pagar. Si la suscripción sigue `estado='trial'` en este punto, se pasa a
 * `activa` y se fija `activa_desde = hoy` (Santiago) — ANTES de la bitácora del
 * pago mismo, con su propia entrada de bitácora (RNF-04). Idempotente: el
 * UPDATE exige `estado='trial'`, así que un replay del webhook (la suscripción
 * ya `activa`) es no-op. Vive AQUÍ (no en cada webhook por separado) porque
 * `confirmarPeriodoPagado` es el núcleo COMPARTIDO por los dos flujos de cobro
 * (link y recurrente) — una sola vez, cubre ambos.
 *
 * Bitácora ANTES del efecto (actor sistema) — RNF-04.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { inngest } from '@/lib/inngest/cliente';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import { ahoraEnSantiago } from '@/lib/fecha-santiago';
import type { EventoPagoSuscripcion } from '@/modules/integraciones/pagos';
import type { EventoRecurrenteNormalizado } from '@/modules/integraciones/pagos/suscripcion-recurrente';

export type ResultadoConfirmacion =
  | 'confirmado'
  | 'ya_pagado'
  | 'fallido_registrado'
  | 'ignorado'
  | 'sin_periodo'
  | 'monto_discrepante';

/** Fila mínima de `periodos_suscripcion` que necesita el núcleo compartido. */
interface FilaPeriodoSuscripcion {
  id: string;
  tenant_id: string;
  suscripcion_id: string;
  monto_clp: unknown;
  estado: string;
}

/**
 * Núcleo compartido de confirmación: reconciliación de monto (H-4) +
 * actualizar/crear la fila de `pagos_plataforma` + marcar el período `pagado`
 * + publicar `plataforma/pago.confirmado`. Usado tanto por el webhook de LINK
 * como por el de AUTO-COBRO RECURRENTE — la regla de dinero vive en un solo
 * lugar (evita que los dos flujos diverjan en cómo reconcilian montos).
 *
 * Precondición: el llamador YA verificó que `periodo.estado !== 'pagado'`
 * (la idempotencia de "ya pagado" es específica de cada flujo de correlación,
 * así que queda fuera de este núcleo).
 */
async function confirmarPeriodoPagado(
  supabase: SupabaseClient,
  periodo: FilaPeriodoSuscripcion,
  args: {
    montoInformadoClp: number | null;
    metodo: 'fintoc_link' | 'fintoc_recurrente';
    /** `link_externo_id` o `cobro_externo_id` — lo que correlaciona en `pagos_plataforma`. */
    pagoExternoId: string | null;
    eventoExternoId: string;
  },
): Promise<{ resultado: ResultadoConfirmacion; periodoId: string }> {
  const periodoId = periodo.id;
  const tenantId = periodo.tenant_id;
  const suscripcionId = periodo.suscripcion_id;
  const montoEsperadoClp = Number(periodo.monto_clp);

  // Reconciliación de monto (H-4). Ausencia de dato (`null`) no es, por sí
  // sola, una discrepancia — algunos payloads de Fintoc no informan el monto.
  if (args.montoInformadoClp !== null && args.montoInformadoClp !== montoEsperadoClp) {
    await registrarEnBitacora(supabase, {
      tenantId,
      actorUsuarioId: null,
      actorTipo: 'sistema',
      accion: 'plataforma.pago_suscripcion_monto_discrepante',
      entidadTipo: 'periodo_suscripcion',
      entidadId: periodoId,
      detalle: {
        metodo: args.metodo,
        evento_externo_id: args.eventoExternoId,
        pago_externo_id: args.pagoExternoId,
        monto_esperado_clp: montoEsperadoClp,
        monto_informado_clp: args.montoInformadoClp,
      },
    });
    // El período queda `pendiente` (NO se marca pagado) para revisión manual.
    return { resultado: 'monto_discrepante', periodoId };
  }

  // Transición trial→activa (F2 "Ola 3", ítem E) — ver el JSDoc de cabecera.
  // Idempotente: solo actúa si la suscripción SIGUE en trial en este instante.
  const { data: suscActual } = await supabase
    .schema('plataforma')
    .from('suscripciones')
    .select('estado')
    .eq('id', suscripcionId)
    .maybeSingle();

  if (suscActual?.estado === 'trial') {
    const activaDesde = ahoraEnSantiago().fecha;

    // Bitácora ANTES del efecto — propia, distinta de la del pago (RNF-04).
    await registrarEnBitacora(supabase, {
      tenantId,
      actorUsuarioId: null,
      actorTipo: 'sistema',
      accion: 'plataforma.trial_activado_por_pago',
      entidadTipo: 'suscripcion',
      entidadId: suscripcionId,
      detalle: { periodo_id: periodoId, activa_desde: activaDesde },
    });

    await supabase
      .schema('plataforma')
      .from('suscripciones')
      .update({ estado: 'activa', activa_desde: activaDesde, actualizado_en: new Date().toISOString() })
      .eq('id', suscripcionId)
      .eq('estado', 'trial'); // guarda idempotente ante una carrera/replay
  }

  const ahora = new Date().toISOString();

  // Bitácora ANTES del efecto (actor sistema — el webhook, no un humano).
  await registrarEnBitacora(supabase, {
    tenantId,
    actorUsuarioId: null,
    actorTipo: 'sistema',
    accion: 'plataforma.pago_suscripcion_confirmado',
    entidadTipo: 'periodo_suscripcion',
    entidadId: periodoId,
    detalle: {
      metodo: args.metodo,
      evento_externo_id: args.eventoExternoId,
      pago_externo_id: args.pagoExternoId,
      monto_clp: args.montoInformadoClp,
    },
  });

  // Confirmar el pago: actualizar la fila pendiente ya correlacionada por
  // `pago_externo_id` (idempotente).
  if (args.pagoExternoId) {
    const { data: actualizadas } = await supabase
      .schema('plataforma')
      .from('pagos_plataforma')
      .update({ estado: 'confirmado', pagado_en: ahora })
      .eq('pago_externo_id', args.pagoExternoId)
      .eq('estado', 'pendiente')
      .select('id');

    // Sin fila pendiente que actualizar (p. ej. cobro creado fuera de flujo):
    // dejar constancia insertando el pago confirmado.
    if (!actualizadas || actualizadas.length === 0) {
      await supabase
        .schema('plataforma')
        .from('pagos_plataforma')
        .insert({
          periodo_id: periodoId,
          tenant_id: tenantId,
          monto_clp: montoEsperadoClp,
          metodo: args.metodo,
          estado: 'confirmado',
          pago_externo_id: args.pagoExternoId,
          pagado_en: ahora,
        });
    }
  }

  // Marcar el período pagado (idempotente: solo si no lo estaba ya).
  await supabase
    .schema('plataforma')
    .from('periodos_suscripcion')
    .update({ estado: 'pagado' })
    .eq('id', periodoId)
    .neq('estado', 'pagado');

  // Publicar el evento — DESPUÉS de la bitácora y del efecto en BD. `id`
  // determinístico por período (no por método): un período solo se paga una
  // vez, sin importar por qué vía — evita un doble disparo si, por una carrera
  // rarísima, el link y el auto-cobro confirmaran "a la vez".
  await inngest.send({
    name: 'plataforma/pago.confirmado',
    id: `pago-confirmado-suscripcion-${periodoId}`,
    data: {
      tenantId,
      suscripcionId,
      periodoId,
      montoClp: montoEsperadoClp,
      metodo: args.metodo,
      confirmadoEn: ahora,
    },
  });

  return { resultado: 'confirmado', periodoId };
}

async function leerPeriodo(
  supabase: SupabaseClient,
  periodoId: string,
): Promise<FilaPeriodoSuscripcion | null> {
  const { data, error } = await supabase
    .schema('plataforma')
    .from('periodos_suscripcion')
    .select('id, tenant_id, suscripcion_id, monto_clp, estado')
    .eq('id', periodoId)
    .maybeSingle();
  if (error) throw new Error(`Error al leer período: ${error.message}`);
  return (data as FilaPeriodoSuscripcion | null) ?? null;
}

// =============================================================================
// confirmarPagoSuscripcion — cobro por LINK (checkout de pago único)
// =============================================================================

/**
 * Resuelve el período afectado por el evento (por metadata o por el id del link)
 * y aplica la transición. Devuelve un resultado para que el webhook responda
 * 200 en todos los casos no-error (Fintoc no debe reintentar por un no-match).
 */
export async function confirmarPagoSuscripcion(
  evento: EventoPagoSuscripcion,
): Promise<{ resultado: ResultadoConfirmacion; periodoId: string | null }> {
  const supabase = crearClienteServiceRole();

  // 1. Resolver el período: metadata.periodo_id (primario) o el link (respaldo).
  let periodoId = evento.periodoId;
  if (!periodoId && evento.linkExternoId) {
    const { data } = await supabase
      .schema('plataforma')
      .from('pagos_plataforma')
      .select('periodo_id')
      .eq('pago_externo_id', evento.linkExternoId)
      .maybeSingle();
    periodoId = (data?.periodo_id as string | null) ?? null;
  }
  if (!periodoId) return { resultado: 'sin_periodo', periodoId: null };

  // 2. Leer el período (monto, tenant, suscripción, estado actual).
  const periodo = await leerPeriodo(supabase, periodoId);
  if (!periodo) return { resultado: 'sin_periodo', periodoId: null };

  // 3. Evento de pago FALLIDO/expirado: marca el pago fallido, no toca el período.
  if (evento.estado === 'fallido' || evento.estado === 'expirado') {
    if (evento.linkExternoId) {
      await supabase
        .schema('plataforma')
        .from('pagos_plataforma')
        .update({ estado: 'fallido' })
        .eq('pago_externo_id', evento.linkExternoId)
        .eq('estado', 'pendiente'); // idempotente
    }
    return { resultado: evento.estado === 'fallido' ? 'fallido_registrado' : 'ignorado', periodoId };
  }

  // 4. Pago exitoso. Idempotencia: si ya está pagado, no re-procesar.
  if (periodo.estado === 'pagado') {
    return { resultado: 'ya_pagado', periodoId };
  }

  return confirmarPeriodoPagado(supabase, periodo, {
    montoInformadoClp: evento.montoClp,
    metodo: 'fintoc_link',
    pagoExternoId: evento.linkExternoId,
    eventoExternoId: evento.eventoExternoId,
  });
}

// =============================================================================
// confirmarCobroRecurrente — AUTO-COBRO por mandato (F1-E)
// =============================================================================

/**
 * Aplica un evento `cobro_exitoso`/`cobro_fallido` del webhook de auto-cobro
 * recurrente. Correlación por `periodo_id` (metadata que fijó el job
 * `plataforma/cobrarPeriodoAuto` al llamar `cobrarPeriodo`) o, en su defecto,
 * por el id del cargo (`pago_externo_id`, que el job ya guardó al insertar el
 * pago `pendiente`).
 */
export async function confirmarCobroRecurrente(
  evento: Extract<EventoRecurrenteNormalizado, { tipo: 'cobro_exitoso' | 'cobro_fallido' }>,
): Promise<{ resultado: ResultadoConfirmacion; periodoId: string | null }> {
  const supabase = crearClienteServiceRole();

  // 1. Resolver el período: metadata.periodo_id (primario) o el cargo (respaldo).
  let periodoId = evento.periodoId;
  if (!periodoId) {
    const { data } = await supabase
      .schema('plataforma')
      .from('pagos_plataforma')
      .select('periodo_id')
      .eq('pago_externo_id', evento.cobroExternoId)
      .maybeSingle();
    periodoId = (data?.periodo_id as string | null) ?? null;
  }
  if (!periodoId) return { resultado: 'sin_periodo', periodoId: null };

  const periodo = await leerPeriodo(supabase, periodoId);
  if (!periodo) return { resultado: 'sin_periodo', periodoId: null };

  if (evento.tipo === 'cobro_fallido') {
    // Idempotente: solo transiciona una fila `pendiente` (un replay no repite el efecto).
    await supabase
      .schema('plataforma')
      .from('pagos_plataforma')
      .update({ estado: 'fallido' })
      .eq('pago_externo_id', evento.cobroExternoId)
      .eq('estado', 'pendiente');
    return { resultado: 'fallido_registrado', periodoId };
  }

  // cobro_exitoso. Idempotencia: si ya está pagado, no re-procesar.
  if (periodo.estado === 'pagado') {
    return { resultado: 'ya_pagado', periodoId };
  }

  return confirmarPeriodoPagado(supabase, periodo, {
    montoInformadoClp: evento.montoClp,
    metodo: 'fintoc_recurrente',
    pagoExternoId: evento.cobroExternoId,
    eventoExternoId: evento.cobroExternoId,
  });
}
