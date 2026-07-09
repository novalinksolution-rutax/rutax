/**
 * Tests de la función pura `evaluarElegibilidad` del motor entrega→dinero.
 *
 * Los 8 casos exactos de la tabla §4.3 del documento de arquitectura.
 * Sin mocks — evaluarElegibilidad es una función pura sin side effects.
 *
 * Regla de definición de hecho: estos 8 casos deben pasar para que el motor
 * se considere implementado correctamente (CLAUDE.md — definición de hecho).
 */

import { describe, it, expect } from 'vitest';
import { evaluarElegibilidad, evaluarMotivoElegibilidad, construirSnapshotRegla } from './motor';
import type {
  EntradaMotor,
  MotivoElegibilidad,
  MotivoElegibilidadCodigo,
  TarifaSnapshotInput,
  IncidenciaSnapshotInput,
} from './motor';

describe('evaluarElegibilidad — tabla §4.3', () => {
  // =========================================================================
  // Caso 1: entregado sin conductor → genera cobro, no genera liquidación
  // =========================================================================
  it('entregado sin conductor → generaCobro=true, generaLiquidacion=false', () => {
    const entrada: EntradaMotor = {
      estadoPedido: 'entregado',
      afectaCobro: null,
      afectaLiquidacion: null,
      esGastoPropio: false,
      tieneDriverAsignado: false,
    };

    const resultado = evaluarElegibilidad(entrada);

    expect(resultado.generaCobro).toBe(true);
    expect(resultado.generaLiquidacion).toBe(false);
    expect(resultado.ajusteCobroCLP).toBe(0);
    expect(resultado.ajusteLiquidacionCLP).toBe(0);
  });

  // =========================================================================
  // Caso 2: entregado con conductor → ambos true
  // =========================================================================
  it('entregado con conductor → generaCobro=true, generaLiquidacion=true', () => {
    const entrada: EntradaMotor = {
      estadoPedido: 'entregado',
      afectaCobro: null,
      afectaLiquidacion: null,
      esGastoPropio: false,
      tieneDriverAsignado: true,
    };

    const resultado = evaluarElegibilidad(entrada);

    expect(resultado.generaCobro).toBe(true);
    expect(resultado.generaLiquidacion).toBe(true);
  });

  // =========================================================================
  // Caso 3: fallido afecta_cobro=true, afecta_liquidacion=false
  //         → cobro sí, liquidación no
  // =========================================================================
  it('fallido afectaCobro=true afectaLiquidacion=false → generaCobro=true, generaLiquidacion=false', () => {
    const entrada: EntradaMotor = {
      estadoPedido: 'fallido',
      afectaCobro: true,
      afectaLiquidacion: false,
      esGastoPropio: false,
      tieneDriverAsignado: true,
    };

    const resultado = evaluarElegibilidad(entrada);

    expect(resultado.generaCobro).toBe(true);
    expect(resultado.generaLiquidacion).toBe(false);
  });

  // =========================================================================
  // Caso 4: fallido afecta_cobro=false, afecta_liquidacion=true
  //         → cobro no, liquidación sí
  // =========================================================================
  it('fallido afectaCobro=false afectaLiquidacion=true → generaCobro=false, generaLiquidacion=true', () => {
    const entrada: EntradaMotor = {
      estadoPedido: 'fallido',
      afectaCobro: false,
      afectaLiquidacion: true,
      esGastoPropio: false,
      tieneDriverAsignado: true,
    };

    const resultado = evaluarElegibilidad(entrada);

    expect(resultado.generaCobro).toBe(false);
    expect(resultado.generaLiquidacion).toBe(true);
  });

  // =========================================================================
  // Caso 5: fallido ambos false → ambos false
  // =========================================================================
  it('fallido afectaCobro=false afectaLiquidacion=false → generaCobro=false, generaLiquidacion=false', () => {
    const entrada: EntradaMotor = {
      estadoPedido: 'fallido',
      afectaCobro: false,
      afectaLiquidacion: false,
      esGastoPropio: false,
      tieneDriverAsignado: true,
    };

    const resultado = evaluarElegibilidad(entrada);

    expect(resultado.generaCobro).toBe(false);
    expect(resultado.generaLiquidacion).toBe(false);
  });

  // =========================================================================
  // Caso 6: fallido ambos true → ambos true
  // =========================================================================
  it('fallido afectaCobro=true afectaLiquidacion=true → generaCobro=true, generaLiquidacion=true', () => {
    const entrada: EntradaMotor = {
      estadoPedido: 'fallido',
      afectaCobro: true,
      afectaLiquidacion: true,
      esGastoPropio: false,
      tieneDriverAsignado: true,
    };

    const resultado = evaluarElegibilidad(entrada);

    expect(resultado.generaCobro).toBe(true);
    expect(resultado.generaLiquidacion).toBe(true);
  });

  // =========================================================================
  // Caso 7: devuelto → ambos false
  // =========================================================================
  it('devuelto → generaCobro=false, generaLiquidacion=false', () => {
    const entrada: EntradaMotor = {
      estadoPedido: 'devuelto',
      afectaCobro: null,
      afectaLiquidacion: null,
      esGastoPropio: false,
      tieneDriverAsignado: true,
    };

    const resultado = evaluarElegibilidad(entrada);

    expect(resultado.generaCobro).toBe(false);
    expect(resultado.generaLiquidacion).toBe(false);
  });

  // =========================================================================
  // Caso 8: same_day gasto propio con conductor → cobro no, liquidación sí
  // =========================================================================
  it('same_day esGastoPropio=true con conductor → generaCobro=false, generaLiquidacion=true', () => {
    const entrada: EntradaMotor = {
      estadoPedido: 'entregado',
      afectaCobro: null,
      afectaLiquidacion: null,
      esGastoPropio: true,
      tieneDriverAsignado: true,
    };

    const resultado = evaluarElegibilidad(entrada);

    expect(resultado.generaCobro).toBe(false);
    expect(resultado.generaLiquidacion).toBe(true);
  });

  // =========================================================================
  // Casos adicionales de robustez
  // =========================================================================

  it('cancelado → generaCobro=false, generaLiquidacion=false (con conductor)', () => {
    const entrada: EntradaMotor = {
      estadoPedido: 'cancelado',
      afectaCobro: null,
      afectaLiquidacion: null,
      esGastoPropio: false,
      tieneDriverAsignado: true,
    };

    const resultado = evaluarElegibilidad(entrada);

    expect(resultado.generaCobro).toBe(false);
    expect(resultado.generaLiquidacion).toBe(false);
  });

  it('entregado_manual con conductor → ambos true (análogo a entregado)', () => {
    const entrada: EntradaMotor = {
      estadoPedido: 'entregado_manual',
      afectaCobro: null,
      afectaLiquidacion: null,
      esGastoPropio: false,
      tieneDriverAsignado: true,
    };

    const resultado = evaluarElegibilidad(entrada);

    expect(resultado.generaCobro).toBe(true);
    expect(resultado.generaLiquidacion).toBe(true);
  });

  it('fallido_manual tiene la misma lógica que fallido', () => {
    const entradaFallido: EntradaMotor = {
      estadoPedido: 'fallido',
      afectaCobro: true,
      afectaLiquidacion: false,
      esGastoPropio: false,
      tieneDriverAsignado: true,
    };

    const entradaFallidoManual: EntradaMotor = {
      ...entradaFallido,
      estadoPedido: 'fallido_manual',
    };

    expect(evaluarElegibilidad(entradaFallido)).toEqual(evaluarElegibilidad(entradaFallidoManual));
  });

  it('same_day gasto propio sin conductor → cobro no, liquidación no', () => {
    const entrada: EntradaMotor = {
      estadoPedido: 'entregado',
      afectaCobro: null,
      afectaLiquidacion: null,
      esGastoPropio: true,
      tieneDriverAsignado: false,
    };

    const resultado = evaluarElegibilidad(entrada);

    expect(resultado.generaCobro).toBe(false);
    expect(resultado.generaLiquidacion).toBe(false);
  });

  it('los ajustes CLP son siempre 0 en el MVP', () => {
    const entrada: EntradaMotor = {
      estadoPedido: 'entregado',
      afectaCobro: null,
      afectaLiquidacion: null,
      esGastoPropio: false,
      tieneDriverAsignado: true,
    };

    const resultado = evaluarElegibilidad(entrada);

    expect(resultado.ajusteCobroCLP).toBe(0);
    expect(resultado.ajusteLiquidacionCLP).toBe(0);
  });

  // =========================================================================
  // Invariantes: ajustes siempre 0 en el MVP para TODOS los estados
  // =========================================================================

  it('invariante: ajusteCobro=0 y ajusteLiquidacion=0 para estado devuelto', () => {
    const resultado = evaluarElegibilidad({
      estadoPedido: 'devuelto',
      afectaCobro: null,
      afectaLiquidacion: null,
      esGastoPropio: false,
      tieneDriverAsignado: true,
    });
    expect(resultado.ajusteCobroCLP).toBe(0);
    expect(resultado.ajusteLiquidacionCLP).toBe(0);
  });

  it('invariante: ajusteCobro=0 y ajusteLiquidacion=0 para estado cancelado', () => {
    const resultado = evaluarElegibilidad({
      estadoPedido: 'cancelado',
      afectaCobro: null,
      afectaLiquidacion: null,
      esGastoPropio: false,
      tieneDriverAsignado: true,
    });
    expect(resultado.ajusteCobroCLP).toBe(0);
    expect(resultado.ajusteLiquidacionCLP).toBe(0);
  });

  it('invariante: ajusteCobro=0 y ajusteLiquidacion=0 para fallido afecta_cobro=true', () => {
    const resultado = evaluarElegibilidad({
      estadoPedido: 'fallido',
      afectaCobro: true,
      afectaLiquidacion: true,
      esGastoPropio: false,
      tieneDriverAsignado: true,
    });
    expect(resultado.ajusteCobroCLP).toBe(0);
    expect(resultado.ajusteLiquidacionCLP).toBe(0);
  });

  it('invariante: ajusteCobro=0 y ajusteLiquidacion=0 para same_day gasto propio', () => {
    const resultado = evaluarElegibilidad({
      estadoPedido: 'entregado',
      afectaCobro: null,
      afectaLiquidacion: null,
      esGastoPropio: true,
      tieneDriverAsignado: true,
    });
    expect(resultado.ajusteCobroCLP).toBe(0);
    expect(resultado.ajusteLiquidacionCLP).toBe(0);
  });

  // =========================================================================
  // Borde: fallido gasto propio — no cobra al seller aunque afecta_cobro=true
  // =========================================================================

  it('fallido + esGastoPropio=true → generaCobro=false aunque afectaCobro=true', () => {
    const resultado = evaluarElegibilidad({
      estadoPedido: 'fallido',
      afectaCobro: true,
      afectaLiquidacion: true,
      esGastoPropio: true,
      tieneDriverAsignado: true,
    });
    expect(resultado.generaCobro).toBe(false);
    // Liquidación sí procede si afectaLiquidacion=true y hay driver
    expect(resultado.generaLiquidacion).toBe(true);
  });

  it('fallido + esGastoPropio=true + afectaLiquidacion=false → ambos false', () => {
    const resultado = evaluarElegibilidad({
      estadoPedido: 'fallido',
      afectaCobro: true,
      afectaLiquidacion: false,
      esGastoPropio: true,
      tieneDriverAsignado: true,
    });
    expect(resultado.generaCobro).toBe(false);
    expect(resultado.generaLiquidacion).toBe(false);
  });

  // =========================================================================
  // Borde: fallido sin driver asignado — liquidación nunca se genera
  // =========================================================================

  it('fallido afectaLiquidacion=true pero sin driver → generaLiquidacion=false', () => {
    const resultado = evaluarElegibilidad({
      estadoPedido: 'fallido',
      afectaCobro: true,
      afectaLiquidacion: true,
      esGastoPropio: false,
      tieneDriverAsignado: false,
    });
    expect(resultado.generaCobro).toBe(true);
    expect(resultado.generaLiquidacion).toBe(false);
  });

  // =========================================================================
  // Borde: estado desconocido / no financiero → defensivo: ambos false
  // =========================================================================

  it('estado no financiero (pendiente_asignacion) → ambos false (rama defensiva)', () => {
    const resultado = evaluarElegibilidad({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      estadoPedido: 'pendiente_asignacion' as any,
      afectaCobro: null,
      afectaLiquidacion: null,
      esGastoPropio: false,
      tieneDriverAsignado: true,
    });
    expect(resultado.generaCobro).toBe(false);
    expect(resultado.generaLiquidacion).toBe(false);
    expect(resultado.ajusteCobroCLP).toBe(0);
    expect(resultado.ajusteLiquidacionCLP).toBe(0);
  });

  it('estado "en_ruta" (no financiero) → ambos false (rama defensiva)', () => {
    const resultado = evaluarElegibilidad({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      estadoPedido: 'en_ruta' as any,
      afectaCobro: null,
      afectaLiquidacion: null,
      esGastoPropio: false,
      tieneDriverAsignado: true,
    });
    expect(resultado.generaCobro).toBe(false);
    expect(resultado.generaLiquidacion).toBe(false);
  });

  // =========================================================================
  // Borde: fallido_manual sin driver — igual que fallido, liquidación no procede
  // =========================================================================

  it('fallido_manual + afectaLiquidacion=true + sin driver → generaLiquidacion=false', () => {
    const resultado = evaluarElegibilidad({
      estadoPedido: 'fallido_manual',
      afectaCobro: false,
      afectaLiquidacion: true,
      esGastoPropio: false,
      tieneDriverAsignado: false,
    });
    expect(resultado.generaCobro).toBe(false);
    expect(resultado.generaLiquidacion).toBe(false);
  });

  // =========================================================================
  // Borde: entregado_manual sin conductor — igual que entregado, cobra al seller
  // =========================================================================

  it('entregado_manual sin conductor → generaCobro=true, generaLiquidacion=false', () => {
    const resultado = evaluarElegibilidad({
      estadoPedido: 'entregado_manual',
      afectaCobro: null,
      afectaLiquidacion: null,
      esGastoPropio: false,
      tieneDriverAsignado: false,
    });
    expect(resultado.generaCobro).toBe(true);
    expect(resultado.generaLiquidacion).toBe(false);
  });

  // =========================================================================
  // Borde: devuelto con conductor asignado — sigue sin generar nada
  // =========================================================================

  it('devuelto con conductor asignado → sigue sin generar nada', () => {
    const resultado = evaluarElegibilidad({
      estadoPedido: 'devuelto',
      afectaCobro: null,
      afectaLiquidacion: null,
      esGastoPropio: false,
      tieneDriverAsignado: true,
    });
    expect(resultado.generaCobro).toBe(false);
    expect(resultado.generaLiquidacion).toBe(false);
  });

  // =========================================================================
  // Propiedad: el ResultadoMotor siempre es un objeto con exactamente los 4
  // campos esperados (no hay campos extra que pudieran filtrar datos)
  // =========================================================================

  it('el resultado tiene exactamente los 4 campos del contrato (sin campos extra)', () => {
    const resultado = evaluarElegibilidad({
      estadoPedido: 'entregado',
      afectaCobro: null,
      afectaLiquidacion: null,
      esGastoPropio: false,
      tieneDriverAsignado: true,
    });
    expect(Object.keys(resultado).sort()).toEqual(
      ['ajusteCobroCLP', 'ajusteLiquidacionCLP', 'generaCobro', 'generaLiquidacion'].sort(),
    );
  });
});

