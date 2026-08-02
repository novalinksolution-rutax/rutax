/**
 * Tests de `conciliacion-clasificacion.ts` — funciones puras de la bandeja de
 * excepciones de conciliación (§1.1 P1). Sin mocks: son funciones sin I/O.
 */

import { describe, it, expect } from 'vitest';
import {
  categoriaNegocioPorTipo,
  accionSugeridaPorTipo,
  fechaLimiteDefaultPorCategoria,
  camposClasificacionParaInsert,
  TRANSICIONES_VALIDAS,
  esTransicionValida,
  esEstadoTerminal,
  ESTADOS_NO_TERMINALES_CONCILIACION,
} from './conciliacion-clasificacion';
import type {
  TipoDiferenciaConciliacion,
  CategoriaNegocioConciliacion,
  AccionSugeridaConciliacion,
  EstadoEventoConciliacion,
} from './tipos';

// =============================================================================
// categoriaNegocioPorTipo — espejo 1:1 del backfill SQL de la migración
// =============================================================================

describe('categoriaNegocioPorTipo', () => {
  const casos: Array<[TipoDiferenciaConciliacion, CategoriaNegocioConciliacion]> = [
    ['folio_consumido_sin_dte_persistido', 'cumplimiento_dte'],
    ['monto_dte_difiere_de_lineas', 'cumplimiento_dte'],
    ['pagado_conductor_sin_cobro_seller', 'fuga_ingreso'],
    ['reprogramacion_no_cobrada', 'fuga_ingreso'],
    ['minimo_omitido', 'fuga_ingreso'],
    ['pago_seller_faltante', 'pagos_pendientes'],
    ['pago_conductor_faltante', 'pagos_pendientes'],
    ['pedido_entregado_sin_linea_cobro', 'integridad_datos'],
    ['pedido_entregado_sin_linea_liquidacion', 'integridad_datos'],
    ['linea_cobro_sin_pedido_entregado', 'integridad_datos'],
    ['periodo_cerrado_con_lineas_sueltas', 'integridad_datos'],
    ['cobrado_seller_no_pagado_conductor', 'integridad_datos'],
    ['payout_revertido_post_confirmacion', 'pagos_pendientes'],
    ['payout_estado_no_reconocido', 'integridad_datos'],
  ];

  it.each(casos)('%s → %s', (tipo, categoriaEsperada) => {
    expect(categoriaNegocioPorTipo(tipo)).toBe(categoriaEsperada);
  });

  it('cubre los 14 tipos de diferencia sin caer al default', () => {
    expect(casos).toHaveLength(14);
  });
});

// =============================================================================
// accionSugeridaPorTipo — espejo 1:1 del backfill SQL
// =============================================================================

describe('accionSugeridaPorTipo', () => {
  const casos: Array<[TipoDiferenciaConciliacion, AccionSugeridaConciliacion]> = [
    ['pedido_entregado_sin_linea_cobro', 'generar_cobro_manual'],
    ['pedido_entregado_sin_linea_liquidacion', 'generar_ajuste_liquidacion'],
    ['linea_cobro_sin_pedido_entregado', 'marcar_error_del_motor'],
    ['folio_consumido_sin_dte_persistido', 'reenviar_o_verificar_dte'],
    ['periodo_cerrado_con_lineas_sueltas', 'reasignar_lineas_a_periodo'],
    ['monto_dte_difiere_de_lineas', 'reenviar_o_verificar_dte'],
    ['pagado_conductor_sin_cobro_seller', 'generar_cobro_manual'],
    ['cobrado_seller_no_pagado_conductor', 'generar_ajuste_liquidacion'],
    ['reprogramacion_no_cobrada', 'generar_cobro_manual'],
    ['minimo_omitido', 'confirmar_con_seller'],
    ['pago_seller_faltante', 'gestionar_cobranza_seller'],
    ['pago_conductor_faltante', 'gestionar_pago_conductor'],
    ['payout_revertido_post_confirmacion', 'gestionar_pago_conductor'],
    ['payout_estado_no_reconocido', 'revisar_estado_externo'],
  ];

  it.each(casos)('%s → %s', (tipo, accionEsperada) => {
    expect(accionSugeridaPorTipo(tipo)).toBe(accionEsperada);
  });

  it('cubre los 14 tipos de diferencia sin caer al default', () => {
    expect(casos).toHaveLength(14);
  });
});

