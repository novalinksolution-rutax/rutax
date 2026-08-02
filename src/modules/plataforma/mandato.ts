/**
 * Transiciones del MANDATO de auto-cobro disparadas por el WEBHOOK de Fintoc
 * (F1-E — `api/webhooks/fintoc-suscripcion-recurrente`).
 * =============================================================================
 * Lado SISTEMA (no courier): distinto de `superficie-courier.ts`
 * (`iniciarEnrolamientoMandato`/`cancelarMandatoAutoCobro`, `actorTipo:'usuario'`,
 * disparadas por la Server Action del courier) — aquí el ACTOR es el proveedor,
 * vía webhook, `actorTipo:'sistema'`.
 *
 * Correlación: por `suscripcionId` (de la `metadata` que `iniciarEnrolamientoMandato`
 * fijó al llamar `registrarMandato`). Sin `suscripcionId` (metadata no propagada
 * por Fintoc) no hay forma de correlacionar de forma segura — se devuelve
 * `'sin_suscripcion'` y el llamador (route handler) deja constancia en
 * observabilidad; no hay tabla de respaldo para buscar por `mandatoExternoId`
 * porque ese id es solo el puntero TEMPORAL de la sesión de enrolamiento (ver
 * `superficie-courier.ts`), no algo que persistamos antes de la confirmación.
 *
 * Bitácora ANTES del efecto (actor sistema) — RNF-04.
 */

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import { cifrarSecreto } from '@/modules/integraciones/secretos';

export type ResultadoTransicionMandato = 'activado' | 'fallido_registrado' | 'ya_aplicado' | 'sin_suscripcion';

/**
 * Activa el mandato: cifra el id DEFINITIVO del mandato (payment method /
 * subscription de Fintoc — el material reutilizable que `cobrarPeriodo`
 * necesita como `mandatoToken`) y lo guarda como `mandato_ref`. Idempotente:
 * si ya estaba `activo`, no re-cifra ni re-escribe (evita filas huérfanas en
 * `secretos_cifrados` ante un replay del webhook).
 */
export async function activarMandatoRecurrente(evento: {
  mandatoExternoId: string;
  suscripcionId: string | null;
}): Promise<ResultadoTransicionMandato> {
  if (!evento.suscripcionId) return 'sin_suscripcion';

  const supabase = crearClienteServiceRole();

  const { data: susc, error } = await supabase
    .schema('plataforma')
    .from('suscripciones')
    .select('id, tenant_id, mandato_estado')
    .eq('id', evento.suscripcionId)
    .maybeSingle();
  if (error) throw new Error(`Error al leer suscripción: ${error.message}`);
  if (!susc) return 'sin_suscripcion';

  if (susc.mandato_estado === 'activo') {
    return 'ya_aplicado';
  }

  const tenantId = susc.tenant_id as string;
  const suscripcionId = susc.id as string;

  // Bitácora ANTES de cualquier efecto (cifrado + update) — RNF-04. NUNCA
  // incluye `mandatoExternoId` en claro más allá de lo estrictamente necesario
  // para la trazabilidad — aquí no se incluye en absoluto (no es secreto pero
  // tampoco aporta al operador; el id cifrado queda en `mandato_ref`).
  await registrarEnBitacora(supabase, {
    tenantId,
    actorUsuarioId: null,
    actorTipo: 'sistema',
    accion: 'plataforma.mandato_activado',
    entidadTipo: 'suscripcion',
    entidadId: suscripcionId,
    detalle: { estado_anterior: susc.mandato_estado },
  });

  const { referenciaExternaId } = await cifrarSecreto({
    tenantId,
    tipoSecreto: 'mandato_suscripcion_fintoc',
    valor: evento.mandatoExternoId,
  });

  const { error: errUpdate } = await supabase
    .schema('plataforma')
    .from('suscripciones')
    .update({
      mandato_estado: 'activo',
      mandato_ref: referenciaExternaId,
      actualizado_en: new Date().toISOString(),
    })
    .eq('id', suscripcionId);
  if (errUpdate) throw new Error(`Error al activar el mandato: ${errUpdate.message}`);

  return 'activado';
}

/**
 * Marca el mandato como `fallido` (enrolamiento rechazado, o el banco/Fintoc
 * canceló una suscripción ya activa — `subscription.canceled`). El courier
 * queda sin auto-cobro utilizable hasta re-vincular
 * (`iniciarEnrolamientoMandato`); `auto_cobro_habilitado` NO se toca aquí — es
 * el intento explícito del courier, y el gate del job de auto-cobro ya exige
 * `mandato_estado='activo'`, así que basta con que deje de estarlo.
 */
export async function marcarMandatoFallido(evento: {
  suscripcionId: string | null;
}): Promise<ResultadoTransicionMandato> {
  if (!evento.suscripcionId) return 'sin_suscripcion';

  const supabase = crearClienteServiceRole();

  const { data: susc, error } = await supabase
    .schema('plataforma')
    .from('suscripciones')
    .select('id, tenant_id, mandato_estado')
    .eq('id', evento.suscripcionId)
    .maybeSingle();
  if (error) throw new Error(`Error al leer suscripción: ${error.message}`);
  if (!susc) return 'sin_suscripcion';

  if (susc.mandato_estado === 'fallido') {
    return 'ya_aplicado';
  }

  const tenantId = susc.tenant_id as string;
  const suscripcionId = susc.id as string;

  await registrarEnBitacora(supabase, {
    tenantId,
    actorUsuarioId: null,
    actorTipo: 'sistema',
    accion: 'plataforma.mandato_fallido',
    entidadTipo: 'suscripcion',
    entidadId: suscripcionId,
    detalle: { estado_anterior: susc.mandato_estado },
  });

  const { error: errUpdate } = await supabase
    .schema('plataforma')
    .from('suscripciones')
    .update({ mandato_estado: 'fallido', actualizado_en: new Date().toISOString() })
    .eq('id', suscripcionId);
  if (errUpdate) throw new Error(`Error al marcar el mandato fallido: ${errUpdate.message}`);

  return 'fallido_registrado';
}
