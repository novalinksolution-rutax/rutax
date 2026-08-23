import { describe, expect, it } from 'vitest';

import { agruparLineasCobro } from './agrupacion-lineas';
import type { LineaCobro } from './tipos';

/**
 * La invariante que sostiene la tabla financiera:
 *
 *   subtotal de entregas + Σ ajustes = total del período = Σ montoFinalClp
 *
 * Si no cuadra, la tabla miente. Y una tabla de dinero que no cuadra es peor que
 * no tenerla: quien la revisa deja de confiar en el producto y se va a Excel,
 * que es exactamente lo que este patrón existe para evitar.
 */

let n = 0;
function linea(parcial: Partial<LineaCobro>): LineaCobro {
  const base = parcial.montoBaseClp ?? 2900;
  const ajuste = parcial.ajusteIncidenciaClp ?? 0;
  n += 1;
  return {
    id: `l${n}`,
    tenantId: 't1',
    sellerId: 's1',
    pedidoId: `p${n}`,
    periodoCobroidId: 'per1',
    tarifaId: 'tar1',
    montoBaseClp: base,
    ajusteIncidenciaClp: ajuste,
    montoFinalClp: base + ajuste,
    concepto: 'Entrega same-day · Ñuñoa',
    tipoPedido: 'same_day',
    ...parcial,
  } as LineaCobro;
}

const suma = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('agruparLineasCobro · la tabla tiene que cuadrar', () => {
  it('sin líneas devuelve todo en cero, no explota', () => {
    const r = agruparLineasCobro([]);
    expect(r.conceptos).toEqual([]);
    expect(r.subtotalEntregas).toBe(0);
    expect(r.total).toBe(0);
    expect(r.entregasTotales).toBe(0);
  });

  it('agrupa por concepto y cuenta las entregas de cada uno', () => {
    const r = agruparLineasCobro([
      linea({ concepto: 'Ñuñoa', montoBaseClp: 2900 }),
      linea({ concepto: 'Ñuñoa', montoBaseClp: 2900 }),
      linea({ concepto: 'Puente Alto', montoBaseClp: 3400 }),
    ]);
    expect(r.conceptos).toHaveLength(2);
    const nunoa = r.conceptos.find((c) => c.concepto === 'Ñuñoa')!;
    expect(nunoa.entregas).toBe(2);
    expect(nunoa.monto).toBe(5800);
    expect(nunoa.tarifa).toBe(2900);
  });

  it('ordena de mayor a menor monto: lo que mueve la aguja va primero', () => {
    const r = agruparLineasCobro([
      linea({ concepto: 'Chico', montoBaseClp: 1000 }),
      linea({ concepto: 'Grande', montoBaseClp: 9000 }),
      linea({ concepto: 'Medio', montoBaseClp: 5000 }),
    ]);
    expect(r.conceptos.map((c) => c.concepto)).toEqual(['Grande', 'Medio', 'Chico']);
  });

  it('no inventa una tarifa cuando las líneas del concepto no comparten monto base', () => {
    // Un promedio sería un número que no existe en ninguna línea y que no
    // reconstruye el subtotal.
    const r = agruparLineasCobro([
      linea({ concepto: 'Mixto', montoBaseClp: 2900 }),
      linea({ concepto: 'Mixto', montoBaseClp: 3400 }),
    ]);
    expect(r.conceptos[0].tarifa).toBeUndefined();
    expect(r.conceptos[0].monto).toBe(6300);
  });

  it('CUADRA: subtotal + ajustes = total, con ajustes negativos', () => {
    const lineas = [
      linea({ montoBaseClp: 2900 }),
      linea({ montoBaseClp: 2900, ajusteIncidenciaClp: -2900 }),
      linea({ montoBaseClp: 3400 }),
    ];
    const r = agruparLineasCobro(lineas);
    expect(r.subtotalEntregas + suma(r.ajustes.map((a) => a.monto))).toBe(r.total);
    expect(r.total).toBe(suma(lineas.map((l) => l.montoFinalClp)));
  });

  it('CUADRA con ajustes positivos y negativos mezclados', () => {
    const lineas = [
      linea({ montoBaseClp: 2900, ajusteIncidenciaClp: 1200 }),
      linea({ montoBaseClp: 2900, ajusteIncidenciaClp: -500 }),
      linea({ montoBaseClp: 3400 }),
      linea({ montoBaseClp: 3400, ajusteIncidenciaClp: -3400 }),
    ];
    const r = agruparLineasCobro(lineas);
    expect(r.subtotalEntregas).toBe(12600);
    expect(suma(r.ajustes.map((a) => a.monto))).toBe(-2700);
    expect(r.total).toBe(9900);
    expect(r.subtotalEntregas + suma(r.ajustes.map((a) => a.monto))).toBe(r.total);
  });

  it('CUADRA a escala, con 285 líneas y ajustes salteados', () => {
    // El tamaño del tablero. Un error de redondeo o un acumulador mal puesto se
    // ve acá y no con tres filas.
    const lineas: LineaCobro[] = [];
    for (let i = 0; i < 285; i += 1) {
      lineas.push(
        linea({
          concepto: i % 3 === 0 ? 'Ñuñoa' : i % 3 === 1 ? 'Puente Alto' : 'Maipú',
          montoBaseClp: 2900 + (i % 3) * 500,
          ajusteIncidenciaClp: i % 17 === 0 ? -1450 : 0,
        }),
      );
    }
    const r = agruparLineasCobro(lineas);
    expect(r.entregasTotales).toBe(285);
    expect(suma(r.conceptos.map((c) => c.monto))).toBe(r.subtotalEntregas);
    expect(r.subtotalEntregas + suma(r.ajustes.map((a) => a.monto))).toBe(r.total);
    expect(r.total).toBe(suma(lineas.map((l) => l.montoFinalClp)));
  });

  it('cada ajuste conserva el pedido que lo originó, para poder enlazarlo', () => {
    const r = agruparLineasCobro([
      linea({ montoBaseClp: 2900 }),
      linea({ pedidoId: 'ped-roto', montoBaseClp: 2900, ajusteIncidenciaClp: -2900 }),
    ]);
    expect(r.ajustes).toHaveLength(1);
    expect(r.ajustes[0].pedidoId).toBe('ped-roto');
  });

  it('una línea sin concepto no desaparece: cae en «Sin concepto»', () => {
    const r = agruparLineasCobro([linea({ concepto: '', montoBaseClp: 1000 })]);
    expect(r.conceptos[0].concepto).toBe('Sin concepto');
    expect(r.total).toBe(1000);
  });
});