// =============================================================================
// fechaLimiteDefaultPorCategoria — SLA por categoría, zona America/Santiago
// =============================================================================

describe('fechaLimiteDefaultPorCategoria', () => {
  it('cumplimiento_dte → +2 días', () => {
    expect(fechaLimiteDefaultPorCategoria('cumplimiento_dte', '2026-06-15T15:00:00.000Z')).toBe('2026-06-17');
  });

  it('fuga_ingreso → +3 días', () => {
    expect(fechaLimiteDefaultPorCategoria('fuga_ingreso', '2026-06-15T15:00:00.000Z')).toBe('2026-06-18');
  });

  it('pagos_pendientes → +5 días', () => {
    expect(fechaLimiteDefaultPorCategoria('pagos_pendientes', '2026-06-15T15:00:00.000Z')).toBe('2026-06-20');
  });

  it('integridad_datos → +7 días', () => {
    expect(fechaLimiteDefaultPorCategoria('integridad_datos', '2026-06-15T15:00:00.000Z')).toBe('2026-06-22');
  });

  it('usa la fecha LOCAL de Santiago, no la fecha UTC (verano, UTC-3): 02:30 UTC del 15 → 14 en Santiago', () => {
    // Enero: horario de verano chileno (UTC-3). 2026-01-15T02:30:00Z = 2026-01-14T23:30 en Santiago.
    expect(fechaLimiteDefaultPorCategoria('integridad_datos', '2026-01-15T02:30:00.000Z')).toBe('2026-01-21');
  });

  it('usa la fecha LOCAL de Santiago, no la fecha UTC (invierno, UTC-4): 03:30 UTC del 1-jul → 30-jun en Santiago', () => {
    // Julio: horario de invierno chileno (UTC-4). 2026-07-01T03:30:00Z = 2026-06-30T23:30 en Santiago.
    expect(fechaLimiteDefaultPorCategoria('cumplimiento_dte', '2026-07-01T03:30:00.000Z')).toBe('2026-07-02');
  });

  it('cruza fin de mes correctamente', () => {
    expect(fechaLimiteDefaultPorCategoria('integridad_datos', '2026-06-28T12:00:00.000Z')).toBe('2026-07-05');
  });
});

// =============================================================================
// camposClasificacionParaInsert — combina las 3 funciones puras de arriba
// =============================================================================

describe('camposClasificacionParaInsert', () => {
  it('arma el payload completo para un tipo de fuga de ingreso', () => {
    const resultado = camposClasificacionParaInsert('pagado_conductor_sin_cobro_seller', '2026-06-15T15:00:00.000Z');
    expect(resultado).toEqual({
      categoria_negocio: 'fuga_ingreso',
      accion_sugerida: 'generar_cobro_manual',
      fecha_limite: '2026-06-18',
    });
  });

  it('arma el payload completo para un tipo de cumplimiento DTE', () => {
    const resultado = camposClasificacionParaInsert('folio_consumido_sin_dte_persistido', '2026-06-15T15:00:00.000Z');
    expect(resultado).toEqual({
      categoria_negocio: 'cumplimiento_dte',
      accion_sugerida: 'reenviar_o_verificar_dte',
      fecha_limite: '2026-06-17',
    });
  });

  it('arma el payload completo para un estado externo de payout no reconocido (integridad_datos, SLA 7 días)', () => {
    const resultado = camposClasificacionParaInsert('payout_estado_no_reconocido', '2026-06-15T15:00:00.000Z');
    expect(resultado).toEqual({
      categoria_negocio: 'integridad_datos',
      accion_sugerida: 'revisar_estado_externo',
      fecha_limite: '2026-06-22',
    });
  });
});

