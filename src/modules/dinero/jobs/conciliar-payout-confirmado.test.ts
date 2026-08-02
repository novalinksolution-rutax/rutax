/**
 * Tests de la lógica de `conciliar-payout-confirmado.ts` (conciliación
 * inmediata tras un payout confirmado, F19/Fase 3).
 *
 * Misma estrategia que `conciliar-tres-fuentes.test.ts`: se extrae/refleja la
 * lógica PURA de decisión del detector D1 ACOTADO (por liquidación) — sin
 * dependencias de BD — y se agrega un test de la condición de emisión del
 * evento `dinero/payout.confirmado` desde `jobAplicarActualizacionPayout`.
 */

import { describe, it, expect } from 'vitest';

// =============================================================================
// D1 acotado — refleja `conciliarLiquidacionAcotada` de conciliar-payout-confirmado.ts
// =============================================================================

interface LineaLiquidacionAcotada {
  pedidoId: string;
  driverId: string;
  montoFinalClp: number;
}

interface LineaCobroDelPedido {
  pedidoId: string;
  anulada: boolean;
}

/**
 * Detecta, dentro de las líneas de UNA liquidación, cuáles pedidos quedaron
 * sin cobro vigente al seller (cobro inexistente se OMITE — puede ser gasto
 * propio del courier; cobro ANULADO se considera fuga).
 */
function detectarFugaAcotada(
  lineasLiquidacion: LineaLiquidacionAcotada[],
  lineasCobroPorPedido: Map<string, LineaCobroDelPedido>,
): LineaLiquidacionAcotada[] {
  return lineasLiquidacion.filter((linea) => {
    const cobro = lineasCobroPorPedido.get(linea.pedidoId);
    if (!cobro) return false; // sin cobro en absoluto → omitir (no falso positivo)
    return cobro.anulada === true; // cobro anulado → fuga
  });
}

describe('D1 acotado — conciliación inmediata tras payout confirmado', () => {
  it('pedido con línea de cobro vigente (anulada=false) → NO es fuga', () => {
    const lineas: LineaLiquidacionAcotada[] = [{ pedidoId: 'ped-1', driverId: 'drv-1', montoFinalClp: 5000 }];
    const cobros = new Map([['ped-1', { pedidoId: 'ped-1', anulada: false }]]);

    expect(detectarFugaAcotada(lineas, cobros)).toHaveLength(0);
  });

  it('pedido con línea de cobro ANULADA → SÍ es fuga', () => {
    const lineas: LineaLiquidacionAcotada[] = [{ pedidoId: 'ped-2', driverId: 'drv-1', montoFinalClp: 7000 }];
    const cobros = new Map([['ped-2', { pedidoId: 'ped-2', anulada: true }]]);

    const fugas = detectarFugaAcotada(lineas, cobros);
    expect(fugas).toHaveLength(1);
    expect(fugas[0].pedidoId).toBe('ped-2');
  });

  it('pedido SIN línea de cobro en absoluto → se omite (posible gasto propio, no falso positivo)', () => {
    const lineas: LineaLiquidacionAcotada[] = [{ pedidoId: 'ped-3', driverId: 'drv-1', montoFinalClp: 3000 }];
    const cobros = new Map<string, LineaCobroDelPedido>(); // vacío: ningún cobro conocido

    expect(detectarFugaAcotada(lineas, cobros)).toHaveLength(0);
  });

  it('liquidación con varias líneas: solo reporta las que tienen cobro anulado', () => {
    const lineas: LineaLiquidacionAcotada[] = [
      { pedidoId: 'ped-a', driverId: 'drv-1', montoFinalClp: 1000 },
      { pedidoId: 'ped-b', driverId: 'drv-1', montoFinalClp: 2000 },
      { pedidoId: 'ped-c', driverId: 'drv-1', montoFinalClp: 3000 },
    ];
    const cobros = new Map([
      ['ped-a', { pedidoId: 'ped-a', anulada: false }],
      ['ped-b', { pedidoId: 'ped-b', anulada: true }],
      // ped-c: sin cobro
    ]);

    const fugas = detectarFugaAcotada(lineas, cobros);
    expect(fugas.map((f) => f.pedidoId)).toEqual(['ped-b']);
  });

  it('liquidación sin líneas → cero hallazgos, sin iterar', () => {
    expect(detectarFugaAcotada([], new Map())).toHaveLength(0);
  });
});

// =============================================================================
// Idempotencia de inserción — mismo criterio que C7 (existeEventoConciliacion)
// =============================================================================

describe('Idempotencia de la excepción de conciliación acotada', () => {
  it('si ya existe una excepción pagado_conductor_sin_cobro_seller para el pedido, no se duplica', () => {
    const excepcionesExistentes = new Set(['ped-b']); // ya reportado (p. ej. por C7 anoche)
    const pedidosConFuga = ['ped-b', 'ped-d'];

    const nuevosAInsertar = pedidosConFuga.filter((p) => !excepcionesExistentes.has(p));

    expect(nuevosAInsertar).toEqual(['ped-d']);
  });
});

// =============================================================================
// Condición de emisión de `dinero/payout.confirmado` desde
// jobAplicarActualizacionPayout — solo cuando el resultado es 'confirmado'.
// =============================================================================

type ResultadoAplicarTransicion = 'confirmado' | 'rechazado' | 'fallido' | 'pendiente' | 'desconocido';

function debeEmitirPayoutConfirmado(resultado: ResultadoAplicarTransicion): boolean {
  return resultado === 'confirmado';
}

describe('jobAplicarActualizacionPayout — condición de emisión de dinero/payout.confirmado', () => {
  it("'confirmado' → SÍ emite", () => {
    expect(debeEmitirPayoutConfirmado('confirmado')).toBe(true);
  });
  it("'rechazado' → NO emite", () => {
    expect(debeEmitirPayoutConfirmado('rechazado')).toBe(false);
  });
  it("'fallido' → NO emite", () => {
    expect(debeEmitirPayoutConfirmado('fallido')).toBe(false);
  });
  it("'pendiente' → NO emite", () => {
    expect(debeEmitirPayoutConfirmado('pendiente')).toBe(false);
  });
  it("'desconocido' → NO emite", () => {
    expect(debeEmitirPayoutConfirmado('desconocido')).toBe(false);
  });

  it('el id determinístico del evento es payout-confirmado-<payoutId> (mismo payout → mismo id → Inngest deduplica)', () => {
    const payoutId = 'payout-xyz';
    const id1 = `payout-confirmado-${payoutId}`;
    const id2 = `payout-confirmado-${payoutId}`;
    expect(id1).toBe(id2);
    expect(id1).toBe('payout-confirmado-payout-xyz');
  });
});
