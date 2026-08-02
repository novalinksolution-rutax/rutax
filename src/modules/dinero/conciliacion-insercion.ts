/**
 * Helpers de inserción idempotente en `dinero.eventos_conciliacion`.
 * =============================================================================
 *
 * Extraído de `jobs/conciliar-tres-fuentes.ts` (C7) para que otros
 * consumidores de la bandeja de excepciones — en particular la transición
 * compartida de payout (`jobs/transicion-payout.ts`, webhook + polling) y la
 * conciliación inmediata post-confirmación (`jobs/conciliar-payout-confirmado.ts`)
 * — inserten hallazgos con la MISMA lógica de idempotencia y clasificación,
 * sin duplicar código ni depender de los internos de un job ajeno.
 *
 * Reglas invariantes (iguales a C7):
 * - `existeEventoConciliacion` decide si YA existe un hallazgo del mismo
 *   `(tipo_diferencia, pedido_id | periodo_cobro_id | liquidacion_id)` para el
 *   tenant — evita duplicar la misma excepción en reintentos/re-ejecuciones.
 * - `insertarEventoConciliacion` calcula los 3 campos de clasificación
 *   (`categoria_negocio`, `accion_sugerida`, `fecha_limite`) a partir de
 *   `tipo_diferencia`, para que ninguna fila quede con `categoria_negocio` NULL
 *   (columna NOT NULL sin default desde la migración 20260708000001).
 * - Detective puro: estas funciones solo LEEN/INSERTAN en `eventos_conciliacion`
 *   — nunca mutan líneas, liquidaciones ni períodos.
 */

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { camposClasificacionParaInsert } from './conciliacion-clasificacion';
import type { TipoDiferenciaConciliacion } from './tipos';

/**
 * Verifica si ya existe un evento de conciliación del mismo tipo y entidad
 * para este tenant. Devuelve true si ya existe (no insertar).
 */
export async function existeEventoConciliacion(
  supabase: ReturnType<typeof crearClienteServiceRole>,
  tenantId: string,
  tipoDiferencia: string,
  filtro: {
    pedidoId?: string;
    periodoCobroidId?: string;
    liquidacionId?: string;
  },
): Promise<boolean> {
  let query = supabase
    .schema('dinero')
    .from('eventos_conciliacion')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('tipo_diferencia', tipoDiferencia);

  if (filtro.pedidoId) {
    query = query.eq('pedido_id', filtro.pedidoId);
  }
  if (filtro.periodoCobroidId) {
    query = query.eq('periodo_cobro_id', filtro.periodoCobroidId);
  }
  if (filtro.liquidacionId) {
    query = query.eq('liquidacion_id', filtro.liquidacionId);
  }

  const { data } = await query.maybeSingle();
  return data !== null;
}

export interface EventoConciliacionPayload {
  tenant_id: string;
  seller_id?: string | null;
  periodo_cobro_id?: string | null;
  pedido_id?: string | null;
  driver_id?: string | null;
  liquidacion_id?: string | null;
  tipo_diferencia: TipoDiferenciaConciliacion;
  descripcion: string;
  monto_diferencia_clp?: number | null;
  estado: string;
  job_run_id: string;
}

/**
 * Único punto de inserción en `eventos_conciliacion` de los detectores C7
 * (D1-D6) y de los hallazgos del motor de payout (webhook/polling + la
 * conciliación inmediata post-confirmación). Calcula los 3 campos de
 * clasificación de la bandeja de excepciones (`categoria_negocio`,
 * `accion_sugerida`, `fecha_limite` — §1.1 P1) a partir de `tipo_diferencia`,
 * para que ninguna fila quede con `categoria_negocio` NULL.
 */
export async function insertarEventoConciliacion(
  supabase: ReturnType<typeof crearClienteServiceRole>,
  payload: EventoConciliacionPayload,
): Promise<void> {
  const ahoraIso = new Date().toISOString();
  const clasificacion = camposClasificacionParaInsert(payload.tipo_diferencia, ahoraIso);

  const { error } = await supabase
    .schema('dinero')
    .from('eventos_conciliacion')
    .insert({ ...payload, ...clasificacion });

  if (error) {
    throw new Error(
      `Error al insertar evento de conciliación [${payload.tipo_diferencia}]: ${error.message}`,
    );
  }
}