// =============================================================================
// Máquina de estados: TRANSICIONES_VALIDAS / esTransicionValida / esEstadoTerminal
// =============================================================================

describe('esTransicionValida', () => {
  it.each([
    ['pendiente', 'en_analisis'],
    ['pendiente', 'aceptada_justificada'],
    ['pendiente', 'ignorada'],
    ['en_analisis', 'esperando_info'],
    ['en_analisis', 'requiere_ajuste'],
    ['en_analisis', 'resuelta_manual'],
    ['en_analisis', 'aceptada_justificada'],
    ['en_analisis', 'ignorada'],
    ['esperando_info', 'en_analisis'],
    ['esperando_info', 'resuelta_manual'],
    ['esperando_info', 'aceptada_justificada'],
    ['esperando_info', 'ignorada'],
    ['requiere_ajuste', 'resuelta_manual'],
    ['requiere_ajuste', 'en_analisis'],
    ['requiere_ajuste', 'ignorada'],
    ['resuelta_auto', 'en_analisis'],
    ['resuelta_auto', 'pendiente'],
    ['resuelta_manual', 'en_analisis'],
    ['resuelta_manual', 'pendiente'],
    ['aceptada_justificada', 'en_analisis'],
    ['aceptada_justificada', 'pendiente'],
    ['ignorada', 'en_analisis'],
    ['ignorada', 'pendiente'],
  ] as Array<[EstadoEventoConciliacion, EstadoEventoConciliacion]>)('%s → %s es válida', (desde, hacia) => {
    expect(esTransicionValida(desde, hacia)).toBe(true);
  });

  it.each([
    ['pendiente', 'resuelta_manual'],
    ['pendiente', 'requiere_ajuste'],
    ['pendiente', 'esperando_info'],
    ['pendiente', 'resuelta_auto'],
    ['en_analisis', 'resuelta_auto'],
    ['esperando_info', 'requiere_ajuste'],
    ['esperando_info', 'pendiente'],
    ['requiere_ajuste', 'esperando_info'],
    ['requiere_ajuste', 'pendiente'],
    ['requiere_ajuste', 'aceptada_justificada'],
    ['resuelta_manual', 'resuelta_auto'],
    ['resuelta_manual', 'ignorada'],
    ['ignorada', 'resuelta_manual'],
    ['ignorada', 'aceptada_justificada'],
  ] as Array<[EstadoEventoConciliacion, EstadoEventoConciliacion]>)('%s → %s NO es válida', (desde, hacia) => {
    expect(esTransicionValida(desde, hacia)).toBe(false);
  });

  it('todo estado tiene al menos una transición saliente en la matriz', () => {
    const estados = Object.keys(TRANSICIONES_VALIDAS) as EstadoEventoConciliacion[];
    expect(estados).toHaveLength(8);
    for (const estado of estados) {
      expect(TRANSICIONES_VALIDAS[estado].length).toBeGreaterThan(0);
    }
  });
});

describe('esEstadoTerminal', () => {
  it.each(['resuelta_auto', 'resuelta_manual', 'aceptada_justificada', 'ignorada'] as EstadoEventoConciliacion[])(
    '%s es terminal',
    (estado) => {
      expect(esEstadoTerminal(estado)).toBe(true);
    },
  );

  it.each(['pendiente', 'en_analisis', 'esperando_info', 'requiere_ajuste'] as EstadoEventoConciliacion[])(
    '%s NO es terminal',
    (estado) => {
      expect(esEstadoTerminal(estado)).toBe(false);
    },
  );
});

describe('ESTADOS_NO_TERMINALES_CONCILIACION', () => {
  it('contiene exactamente los 4 estados no-terminales', () => {
    expect([...ESTADOS_NO_TERMINALES_CONCILIACION].sort()).toEqual(
      ['en_analisis', 'esperando_info', 'pendiente', 'requiere_ajuste'].sort(),
    );
  });
});
