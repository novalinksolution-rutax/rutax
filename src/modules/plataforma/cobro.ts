/**
 * Confirmación de pagos de suscripción disparada por el WEBHOOK de Fintoc.
 * =============================================================================
 * Lado SISTEMA (no super-admin): lo llama el handler del webhook tras validar la
 * firma. Marca el período `pagado` y el pago `confirmado`. Idempotente ante
 * entregas duplicadas del webhook.
 *
 * Correlación (defensiva, ver `normalizar-evento.ts`): primero por
 * `periodo_id` (de la metadata que fijamos al crear el link); si no viene, por
 * el id del payment link (`pago_externo_id`).
 *
 * Bitácora ANTES del efecto (actor sistema) — RNF-04.
 */

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import type { EventoPagoSuscripcion } from '@/modules/integraciones/pagos';

export type ResultadoConfirmacion =
  | 'confirmado'
  | 'ya_pagado'
  | 'fallido_registrado'
  | 'ignorado'
  | 'sin_periodo';

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

  // 2. Leer el período (monto, tenant, estado actual).
  const { data: periodo, error: errPeriodo } = await supabase
    .schema('plataforma')
    .from('periodos_suscripcion')
    .select('id, tenant_id, monto_clp, estado')
    .eq('id', periodoId)
    .maybeSingle();
  if (errPeriodo) throw new Error(`Error al leer período: ${errPeriodo.message}`);
  if (!periodo) return { resultado: 'sin_periodo', periodoId: null };

  const tenantId = periodo.tenant_id as string;

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
      metodo: 'fintoc_link',
      evento_externo_id: evento.eventoExternoId,
      link_externo_id: evento.linkExternoId,
      monto_clp: evento.montoClp,
    },
  });

  // 5. Confirmar el pago: actualizar la fila pendiente del link (idempotente).
  if (evento.linkExternoId) {
    const { data: actualizadas } = await supabase
      .schema('plataforma')
      .from('pagos_plataforma')
      .update({ estado: 'confirmado', pagado_en: ahora })
      .eq('pago_externo_id', evento.linkExternoId)
      .eq('estado', 'pendiente')
      .select('id');

    // Sin fila pendiente que actualizar (p. ej. link creado fuera de flujo):
    // dejar constancia insertando el pago confirmado.
    if (!actualizadas || actualizadas.length === 0) {
      await supabase
        .schema('plataforma')
        .from('pagos_plataforma')
        .insert({
          periodo_id: periodoId,
          tenant_id: tenantId,
          monto_clp: Number(periodo.monto_clp),
          metodo: 'fintoc_link',
          estado: 'confirmado',
          pago_externo_id: evento.linkExternoId,
          pagado_en: ahora,
        });
    }
  }

  // 6. Marcar el período pagado (idempotente: solo si no lo estaba ya).
  await supabase
    .schema('plataforma')
    .from('periodos_suscripcion')
    .update({ estado: 'pagado' })
    .eq('id', periodoId)
    .neq('estado', 'pagado');

  return { resultado: 'confirmado', periodoId };
}
