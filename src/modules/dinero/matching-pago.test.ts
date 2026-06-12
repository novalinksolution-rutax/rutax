/**
 * Pruebas de la cascada PURA de matching de cobranza (`matching-pago.ts`).
 * Cubre la Decisión 6 del arquitecto: el matching NUNCA adivina.
 */

import { describe, it, expect } from 'vitest';
import {
  atribuirSellerPorRut,
  decidirConciliacion,
  estadoMatchDesdeResultado,
  esEstadoTerminal,
  TOLERANCIA_CALCE_CLP,
  type PeriodoCandidato,
} from './matching-pago';

describe('atribuirSellerPorRut', () => {
  const sellers = [
    { id: 's1', rut: '74.593.127-8' },
    { id: 's2', rut: '76.430.498-5' },
  ];

  it('devuelve null si el pago no trae RUT', () => {
    expect(atribuirSellerPorRut(null, sellers)).toBeNull();
  });

  it('atribuye por RUT aunque venga en formato distinto (normalización)', () => {
    // El pago trae el RUT sin puntos ni guion (como llega de Fintoc).
    expect(atribuirSellerPorRut('745931278', sellers)).toBe('s1');
  });

  it('devuelve null si ningún seller tiene ese RUT', () => {
    expect(atribuirSellerPorRut('111111111', sellers)).toBeNull();
  });

  it('no adivina entre dos sellers con el mismo RUT (>1 candidato)', () => {
    const conDuplicado = [...sellers, { id: 's3', rut: '745931278' }];
    expect(atribuirSellerPorRut('74.593.127-8', conDuplicado)).toBeNull();
  });

  it('ignora sellers con rut null', () => {
    const conNulo = [{ id: 'sx', rut: null }, { id: 's1', rut: '745931278' }];
    expect(atribuirSellerPorRut('745931278', conNulo)).toBe('s1');
  });
});

describe('decidirConciliacion', () => {
  it('sin candidatos → sin_candidato', () => {
    expect(decidirConciliacion(1000, [])).toEqual({ tipo: 'sin_candidato' });
  });

  it('calce total exacto con un único período → pagado_total', () => {
    const cands: PeriodoCandidato[] = [{ id: 'p1', saldoClp: 119000 }];
    expect(decidirConciliacion(119000, cands)).toEqual({
      tipo: 'pagado_total',
      periodoId: 'p1',
      montoImputadoClp: 119000,
    });
  });

  it('calce total dentro de tolerancia ±1 CLP', () => {
    const cands: PeriodoCandidato[] = [{ id: 'p1', saldoClp: 119001 }];
    const r = decidirConciliacion(119000, cands);
    expect(r.tipo).toBe('pagado_total');
    expect(TOLERANCIA_CALCE_CLP).toBe(1);
  });

  it('varios períodos calzan total → sobrante (no adivina a cuál)', () => {
    const cands: PeriodoCandidato[] = [
      { id: 'p1', saldoClp: 50000 },
      { id: 'p2', saldoClp: 50000 },
    ];
    expect(decidirConciliacion(50000, cands)).toEqual({ tipo: 'sobrante' });
  });

  it('abono parcial a un único período candidato → pagado_parcial', () => {
    const cands: PeriodoCandidato[] = [{ id: 'p1', saldoClp: 100000 }];
    expect(decidirConciliacion(40000, cands)).toEqual({
      tipo: 'pagado_parcial',
      periodoId: 'p1',
      montoImputadoClp: 40000,
    });
  });

  it('abono que cabe en varios períodos → sobrante (ambiguo)', () => {
    const cands: PeriodoCandidato[] = [
      { id: 'p1', saldoClp: 100000 },
      { id: 'p2', saldoClp: 80000 },
    ];
    expect(decidirConciliacion(40000, cands)).toEqual({ tipo: 'sobrante' });
  });

  it('monto mayor que todos los saldos → sobrante (sobrepago)', () => {
    const cands: PeriodoCandidato[] = [{ id: 'p1', saldoClp: 50000 }];
    expect(decidirConciliacion(90000, cands)).toEqual({ tipo: 'sobrante' });
  });
});

describe('estadoMatchDesdeResultado', () => {
  it('pagado_total → conciliado', () => {
    expect(
      estadoMatchDesdeResultado({ tipo: 'pagado_total', periodoId: 'p', montoImputadoClp: 1 }, true),
    ).toBe('conciliado');
  });

  it('pagado_parcial → parcial', () => {
    expect(
      estadoMatchDesdeResultado({ tipo: 'pagado_parcial', periodoId: 'p', montoImputadoClp: 1 }, true),
    ).toBe('parcial');
  });

  it('sobrante → sobrante', () => {
    expect(estadoMatchDesdeResultado({ tipo: 'sobrante' }, true)).toBe('sobrante');
  });

  it('sin_candidato con seller → atribuido; sin seller → sin_atribuir', () => {
    expect(estadoMatchDesdeResultado({ tipo: 'sin_candidato' }, true)).toBe('atribuido');
    expect(estadoMatchDesdeResultado({ tipo: 'sin_candidato' }, false)).toBe('sin_atribuir');
  });
});

describe('esEstadoTerminal', () => {
  it('conciliado y descartado son terminales', () => {
    expect(esEstadoTerminal('conciliado')).toBe(true);
    expect(esEstadoTerminal('descartado')).toBe(true);
  });

  it('los demás no son terminales (se pueden re-procesar)', () => {
    for (const e of ['sin_atribuir', 'atribuido', 'parcial', 'sobrante']) {
      expect(esEstadoTerminal(e)).toBe(false);
    }
  });
});
