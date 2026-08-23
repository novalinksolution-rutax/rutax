import { describe, expect, it } from 'vitest';

import { agruparLiquidacion } from './agrupacion-liquidacion';
import type { LineaLiquidacion } from './tipos';

/**
 * La liquidación la lee alguien que desconfía del descuento. La invariante:
 *
 *   subtotal entregas + subtotal visitas + bono − penalización = neto
 *
 * Y las dos clases de línea **no se mezclan**: una entrega se paga por tarifa y
 * una visita a bodega por bodega, así que un solo subtotal obliga al conductor
 * que reclama a rehacer la suma a mano.
 */

let n = 0;
function linea(parcial: Partial<LineaLiquidacion>): LineaLiquidacion {
  n += 1;
  const monto = parcial.montoFinalClp ?? 1450;
  return {
    id: `l${n}`,
    tenantId: 't1',
    driverId: 'd1',
    pedidoId: `p${n}`,
    sesionRetiroId: null,
    tipoHecho: 'entrega',
    liquidacionId: 'liq1',
    montoBaseClp: monto,
    ajusteIncidenciaClp: 0,
    montoFinalClp: monto,
    concepto: 'Entregas · same-day La Florida',
    ...parcial,
  } as LineaLiquidacion;
}

const SIN_AJUSTE = { bonoClp: 0, penalizacionClp: 0, notaAjuste: null };

describe('agruparLiquidacion · las dos clases no se mezclan', () => {
  it('sin líneas ni ajustes, todo en cero', () => {
    const r = agruparLiquidacion([], SIN_AJUSTE);
    expect(r.neto).toBe(0);
    expect(r.entregas).toEqual([]);
    expect(r.visitas).toEqual([]);
    expect(r.ajustes).toEqual([]);
  });

  it('separa entregas de visitas a bodega, cada una con su subtotal', () => {
    const r = agruparLiquidacion(
      [
        linea({ tipoHecho: 'entrega', montoFinalClp: 1450 }),
        linea({ tipoHecho: 'entrega', montoFinalClp: 1450 }),
        linea({
          tipoHecho: 'retiro_bodega',
          sesionRetiroId: 's1',
          pedidoId: null,
          concepto: 'Visitas a bodega · Vega Norte Maipú',
          montoFinalClp: 4500,
        }),
      ],
      SIN_AJUSTE,
    );
    expect(r.cantidadEntregas).toBe(2);
    expect(r.subtotalEntregas).toBe(2900);
    expect(r.cantidadVisitas).toBe(1);
    expect(r.subtotalVisitas).toBe(4500);
    // Y no se contaminan: ningún concepto de visita aparece entre las entregas.
    expect(r.entregas.some((f) => /Visitas/.test(f.concepto))).toBe(false);
  });

  it('CUADRA: entregas + visitas + bono − penalización = neto', () => {
    const r = agruparLiquidacion(
      [
        linea({ tipoHecho: 'entrega', montoFinalClp: 179800 }),
        linea({ tipoHecho: 'retiro_bodega', sesionRetiroId: 's1', pedidoId: null, montoFinalClp: 13500 }),
      ],
      { bonoClp: 12000, penalizacionClp: 8000, notaAjuste: 'Cubrió la ruta de J. Tapia.' },
    );
    expect(r.neto).toBe(179800 + 13500 + 12000 - 8000);
    expect(r.subtotalEntregas + r.subtotalVisitas + r.ajustes.reduce((a, x) => a + x.monto, 0)).toBe(
      r.neto,
    );
  });

  it('la penalización RESTA aunque se guarde en positivo', () => {
    const r = agruparLiquidacion([], { bonoClp: 0, penalizacionClp: 8000, notaAjuste: 'x' });
    const pen = r.ajustes.find((a) => a.concepto === 'Penalización')!;
    expect(pen.monto).toBe(-8000);
    expect(r.neto).toBe(-8000);
  });

  it('el motivo del ajuste viaja con él: lo lee el conductor', () => {
    const r = agruparLiquidacion([], {
      bonoClp: 12000,
      penalizacionClp: 0,
      notaAjuste: 'Tomó 6 paradas extra el 14-08.',
    });
    expect(r.ajustes[0].motivo).toBe('Tomó 6 paradas extra el 14-08.');
  });

  it('un ajuste en cero no genera fila: un «bono de $0» es ruido', () => {
    const r = agruparLiquidacion([], { bonoClp: 0, penalizacionClp: 0, notaAjuste: 'nada' });
    expect(r.ajustes).toEqual([]);
  });

  it('no inventa unitario cuando el concepto mezcla montos', () => {
    const r = agruparLiquidacion(
      [
        linea({ concepto: 'Mixto', montoFinalClp: 1450 }),
        linea({ concepto: 'Mixto', montoFinalClp: 1700 }),
      ],
      SIN_AJUSTE,
    );
    expect(r.entregas[0].unitario).toBeUndefined();
    expect(r.entregas[0].monto).toBe(3150);
  });

  it('CUADRA a escala, con 200 líneas de las dos clases', () => {
    const lineas: LineaLiquidacion[] = [];
    for (let i = 0; i < 196; i += 1) {
      lineas.push(
        linea({
          tipoHecho: 'entrega',
          concepto: i % 2 === 0 ? 'La Florida' : 'Puente Alto',
          montoFinalClp: i % 2 === 0 ? 1450 : 1700,
        }),
      );
    }
    for (let i = 0; i < 4; i += 1) {
      lineas.push(
        linea({
          tipoHecho: 'retiro_bodega',
          sesionRetiroId: `s${i}`,
          pedidoId: null,
          concepto: 'Vega Norte Maipú',
          montoFinalClp: 4500,
        }),
      );
    }
    const r = agruparLiquidacion(lineas, {
      bonoClp: 12000,
      penalizacionClp: 8000,
      notaAjuste: 'x',
    });
    expect(r.cantidadEntregas).toBe(196);
    expect(r.cantidadVisitas).toBe(4);
    expect(r.subtotalEntregas + r.subtotalVisitas + 12000 - 8000).toBe(r.neto);
    expect(r.entregas.reduce((a, f) => a + f.monto, 0)).toBe(r.subtotalEntregas);
    expect(r.visitas.reduce((a, f) => a + f.monto, 0)).toBe(r.subtotalVisitas);
  });
});
