/**
 * Tests del cobro por pedido efectivo — Rutax → courier.
 * =============================================================================
 *
 * Lo que fijan estas pruebas es una boleta. Un error acá no se ve en ninguna
 * pantalla: se ve cuando el courier abre su cobro y no le cuadra.
 */

import { describe, it, expect } from 'vitest';

import {
  calcularMontoComision,
  mesAnteriorDe,
  type TarifaComision,
} from './cobro-por-pedido';

const TARIFA: TarifaComision = { precioPorPedidoClp: 40, minimoMensualClp: 20_000 };

describe('calcularMontoComision', () => {
  it('cobra entregas × tarifa cuando supera el mínimo', () => {
    const r = calcularMontoComision({
      pedidosEfectivos: 1_000,
      tarifa: TARIFA,
      esPrimerMes: false,
    });
    expect(r.montoClp).toBe(40_000);
    expect(r.pedidosEfectivos).toBe(1_000);
    expect(r.tarifaAplicadaClp).toBe(40);
    expect(r.aplicoMinimo).toBe(false);
  });

  it('🔴 cobra el mínimo cuando la comisión queda por debajo', () => {
    // 200 entregas × $40 = $8.000, bajo el piso de $20.000.
    const r = calcularMontoComision({
      pedidosEfectivos: 200,
      tarifa: TARIFA,
      esPrimerMes: false,
    });
    expect(r.montoClp).toBe(20_000);
    expect(r.aplicoMinimo).toBe(true);
    // Las entregas reales se conservan aunque no manden el monto: son lo que se
    // le muestra al courier para explicarle por qué pagó el piso.
    expect(r.pedidosEfectivos).toBe(200);
  });

  it('en el borde exacto NO aplica el mínimo: manda la comisión', () => {
    // 500 × $40 = $20.000, igual al piso. `>` y no `>=`: empatados, la cifra que
    // se muestra tiene que ser la comisión, que es la que el courier reconoce.
    const r = calcularMontoComision({ pedidosEfectivos: 500, tarifa: TARIFA, esPrimerMes: false });
    expect(r.montoClp).toBe(20_000);
    expect(r.aplicoMinimo).toBe(false);
  });

  it('🔴 el PRIMER mes no lleva mínimo: solo comisión', () => {
    // Decisión del usuario: un courier que entra el 20 no paga un piso completo
    // por once días.
    const r = calcularMontoComision({ pedidosEfectivos: 200, tarifa: TARIFA, esPrimerMes: true });
    expect(r.montoClp).toBe(8_000);
    expect(r.aplicoMinimo).toBe(false);
  });

  it('🔴 cero entregas el primer mes es cero pesos, no el mínimo', () => {
    const r = calcularMontoComision({ pedidosEfectivos: 0, tarifa: TARIFA, esPrimerMes: true });
    expect(r.montoClp).toBe(0);
  });

  it('cero entregas un mes normal cobra el mínimo', () => {
    // Contraprueba del anterior: sin ella, «primer mes sin piso» y «nunca hay
    // piso» pasarían las dos.
    const r = calcularMontoComision({ pedidosEfectivos: 0, tarifa: TARIFA, esPrimerMes: false });
    expect(r.montoClp).toBe(20_000);
    expect(r.aplicoMinimo).toBe(true);
  });

  it('un plan sin mínimo cobra solo comisión, aunque no sea el primer mes', () => {
    const sinPiso: TarifaComision = { precioPorPedidoClp: 30, minimoMensualClp: null };
    const r = calcularMontoComision({ pedidosEfectivos: 10, tarifa: sinPiso, esPrimerMes: false });
    expect(r.montoClp).toBe(300);
    expect(r.aplicoMinimo).toBe(false);
  });

  it('una tarifa con decimales se redondea, no se trunca', () => {
    // La columna es `int`. Truncar hacia abajo regalaría plata por sistema.
    const r = calcularMontoComision({
      pedidosEfectivos: 3,
      tarifa: { precioPorPedidoClp: 37.5, minimoMensualClp: 0 },
      esPrimerMes: false,
    });
    expect(r.montoClp).toBe(113); // 112,5 → 113
  });

  it('guarda la tarifa aplicada, no solo el total', () => {
    // Sin esto, «¿por qué me cobraste esto?» solo se responde recalculando — y
    // recalcular meses después da otro número porque los pedidos cambian de
    // estado.
    const r = calcularMontoComision({
      pedidosEfectivos: 312,
      tarifa: { precioPorPedidoClp: 40, minimoMensualClp: 0 },
      esPrimerMes: false,
    });
    expect(r.tarifaAplicadaClp).toBe(40);
    expect(r.pedidosEfectivos).toBe(312);
    expect(r.montoClp).toBe(12_480);
  });
});

describe('mesAnteriorDe', () => {
  it('devuelve el mes civil anterior', () => {
    expect(mesAnteriorDe('2026-09-01')).toBe('2026-08');
    expect(mesAnteriorDe('2026-09-30')).toBe('2026-08');
  });

  it('🔴 cruza el año sin equivocarse', () => {
    // El cron corre el 1 de enero y tiene que facturar diciembre del año
    // anterior. Un `mes - 1` sin más habría dado el mes 0.
    expect(mesAnteriorDe('2027-01-01')).toBe('2026-12');
  });

  it('cruza marzo hacia febrero, que es donde se rompen los cálculos de días', () => {
    expect(mesAnteriorDe('2028-03-01')).toBe('2028-02');
  });
});
