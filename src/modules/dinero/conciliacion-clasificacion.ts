/**
 * Clasificación y máquina de estados de la bandeja de excepciones de
 * conciliación (§1.1 P1, jul 2026).
 *
 * Funciones PURAS — sin I/O, sin `import` de `lib/ui` ni de clientes Supabase.
 * Los mapeos de este archivo deben coincidir 1:1 con el backfill SQL de la
 * migración `20260708000001_dinero_bandeja_excepciones_conciliacion.sql`
 * (mismo dato, dos lenguajes) — si cambian aquí, cambian también allá.
 */

import type {
  AccionSugeridaConciliacion,
  CategoriaNegocioConciliacion,
  EstadoEventoConciliacion,
  TipoDiferenciaConciliacion,
} from './tipos';

const TZ = 'America/Santiago';

// =============================================================================
// categoriaNegocioPorTipo / accionSugeridaPorTipo
// =============================================================================

const CATEGORIA_POR_TIPO: Record<TipoDiferenciaConciliacion, CategoriaNegocioConciliacion> = {
  folio_consumido_sin_dte_persistido: 'cumplimiento_dte',
  monto_dte_difiere_de_lineas: 'cumplimiento_dte',

  pagado_conductor_sin_cobro_seller: 'fuga_ingreso',
  reprogramacion_no_cobrada: 'fuga_ingreso',
  minimo_omitido: 'fuga_ingreso',

  pago_seller_faltante: 'pagos_pendientes',
  pago_conductor_faltante: 'pagos_pendientes',
  // Un payout revertido tras confirmarse vuelve la liquidación a 'emitida' —
  // es, de nuevo, un pago a conductor pendiente. Misma categoría/acción que
  // `pago_conductor_faltante`.
  payout_revertido_post_confirmacion: 'pagos_pendientes',

  // Todo lo demás → integridad_datos (espejo del `else` del backfill SQL).
  pedido_entregado_sin_linea_cobro: 'integridad_datos',
  pedido_entregado_sin_linea_liquidacion: 'integridad_datos',
  linea_cobro_sin_pedido_entregado: 'integridad_datos',
  periodo_cerrado_con_lineas_sueltas: 'integridad_datos',
  cobrado_seller_no_pagado_conductor: 'integridad_datos',
  // Estado externo de payout no reconocido (migración 20260709000001): NO es
  // un pago pendiente (eso sería engañoso) — es un problema de integridad de
  // datos que requiere revisión humana del status externo.
  payout_estado_no_reconocido: 'integridad_datos',
};

/** Mapeo fijo `tipoDiferencia → categoriaNegocio` — espejo del backfill SQL §4.1. */
export function categoriaNegocioPorTipo(tipo: TipoDiferenciaConciliacion): CategoriaNegocioConciliacion {
  return CATEGORIA_POR_TIPO[tipo] ?? 'integridad_datos';
}

const ACCION_POR_TIPO: Record<TipoDiferenciaConciliacion, AccionSugeridaConciliacion> = {
  pedido_entregado_sin_linea_cobro: 'generar_cobro_manual',
  pedido_entregado_sin_linea_liquidacion: 'generar_ajuste_liquidacion',
  linea_cobro_sin_pedido_entregado: 'marcar_error_del_motor',
  folio_consumido_sin_dte_persistido: 'reenviar_o_verificar_dte',
  periodo_cerrado_con_lineas_sueltas: 'reasignar_lineas_a_periodo',
  monto_dte_difiere_de_lineas: 'reenviar_o_verificar_dte',
  pagado_conductor_sin_cobro_seller: 'generar_cobro_manual',
  cobrado_seller_no_pagado_conductor: 'generar_ajuste_liquidacion',
  reprogramacion_no_cobrada: 'generar_cobro_manual',
  minimo_omitido: 'confirmar_con_seller',
  pago_seller_faltante: 'gestionar_cobranza_seller',
  pago_conductor_faltante: 'gestionar_pago_conductor',
  payout_revertido_post_confirmacion: 'gestionar_pago_conductor',
  payout_estado_no_reconocido: 'revisar_estado_externo',
};

/** Mapeo fijo `tipoDiferencia → accionSugerida` — espejo del backfill SQL §4.1. */
export function accionSugeridaPorTipo(tipo: TipoDiferenciaConciliacion): AccionSugeridaConciliacion {
  return ACCION_POR_TIPO[tipo] ?? 'sin_accion_requerida';
}

// =============================================================================
// fechaLimiteDefaultPorCategoria
// =============================================================================

/** Días de SLA por categoría de negocio — espejo del backfill SQL §4.2. */
const DIAS_SLA_POR_CATEGORIA: Record<CategoriaNegocioConciliacion, number> = {
  cumplimiento_dte: 2,
  fuga_ingreso: 3,
  pagos_pendientes: 5,
  integridad_datos: 7,
};

