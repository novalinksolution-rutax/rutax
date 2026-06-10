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
import { evaluarElegibilidad } from './motor';
import type { EntradaMotor } from './motor';

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