// =============================================================================
// evaluarMotivoElegibilidad — motivo estructurado (código + texto) por rama
//
// Hallazgo P0 de auditoría externa: "versionar y congelar las reglas
// económicas". Esta función hermana de `evaluarElegibilidad` explica el
// PORQUÉ de cada decisión — el código va en `snapshot_regla.regla.regla_id`
// y en `snapshot_regla.elegibilidad.motivo_codigo`/`motivo_texto`.
// =============================================================================
describe('evaluarMotivoElegibilidad — motivos por rama', () => {
  it('entregado sin conductor → cobro=ENTREGADO_GENERA_COBRO, liquidacion=ENTREGADO_SIN_DRIVER_NO_LIQUIDA', () => {
    const motivos = evaluarMotivoElegibilidad({
      estadoPedido: 'entregado',
      afectaCobro: null,
      afectaLiquidacion: null,
      esGastoPropio: false,
      tieneDriverAsignado: false,
    });
    expect(motivos.cobro.codigo).toBe('ENTREGADO_GENERA_COBRO');
    expect(motivos.liquidacion.codigo).toBe('ENTREGADO_SIN_DRIVER_NO_LIQUIDA');
  });

  it('entregado con conductor → cobro=ENTREGADO_GENERA_COBRO, liquidacion=ENTREGADO_GENERA_LIQUIDACION', () => {
    const motivos = evaluarMotivoElegibilidad({
      estadoPedido: 'entregado',
      afectaCobro: null,
      afectaLiquidacion: null,
      esGastoPropio: false,
      tieneDriverAsignado: true,
    });
    expect(motivos.cobro.codigo).toBe('ENTREGADO_GENERA_COBRO');
    expect(motivos.liquidacion.codigo).toBe('ENTREGADO_GENERA_LIQUIDACION');
  });

  it('fallido afectaCobro=true afectaLiquidacion=false (con driver) → FALLIDO_INCIDENCIA_AFECTA_COBRO / FALLIDO_INCIDENCIA_NO_AFECTA_LIQUIDACION', () => {
    const motivos = evaluarMotivoElegibilidad({
      estadoPedido: 'fallido',
      afectaCobro: true,
      afectaLiquidacion: false,
      esGastoPropio: false,
      tieneDriverAsignado: true,
    });
    expect(motivos.cobro.codigo).toBe('FALLIDO_INCIDENCIA_AFECTA_COBRO');
    expect(motivos.liquidacion.codigo).toBe('FALLIDO_INCIDENCIA_NO_AFECTA_LIQUIDACION');
  });

  it('fallido afectaCobro=false afectaLiquidacion=true (con driver) → FALLIDO_INCIDENCIA_NO_AFECTA_COBRO / FALLIDO_INCIDENCIA_AFECTA_LIQUIDACION', () => {
    const motivos = evaluarMotivoElegibilidad({
      estadoPedido: 'fallido',
      afectaCobro: false,
      afectaLiquidacion: true,
      esGastoPropio: false,
      tieneDriverAsignado: true,
    });
    expect(motivos.cobro.codigo).toBe('FALLIDO_INCIDENCIA_NO_AFECTA_COBRO');
    expect(motivos.liquidacion.codigo).toBe('FALLIDO_INCIDENCIA_AFECTA_LIQUIDACION');
  });

  it('fallido ambos false → FALLIDO_INCIDENCIA_NO_AFECTA_COBRO / FALLIDO_INCIDENCIA_NO_AFECTA_LIQUIDACION', () => {
    const motivos = evaluarMotivoElegibilidad({
      estadoPedido: 'fallido',
      afectaCobro: false,
      afectaLiquidacion: false,
      esGastoPropio: false,
      tieneDriverAsignado: true,
    });
    expect(motivos.cobro.codigo).toBe('FALLIDO_INCIDENCIA_NO_AFECTA_COBRO');
    expect(motivos.liquidacion.codigo).toBe('FALLIDO_INCIDENCIA_NO_AFECTA_LIQUIDACION');
  });

  it('fallido ambos true → FALLIDO_INCIDENCIA_AFECTA_COBRO / FALLIDO_INCIDENCIA_AFECTA_LIQUIDACION', () => {
    const motivos = evaluarMotivoElegibilidad({
      estadoPedido: 'fallido',
      afectaCobro: true,
      afectaLiquidacion: true,
      esGastoPropio: false,
      tieneDriverAsignado: true,
    });
    expect(motivos.cobro.codigo).toBe('FALLIDO_INCIDENCIA_AFECTA_COBRO');
    expect(motivos.liquidacion.codigo).toBe('FALLIDO_INCIDENCIA_AFECTA_LIQUIDACION');
  });

  it('devuelto → DEVUELTO_NO_GENERA en ambos lados', () => {
    const motivos = evaluarMotivoElegibilidad({
      estadoPedido: 'devuelto',
      afectaCobro: null,
      afectaLiquidacion: null,
      esGastoPropio: false,
      tieneDriverAsignado: true,
    });
    expect(motivos.cobro.codigo).toBe('DEVUELTO_NO_GENERA');
    expect(motivos.liquidacion.codigo).toBe('DEVUELTO_NO_GENERA');
  });

  it('cancelado → CANCELADO_NO_GENERA en ambos lados', () => {
    const motivos = evaluarMotivoElegibilidad({
      estadoPedido: 'cancelado',
      afectaCobro: null,
      afectaLiquidacion: null,
      esGastoPropio: false,
      tieneDriverAsignado: true,
    });
    expect(motivos.cobro.codigo).toBe('CANCELADO_NO_GENERA');
    expect(motivos.liquidacion.codigo).toBe('CANCELADO_NO_GENERA');
  });

  it('same_day gasto propio con conductor → SAME_DAY_GASTO_PROPIO_SIN_COBRO / SAME_DAY_GASTO_PROPIO_GENERA_LIQUIDACION', () => {
    const motivos = evaluarMotivoElegibilidad({
      estadoPedido: 'entregado',
      afectaCobro: null,
      afectaLiquidacion: null,
      esGastoPropio: true,
      tieneDriverAsignado: true,
    });
    expect(motivos.cobro.codigo).toBe('SAME_DAY_GASTO_PROPIO_SIN_COBRO');
    expect(motivos.liquidacion.codigo).toBe('SAME_DAY_GASTO_PROPIO_GENERA_LIQUIDACION');
  });

  it('same_day gasto propio sin conductor → SAME_DAY_GASTO_PROPIO_SIN_COBRO / ENTREGADO_SIN_DRIVER_NO_LIQUIDA', () => {
    const motivos = evaluarMotivoElegibilidad({
      estadoPedido: 'entregado',
      afectaCobro: null,
      afectaLiquidacion: null,
      esGastoPropio: true,
      tieneDriverAsignado: false,
    });
    expect(motivos.cobro.codigo).toBe('SAME_DAY_GASTO_PROPIO_SIN_COBRO');
    expect(motivos.liquidacion.codigo).toBe('ENTREGADO_SIN_DRIVER_NO_LIQUIDA');
  });

  it('fallido + esGastoPropio=true → FALLIDO_GASTO_PROPIO_SIN_COBRO aunque afectaCobro=true', () => {
    const motivos = evaluarMotivoElegibilidad({
      estadoPedido: 'fallido',
      afectaCobro: true,
      afectaLiquidacion: true,
      esGastoPropio: true,
      tieneDriverAsignado: true,
    });
    expect(motivos.cobro.codigo).toBe('FALLIDO_GASTO_PROPIO_SIN_COBRO');
    // La liquidación no depende de esGastoPropio, solo de afecta_liquidacion + driver.
    expect(motivos.liquidacion.codigo).toBe('FALLIDO_INCIDENCIA_AFECTA_LIQUIDACION');
  });

  it('fallido afectaLiquidacion=true pero sin driver → FALLIDO_INCIDENCIA_AFECTA_LIQUIDACION_SIN_DRIVER (distinto de "no afecta")', () => {
    const motivos = evaluarMotivoElegibilidad({
      estadoPedido: 'fallido',
      afectaCobro: true,
      afectaLiquidacion: true,
      esGastoPropio: false,
      tieneDriverAsignado: false,
    });
    // Código distinto de FALLIDO_INCIDENCIA_NO_AFECTA_LIQUIDACION a propósito: la
    // incidencia SÍ afectaba la liquidación, la causa de no generarla es la falta
    // de conductor, no que la incidencia fuera irrelevante — el snapshot_regla
    // debe poder distinguir ambas causas meses después (hallazgo P0 de auditoría).
    expect(motivos.liquidacion.codigo).toBe('FALLIDO_INCIDENCIA_AFECTA_LIQUIDACION_SIN_DRIVER');
  });

  it('estado no reconocido → ESTADO_NO_RECONOCIDO_NO_GENERA en ambos lados (rama defensiva)', () => {
    const motivos = evaluarMotivoElegibilidad({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      estadoPedido: 'pendiente_asignacion' as any,
      afectaCobro: null,
      afectaLiquidacion: null,
      esGastoPropio: false,
      tieneDriverAsignado: true,
    });
    expect(motivos.cobro.codigo).toBe('ESTADO_NO_RECONOCIDO_NO_GENERA');
    expect(motivos.liquidacion.codigo).toBe('ESTADO_NO_RECONOCIDO_NO_GENERA');
  });

  it('el texto de cada motivo es un string no vacío', () => {
    const casos: EntradaMotor[] = [
      { estadoPedido: 'entregado', afectaCobro: null, afectaLiquidacion: null, esGastoPropio: false, tieneDriverAsignado: true },
      { estadoPedido: 'fallido', afectaCobro: true, afectaLiquidacion: true, esGastoPropio: false, tieneDriverAsignado: true },
      { estadoPedido: 'devuelto', afectaCobro: null, afectaLiquidacion: null, esGastoPropio: false, tieneDriverAsignado: true },
      { estadoPedido: 'cancelado', afectaCobro: null, afectaLiquidacion: null, esGastoPropio: false, tieneDriverAsignado: true },
    ];
    for (const caso of casos) {
      const motivos = evaluarMotivoElegibilidad(caso);
      expect(typeof motivos.cobro.texto).toBe('string');
      expect(motivos.cobro.texto.length).toBeGreaterThan(0);
      expect(typeof motivos.liquidacion.texto).toBe('string');
      expect(motivos.liquidacion.texto.length).toBeGreaterThan(0);
    }
  });

  // ===========================================================================
  // Invariante cruzada: el código de motivo es consistente con lo que decide
  // `evaluarElegibilidad` — un motivo "genera" nunca acompaña a un flag false,
  // y viceversa. Corre sobre una batería amplia de combinaciones.
  // ===========================================================================
  it('invariante: motivoCobro/motivoLiquidacion son consistentes con generaCobro/generaLiquidacion', () => {
    const codigosQueGeneranCobro: MotivoElegibilidadCodigo[] = ['ENTREGADO_GENERA_COBRO', 'FALLIDO_INCIDENCIA_AFECTA_COBRO'];
    const codigosQueGeneranLiquidacion: MotivoElegibilidadCodigo[] = [
      'ENTREGADO_GENERA_LIQUIDACION',
      'SAME_DAY_GASTO_PROPIO_GENERA_LIQUIDACION',
      'FALLIDO_INCIDENCIA_AFECTA_LIQUIDACION',
    ];

    const estados: EstadoPedidoDeTest[] = ['entregado', 'entregado_manual', 'fallido', 'fallido_manual', 'devuelto', 'cancelado'];
    const booleanos = [true, false];
    const nulos: (boolean | null)[] = [true, false, null];

    for (const estadoPedido of estados) {
      for (const afectaCobro of nulos) {
        for (const afectaLiquidacion of nulos) {
          for (const esGastoPropio of booleanos) {
            for (const tieneDriverAsignado of booleanos) {
              const entrada: EntradaMotor = {
                estadoPedido: estadoPedido as EntradaMotor['estadoPedido'],
                afectaCobro,
                afectaLiquidacion,
                esGastoPropio,
                tieneDriverAsignado,
              };
              const resultado = evaluarElegibilidad(entrada);
              const motivos = evaluarMotivoElegibilidad(entrada);

              expect(resultado.generaCobro).toBe(codigosQueGeneranCobro.includes(motivos.cobro.codigo));
              expect(resultado.generaLiquidacion).toBe(codigosQueGeneranLiquidacion.includes(motivos.liquidacion.codigo));
            }
          }
        }
      }
    }
  });
});