/** Descompone un ISO timestamptz en su fecha 'YYYY-MM-DD' local de America/Santiago. */
function fechaSantiagoDeIso(fechaCreacionIso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(fechaCreacionIso));
}

/** Suma `dias` días de calendario a una fecha 'YYYY-MM-DD' (aritmética en UTC sobre un date-only, sin problemas de DST). */
function sumarDias(fechaIso: string, dias: number): string {
  const fecha = new Date(`${fechaIso}T00:00:00Z`);
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

/**
 * Fecha límite (SLA) por defecto de una excepción recién detectada: fecha de
 * creación (zona America/Santiago) + N días según la categoría de negocio.
 * Espejo del backfill SQL §4.2. Devuelve 'YYYY-MM-DD'.
 */
export function fechaLimiteDefaultPorCategoria(
  categoria: CategoriaNegocioConciliacion,
  fechaCreacionIso: string,
): string {
  const fechaBase = fechaSantiagoDeIso(fechaCreacionIso);
  return sumarDias(fechaBase, DIAS_SLA_POR_CATEGORIA[categoria]);
}

/**
 * Calcula los 3 campos de clasificación de una excepción nueva a partir de su
 * `tipoDiferencia` y fecha de creación — conveniencia para los jobs que
 * insertan en `dinero.eventos_conciliacion` (evita triplicar la llamada a las
 * 3 funciones puras de arriba en cada sitio de inserción).
 */
export function camposClasificacionParaInsert(
  tipo: TipoDiferenciaConciliacion,
  fechaCreacionIso: string,
): {
  categoria_negocio: CategoriaNegocioConciliacion;
  accion_sugerida: AccionSugeridaConciliacion;
  fecha_limite: string;
} {
  const categoria_negocio = categoriaNegocioPorTipo(tipo);
  const accion_sugerida = accionSugeridaPorTipo(tipo);
  const fecha_limite = fechaLimiteDefaultPorCategoria(categoria_negocio, fechaCreacionIso);
  return { categoria_negocio, accion_sugerida, fecha_limite };
}

// =============================================================================
// Máquina de estados
// =============================================================================

/**
 * Matriz de transiciones válidas de la bandeja de excepciones (fija —
 * definida por `arquitecto`). `resuelta_auto` NO es alcanzable por transición
 * humana (se excluye de las funciones de escritura de `acciones.ts`) — queda
 * declarada aquí para un mecanismo futuro de re-chequeo automático.
 *
 * // TODO(resuelta_auto): re-chequeo automático del job — Más adelante.
 */
export const TRANSICIONES_VALIDAS: Record<EstadoEventoConciliacion, EstadoEventoConciliacion[]> = {
  pendiente: ['en_analisis', 'aceptada_justificada', 'ignorada'],
  en_analisis: ['esperando_info', 'requiere_ajuste', 'resuelta_manual', 'aceptada_justificada', 'ignorada'],
  esperando_info: ['en_analisis', 'resuelta_manual', 'aceptada_justificada', 'ignorada'],
  requiere_ajuste: ['resuelta_manual', 'en_analisis', 'ignorada'],
  resuelta_auto: ['en_analisis', 'pendiente'],
  resuelta_manual: ['en_analisis', 'pendiente'],
  aceptada_justificada: ['en_analisis', 'pendiente'],
  ignorada: ['en_analisis', 'pendiente'],
};

/** Verdadero si `desde → hacia` es una transición admitida por la máquina de estados. */
export function esTransicionValida(
  desde: EstadoEventoConciliacion,
  hacia: EstadoEventoConciliacion,
): boolean {
  return TRANSICIONES_VALIDAS[desde]?.includes(hacia) ?? false;
}

const ESTADOS_TERMINALES: ReadonlySet<EstadoEventoConciliacion> = new Set([
  'resuelta_auto',
  'resuelta_manual',
  'aceptada_justificada',
  'ignorada',
]);

/** Verdadero si el estado es uno de los 4 terminales del ciclo de vida. */
export function esEstadoTerminal(estado: EstadoEventoConciliacion): boolean {
  return ESTADOS_TERMINALES.has(estado);
}

/**
 * Los 4 estados NO-terminales — única fuente de verdad derivada de
 * `TRANSICIONES_VALIDAS`/`esEstadoTerminal` (evita hardcodear la lista en
 * cada consumidor: el hook de preflight, los avisos de SLA, etc.).
 */
export const ESTADOS_NO_TERMINALES_CONCILIACION: EstadoEventoConciliacion[] = (
  Object.keys(TRANSICIONES_VALIDAS) as EstadoEventoConciliacion[]
).filter((estado) => !esEstadoTerminal(estado));
