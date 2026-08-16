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
    /**
     * Tres estados distintos, y hay que distinguirlos (etapa 8, retiro en
     * bodega, 20260815000004 — `lineas_liquidacion.pedido_id` pasó a NULLABLE):
     *   - `undefined` — el caller no usa el pedido como clave de idempotencia
     *     (p. ej. filtra solo por `liquidacionId`/`sesionRetiroId`): NO se
     *     agrega condición sobre `pedido_id`.
     *   - `string` — filtra por ESE pedido (`pedido_id = valor`).
     *   - `null` — filtra EXPLÍCITAMENTE por hallazgos SIN pedido
     *     (`pedido_id IS NULL`) — el caso de una excepción del lado
     *     'retiro_bodega', que no tiene pedido.
     * Antes de esto `pedidoId` solo aceptaba `string | undefined`, y el gate
     * era `if (filtro.pedidoId)` — falsy tanto para `null` como para
     * `undefined` por igual. Un caller que quisiera decir "sin pedido" no
     * tenía forma de expresarlo: la condición sobre `pedido_id` simplemente NO
     * se aplicaba, la consulta quedaba en `(tenant_id, tipo_diferencia)` y
     * `.maybeSingle()` corría el riesgo de toparse con MÁS de una fila (error
     * de PostgREST que esta función no comprueba — ver más abajo) o de
     * encontrar el evento de OTRO pedido y suprimir un hallazgo legítimo.
     */
    pedidoId?: string | null;
    periodoCobroidId?: string;
    liquidacionId?: string;
    /** Conductor — clave de idempotencia del lado 'retiro_bodega' (junto a `sesionRetiroId`). */
    driverId?: string;
    /** Visita a bodega — clave de idempotencia del lado 'retiro_bodega' (columna agregada por 20260815000005). */
    sesionRetiroId?: string;
  },
): Promise<boolean> {
  let query = supabase
    .schema('dinero')
    .from('eventos_conciliacion')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('tipo_diferencia', tipoDiferencia);

  if (filtro.pedidoId === null) {
    query = query.is('pedido_id', null);
  } else if (filtro.pedidoId) {
    query = query.eq('pedido_id', filtro.pedidoId);
  }
  if (filtro.periodoCobroidId) {
    query = query.eq('periodo_cobro_id', filtro.periodoCobroidId);
  }
  if (filtro.liquidacionId) {
    query = query.eq('liquidacion_id', filtro.liquidacionId);
  }
  if (filtro.driverId) {
    query = query.eq('driver_id', filtro.driverId);
  }
  if (filtro.sesionRetiroId) {
    query = query.eq('sesion_retiro_id', filtro.sesionRetiroId);
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
  /** Visita a bodega — NULL salvo en hallazgos del lado 'retiro_bodega' (columna agregada por 20260815000005). */
  sesion_retiro_id?: string | null;
  tipo_diferencia: TipoDiferenciaConciliacion;
  descripcion: string;
  monto_diferencia_clp?: number | null;
  estado: string;
  job_run_id: string;
  /**
   * Bloqueo de acciones financieras (§1.1 P1, migración 20260708000001).
   * Omitidos → toman el DEFAULT de la columna (`false`/`false`/NULL), igual
   * que el comportamiento histórico de esta función (C7 y el motor de payout
   * nunca bloquean). `generar-linea-retiro.ts` (C8) SÍ los necesita: sin
   * `bloquea_pago=true` la excepción 'retiro_sin_monto_configurado' quedaría
   * como un aviso decorativo en vez de retener el pago, exactamente el
   * mecanismo que el propio job existe para garantizar.
   */
  bloquea_facturacion?: boolean;
  bloquea_pago?: boolean;
  /** Obligatorio (CHECK eventos_conciliacion_bloqueo_motivo) cuando bloquea_facturacion o bloquea_pago es true. */
  motivo_bloqueo?: string | null;
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
