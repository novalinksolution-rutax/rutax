/**
 * Tests de `reatribucion-liquidacion.ts` — decisión pura del job C1
 * (`jobs/generar-lineas.ts`) sobre qué hacer cuando el INSERT de una línea de
 * liquidación choca con el UNIQUE(pedido_id) y la línea existente está
 * atribuida a un conductor distinto del que trae el evento actual.
 *
 * Bug real (2026-08-12) — "Pedro entrega, Juan cobra": un pedido `fallido`
 * con incidencia que afecta_liquidacion genera línea a nombre del conductor A;
 * se reasigna a B, que termina entregando. Sin esta decisión, el conflicto del
 * INSERT devolvía la línea de A sin comparar `driver_id` contra el conductor
 * del evento — la entrega de B quedaba pagada a A, en silencio.
 */

import { describe, it, expect } from 'vitest';
import { decidirReatribucionLiquidacion } from './reatribucion-liquidacion';
import type { EntradaDecisionReatribucion } from './reatribucion-liquidacion';

describe('decidirReatribucionLiquidacion', () => {
  it('mismo conductor en la línea existente y en el evento → sin_cambio', () => {
    const entrada: EntradaDecisionReatribucion = {
      driverIdLineaExistente: 'conductor-juan',
      driverIdEvento: 'conductor-juan',
      liquidacionIdExistente: 'liquidacion-1',
      estadoLiquidacionExistente: 'borrador',
    };
    expect(decidirReatribucionLiquidacion(entrada)).toBe('sin_cambio');
  });

  it('mismo conductor incluso con liquidación ya emitida → sin_cambio (nada que corregir)', () => {
    const entrada: EntradaDecisionReatribucion = {
      driverIdLineaExistente: 'conductor-juan',
      driverIdEvento: 'conductor-juan',
      liquidacionIdExistente: 'liquidacion-1',
      estadoLiquidacionExistente: 'pagada',
    };
    expect(decidirReatribucionLiquidacion(entrada)).toBe('sin_cambio');
  });

  it('conductor distinto, línea sin liquidación asignada (liquidacion_id=null) → reatribuir', () => {
    const entrada: EntradaDecisionReatribucion = {
      driverIdLineaExistente: 'conductor-juan',
      driverIdEvento: 'conductor-pedro',
      liquidacionIdExistente: null,
      estadoLiquidacionExistente: null,
    };
    expect(decidirReatribucionLiquidacion(entrada)).toBe('reatribuir');
  });

  it('conductor distinto, liquidación de origen en borrador → reatribuir', () => {
    const entrada: EntradaDecisionReatribucion = {
      driverIdLineaExistente: 'conductor-juan',
      driverIdEvento: 'conductor-pedro',
      liquidacionIdExistente: 'liquidacion-juan-borrador',
      estadoLiquidacionExistente: 'borrador',
    };
    expect(decidirReatribucionLiquidacion(entrada)).toBe('reatribuir');
  });

  it('conductor distinto, liquidación de origen ya emitida → excepcion (compuerta humana, no se muta)', () => {
    const entrada: EntradaDecisionReatribucion = {
      driverIdLineaExistente: 'conductor-juan',
      driverIdEvento: 'conductor-pedro',
      liquidacionIdExistente: 'liquidacion-juan-emitida',
      estadoLiquidacionExistente: 'emitida',
    };
    expect(decidirReatribucionLiquidacion(entrada)).toBe('excepcion');
  });

  it('conductor distinto, liquidación de origen ya pagada → excepcion (dinero ya salió, no se muta)', () => {
    const entrada: EntradaDecisionReatribucion = {
      driverIdLineaExistente: 'conductor-juan',
      driverIdEvento: 'conductor-pedro',
      liquidacionIdExistente: 'liquidacion-juan-pagada',
      estadoLiquidacionExistente: 'pagada',
    };
    expect(decidirReatribucionLiquidacion(entrada)).toBe('excepcion');
  });

  it('es una función pura: la misma entrada produce siempre la misma decisión', () => {
    const entrada: EntradaDecisionReatribucion = {
      driverIdLineaExistente: 'conductor-juan',
      driverIdEvento: 'conductor-pedro',
      liquidacionIdExistente: 'liquidacion-1',
      estadoLiquidacionExistente: 'borrador',
    };
    const resultados = Array.from({ length: 5 }, () => decidirReatribucionLiquidacion(entrada));
    for (const r of resultados) {
      expect(r).toBe('reatribuir');
    }
  });
});
