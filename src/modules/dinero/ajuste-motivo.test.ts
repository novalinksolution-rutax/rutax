import { describe, expect, it } from 'vitest';

import { MINIMO_MOTIVO_AJUSTE } from './acciones';

/**
 * La regla del motivo obligatorio en un ajuste manual, aislada de la acción.
 *
 * POR QUÉ EXISTE ESTA PRUEBA
 * ---------------------------------------------------------------------------
 * `ajustarLiquidacion` no validaba el motivo **en absoluto**: se podía aplicar
 * una penalización de $8.000 sin escribir una palabra, y el conductor veía un
 * descuento sin razón en su liquidación y en su PDF. Eso no es un detalle de
 * interfaz — es una pregunta que le llega a alguien por WhatsApp.
 *
 * La condición se replica acá tal cual la aplica la acción, para poder fijarla
 * sin montar el cliente de base de datos. Si cambia en `acciones.ts`, esta
 * prueba deja de reflejarla y hay que moverla junto.
 */

/** La misma condición que aplica `ajustarLiquidacion`. */
function exigeMotivo(bonoClp: number, penalizacionClp: number, nota: string | null): boolean {
  const hayAjuste = bonoClp > 0 || penalizacionClp > 0;
  return hayAjuste && (nota ?? '').trim().length < MINIMO_MOTIVO_AJUSTE;
}

describe('motivo obligatorio del ajuste manual', () => {
  it('el mínimo es 10: «error» no alcanza para explicarle un descuento a alguien', () => {
    expect(MINIMO_MOTIVO_AJUSTE).toBe(10);
    expect('error'.length).toBeLessThan(MINIMO_MOTIVO_AJUSTE);
  });

  it('una penalización sin motivo se rechaza', () => {
    expect(exigeMotivo(0, 8000, null)).toBe(true);
    expect(exigeMotivo(0, 8000, '')).toBe(true);
    expect(exigeMotivo(0, 8000, '   ')).toBe(true);
    expect(exigeMotivo(0, 8000, 'error')).toBe(true);
  });

  it('un bono sin motivo también se rechaza: el conductor igual pregunta por qué', () => {
    expect(exigeMotivo(12000, 0, null)).toBe(true);
  });

  it('con un motivo de verdad, pasa', () => {
    expect(exigeMotivo(0, 8000, 'Se entregó con la caja abierta, el seller reclamó.')).toBe(false);
    expect(exigeMotivo(12000, 0, 'Tomó 6 paradas extra el 14-08.')).toBe(false);
  });

  it('los espacios no cuentan como motivo', () => {
    expect(exigeMotivo(0, 8000, '          ')).toBe(true);
  });

  it('con los dos ajustes en cero NO se exige: eso es limpiar, no aplicar', () => {
    // Quitar un ajuste anterior no necesita justificarse con el mismo peso que
    // ponerlo; si se exigiera, no habría forma de dejar la liquidación limpia.
    expect(exigeMotivo(0, 0, null)).toBe(false);
    expect(exigeMotivo(0, 0, '')).toBe(false);
  });
});