// Alias de tipo local solo para la batería exhaustiva de arriba (evita repetir el literal union).
type EstadoPedidoDeTest = 'entregado' | 'entregado_manual' | 'fallido' | 'fallido_manual' | 'devuelto' | 'cancelado';

// =============================================================================
// construirSnapshotRegla — envelope inmutable que se persiste en
// snapshot_regla (dinero.lineas_cobro / dinero.lineas_liquidacion)
// =============================================================================
describe('construirSnapshotRegla — envelope de snapshot inmutable', () => {
  const motivoCobro: MotivoElegibilidad = { codigo: 'ENTREGADO_GENERA_COBRO', texto: 'texto de prueba cobro' };
  const motivoLiquidacion: MotivoElegibilidad = { codigo: 'ENTREGADO_GENERA_LIQUIDACION', texto: 'texto de prueba liquidacion' };

  const tarifaCompleta: TarifaSnapshotInput = {
    tarifaId: 'tarifa-uuid-1',
    tipoEntrega: 'flex',
    modoCalculo: 'monto_fijo',
    zona: 'Zona Oriente',
    zonaId: 'zona-uuid-1',
    vigenteDesde: '2026-01-01',
    vigenteHasta: null,
    estado: 'activa',
    minimoRetiroClp: 5000,
    minimoFacturacionClp: 20000,
    recargoReprogramacionClp: 1500,
  };

  const incidenciaPrueba: IncidenciaSnapshotInput = {
    id: 'incidencia-uuid-1',
    tipo: 'direccion_incorrecta',
    afectaCobro: true,
    afectaLiquidacion: false,
  };

  it('lado cobro: version, origen_snapshot y estructura básica del envelope', () => {
    const snapshot = construirSnapshotRegla({
      lado: 'cobro',
      jobRunId: 'run-123',
      generadoEn: '2026-07-07T12:00:00.000Z',
      tarifa: tarifaCompleta,
      valorBaseClp: 3500,
      ajusteIncidenciaClp: 0,
      comunaDestinatario: 'Providencia',
      fechaTransicion: '2026-07-07T11:30:00.000Z',
      fechaEntregaLocal: '2026-07-07',
      estadoNuevo: 'entregado',
      estadoAnterior: 'en_ruta',
      tipoPedido: 'flex',
      esGastoPropio: false,
      incidencia: null,
      motivo: motivoCobro,
      genera: true,
    });

    expect(snapshot.version).toBe(1);
    expect(snapshot.origen_snapshot).toBe('generacion_original');
    expect(snapshot.generado_en).toBe('2026-07-07T12:00:00.000Z');
    expect(snapshot.job_run_id).toBe('run-123');
    expect(snapshot.regla).toEqual({
      motor_version: 'motor-1',
      regla_id: 'ENTREGADO_GENERA_COBRO',
      referencia: 'fase-c-dinero.md §4.3',
    });
  });

  it('lado cobro: tarifa.valor_base_clp = monto_clp (cobro), incluye recargos y mínimos', () => {
    const snapshot = construirSnapshotRegla({
      lado: 'cobro',
      jobRunId: 'run-123',
      generadoEn: '2026-07-07T12:00:00.000Z',
      tarifa: tarifaCompleta,
      valorBaseClp: 3500,
      ajusteIncidenciaClp: 0,
      comunaDestinatario: 'Providencia',
      fechaTransicion: '2026-07-07T11:30:00.000Z',
      fechaEntregaLocal: '2026-07-07',
      estadoNuevo: 'entregado',
      estadoAnterior: 'en_ruta',
      tipoPedido: 'flex',
      esGastoPropio: false,
      incidencia: null,
      motivo: motivoCobro,
      genera: true,
    });

    expect(snapshot.tarifa).toEqual({
      tarifa_id: 'tarifa-uuid-1',
      tipo_entrega: 'flex',
      modo_calculo: 'monto_fijo',
      valor_base_clp: 3500,
      vigente_desde: '2026-01-01',
      vigente_hasta: null,
      estado: 'activa',
    });

    // Recargos/mínimos SOLO en cobro — y recargo_reprogramacion_aplicado_clp
    // siempre 0 (el motor nunca lo aplica hoy; no inventar que se aplicó).
    expect(snapshot.recargos_descuentos).toEqual({
      recargo_reprogramacion_pactado_clp: 1500,
      recargo_reprogramacion_aplicado_clp: 0,
      minimo_retiro_clp: 5000,
      minimo_facturacion_clp: 20000,
      ajuste_incidencia_clp: 0,
    });
  });

  it('lado liquidacion: tarifa.valor_base_clp = monto_conductor_clp, recargos_descuentos SOLO ajuste_incidencia_clp (sin mínimos ni recargo)', () => {
    const snapshot = construirSnapshotRegla({
      lado: 'liquidacion',
      jobRunId: 'run-456',
      generadoEn: '2026-07-07T12:05:00.000Z',
      tarifa: tarifaCompleta,
      valorBaseClp: 2800,
      ajusteIncidenciaClp: 0,
      comunaDestinatario: 'Providencia',
      fechaTransicion: '2026-07-07T11:30:00.000Z',
      fechaEntregaLocal: '2026-07-07',
      estadoNuevo: 'entregado',
      estadoAnterior: 'en_ruta',
      tipoPedido: 'flex',
      esGastoPropio: false,
      incidencia: null,
      motivo: motivoLiquidacion,
      genera: true,
    });

    expect(snapshot.tarifa).toMatchObject({ valor_base_clp: 2800 });
    expect(snapshot.recargos_descuentos).toEqual({ ajuste_incidencia_clp: 0 });
    // No debe filtrarse recargo/mínimos al lado liquidación.
    expect(snapshot.recargos_descuentos).not.toHaveProperty('minimo_retiro_clp');
    expect(snapshot.recargos_descuentos).not.toHaveProperty('recargo_reprogramacion_pactado_clp');
  });

  it('zona: toma zona_id/zona de la tarifa y comuna_destinatario del pedido', () => {
    const snapshot = construirSnapshotRegla({
      lado: 'cobro',
      jobRunId: 'run-123',
      generadoEn: '2026-07-07T12:00:00.000Z',
      tarifa: tarifaCompleta,
      valorBaseClp: 3500,
      ajusteIncidenciaClp: 0,
      comunaDestinatario: 'Ñuñoa',
      fechaTransicion: '2026-07-07T11:30:00.000Z',
      fechaEntregaLocal: '2026-07-07',
      estadoNuevo: 'entregado',
      estadoAnterior: 'en_ruta',
      tipoPedido: 'flex',
      esGastoPropio: false,
      incidencia: null,
      motivo: motivoCobro,
      genera: true,
    });

    expect(snapshot.zona).toEqual({
      fuente: 'tarifa',
      zona_id: 'zona-uuid-1',
      zona_texto: 'Zona Oriente',
      comuna_destinatario: 'Ñuñoa',
    });
  });

  it('incidencia: cuando hay incidencia, incluye id/tipo/afecta_cobro/afecta_liquidacion', () => {
    const snapshot = construirSnapshotRegla({
      lado: 'cobro',
      jobRunId: 'run-123',
      generadoEn: '2026-07-07T12:00:00.000Z',
      tarifa: tarifaCompleta,
      valorBaseClp: 3500,
      ajusteIncidenciaClp: 0,
      comunaDestinatario: 'Providencia',
      fechaTransicion: '2026-07-07T11:30:00.000Z',
      fechaEntregaLocal: '2026-07-07',
      estadoNuevo: 'fallido',
      estadoAnterior: 'en_ruta',
      tipoPedido: 'flex',
      esGastoPropio: false,
      incidencia: incidenciaPrueba,
      motivo: { codigo: 'FALLIDO_INCIDENCIA_AFECTA_COBRO', texto: 'texto' },
      genera: true,
    });

    expect(snapshot.incidencia).toEqual({
      incidencia_id: 'incidencia-uuid-1',
      tipo: 'direccion_incorrecta',
      afecta_cobro: true,
      afecta_liquidacion: false,
    });
  });

  it('incidencia null → todos los campos de incidencia en null', () => {
    const snapshot = construirSnapshotRegla({
      lado: 'cobro',
      jobRunId: 'run-123',
      generadoEn: '2026-07-07T12:00:00.000Z',
      tarifa: tarifaCompleta,
      valorBaseClp: 3500,
      ajusteIncidenciaClp: 0,
      comunaDestinatario: 'Providencia',
      fechaTransicion: '2026-07-07T11:30:00.000Z',
      fechaEntregaLocal: '2026-07-07',
      estadoNuevo: 'entregado',
      estadoAnterior: 'en_ruta',
      tipoPedido: 'flex',
      esGastoPropio: false,
      incidencia: null,
      motivo: motivoCobro,
      genera: true,
    });

    expect(snapshot.incidencia).toEqual({
      incidencia_id: null,
      tipo: null,
      afecta_cobro: null,
      afecta_liquidacion: null,
    });
  });

  it('tarifa null (tarifaAplicableId ausente) → tarifa_id y demás campos de tarifa en null, valor_base_clp sigue siendo el pasado (0)', () => {
    const snapshot = construirSnapshotRegla({
      lado: 'cobro',
      jobRunId: 'run-123',
      generadoEn: '2026-07-07T12:00:00.000Z',
      tarifa: null,
      valorBaseClp: 0,
      ajusteIncidenciaClp: 0,
      comunaDestinatario: null,
      fechaTransicion: '2026-07-07T11:30:00.000Z',
      fechaEntregaLocal: '2026-07-07',
      estadoNuevo: 'entregado',
      estadoAnterior: 'en_ruta',
      tipoPedido: 'flex',
      esGastoPropio: false,
      incidencia: null,
      motivo: motivoCobro,
      genera: true,
    });

    expect(snapshot.tarifa).toEqual({
      tarifa_id: null,
      tipo_entrega: null,
      modo_calculo: null,
      valor_base_clp: 0,
      vigente_desde: null,
      vigente_hasta: null,
      estado: null,
    });
    expect(snapshot.recargos_descuentos).toEqual({
      recargo_reprogramacion_pactado_clp: null,
      recargo_reprogramacion_aplicado_clp: 0,
      minimo_retiro_clp: null,
      minimo_facturacion_clp: null,
      ajuste_incidencia_clp: 0,
    });
    expect(snapshot.zona).toEqual({
      fuente: 'tarifa',
      zona_id: null,
      zona_texto: null,
      comuna_destinatario: null,
    });
  });

  it('elegibilidad: refleja genera, ajuste_clp y el motivo pasado', () => {
    const snapshot = construirSnapshotRegla({
      lado: 'liquidacion',
      jobRunId: 'run-789',
      generadoEn: '2026-07-07T12:10:00.000Z',
      tarifa: tarifaCompleta,
      valorBaseClp: 2800,
      ajusteIncidenciaClp: 0,
      comunaDestinatario: 'Providencia',
      fechaTransicion: '2026-07-07T11:30:00.000Z',
      fechaEntregaLocal: '2026-07-07',
      estadoNuevo: 'entregado',
      estadoAnterior: 'en_ruta',
      tipoPedido: 'flex',
      esGastoPropio: false,
      incidencia: null,
      motivo: motivoLiquidacion,
      genera: true,
    });

    expect(snapshot.elegibilidad).toEqual({
      genera: true,
      ajuste_clp: 0,
      motivo_codigo: 'ENTREGADO_GENERA_LIQUIDACION',
      motivo_texto: 'texto de prueba liquidacion',
    });
  });

  it('estado_pedido: refleja estado_nuevo/estado_anterior/tipo_pedido/es_gasto_propio', () => {
    const snapshot = construirSnapshotRegla({
      lado: 'cobro',
      jobRunId: 'run-123',
      generadoEn: '2026-07-07T12:00:00.000Z',
      tarifa: null,
      valorBaseClp: 0,
      ajusteIncidenciaClp: 0,
      comunaDestinatario: null,
      fechaTransicion: '2026-07-07T11:30:00.000Z',
      fechaEntregaLocal: '2026-07-07',
      estadoNuevo: 'entregado',
      estadoAnterior: 'en_ruta',
      tipoPedido: 'same_day',
      esGastoPropio: true,
      incidencia: null,
      motivo: motivoCobro,
      genera: true,
    });

    expect(snapshot.estado_pedido).toEqual({
      estado_nuevo: 'entregado',
      estado_anterior: 'en_ruta',
      tipo_pedido: 'same_day',
      es_gasto_propio: true,
    });
  });

  it('el envelope tiene exactamente las claves de primer nivel documentadas en la migración', () => {
    const snapshot = construirSnapshotRegla({
      lado: 'cobro',
      jobRunId: 'run-123',
      generadoEn: '2026-07-07T12:00:00.000Z',
      tarifa: tarifaCompleta,
      valorBaseClp: 3500,
      ajusteIncidenciaClp: 0,
      comunaDestinatario: 'Providencia',
      fechaTransicion: '2026-07-07T11:30:00.000Z',
      fechaEntregaLocal: '2026-07-07',
      estadoNuevo: 'entregado',
      estadoAnterior: 'en_ruta',
      tipoPedido: 'flex',
      esGastoPropio: false,
      incidencia: null,
      motivo: motivoCobro,
      genera: true,
    });

    expect(Object.keys(snapshot).sort()).toEqual(
      [
        'version',
        'origen_snapshot',
        'generado_en',
        'job_run_id',
        'regla',
        'tarifa',
        'recargos_descuentos',
        'zona',
        'fecha_efectiva',
        'estado_pedido',
        'incidencia',
        'elegibilidad',
      ].sort(),
    );
  });
});
