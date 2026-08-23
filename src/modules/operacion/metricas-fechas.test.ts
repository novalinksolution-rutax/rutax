/**
 * Regresión: los bordes de fecha del dashboard van en calendario de SANTIAGO.
 *
 * Estos tests existen porque el bug solo se manifiesta entre las 20:00 de
 * Santiago (21:00 en verano) y la medianoche: en esa franja UTC ya está en el
 * día siguiente. Con reloj de mediodía todo pasa igual con el código correcto
 * y con el roto, así que la única forma de demostrar el arreglo es fijar el
 * reloj dentro de la franja.
 *
 * En vez de simular la base, se CAPTURAN los filtros que el módulo le manda al
 * cliente: son exactamente lo que el bug corrompía, y afirmarlos no depende de
 * que el doble de prueba interprete bien la expresión de PostgREST.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { obtenerMetricasDelDia, obtenerSlaPorSeller } from './metricas';

const TENANT = '10000000-0000-0000-0000-000000000001';

/**
 * 2026-07-27T01:00:00Z — en Santiago (invierno, UTC−4) son las **21:00 del
 * 26 de julio**. El día civil chileno es el 26; el de UTC ya es el 27.
 */
const INSTANTE_21H_SANTIAGO = new Date('2026-07-27T01:00:00.000Z');
const DIA_SANTIAGO = '2026-07-26';

interface LlamadaCapturada {
  tabla: string;
  or: string[];
  eq: Array<[string, unknown]>;
  gte: Array<[string, unknown]>;
  lte: Array<[string, unknown]>;
  lt: Array<[string, unknown]>;
}

function crearClienteEspia(): { cliente: SupabaseClient; llamadas: LlamadaCapturada[] } {
  const llamadas: LlamadaCapturada[] = [];

  function fromImpl(tabla: string) {
    const registro: LlamadaCapturada = { tabla, or: [], eq: [], gte: [], lte: [], lt: [] };
    llamadas.push(registro);

    const chain = {
      eq: (campo: string, valor: unknown) => {
        registro.eq.push([campo, valor]);
        return chain;
      },
      in: () => chain,
      is: () => chain,
      not: () => chain,
      or: (expr: string) => {
        registro.or.push(expr);
        return chain;
      },
      gte: (campo: string, valor: unknown) => {
        registro.gte.push([campo, valor]);
        return chain;
      },
      lte: (campo: string, valor: unknown) => {
        registro.lte.push([campo, valor]);
        return chain;
      },
      lt: (campo: string, valor: unknown) => {
        registro.lt.push([campo, valor]);
        return chain;
      },
      // El espía devuelve siempre página vacía, así que `leerTodasLasFilas`
      // corta en la primera vuelta: acá `range` solo tiene que existir y
      // encadenar. Lo que este test mide son los BORDES DE FECHA, no el
      // paginado.
      order: () => chain,
      range: () => chain,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: (resolve: (r: { data: never[]; count: number; error: null }) => void) =>
        resolve({ data: [], count: 0, error: null }),
    };
    return { select: () => chain };
  }

  const cliente = {
    from: fromImpl,
    schema: () => ({ from: fromImpl }),
  } as unknown as SupabaseClient;

  return { cliente, llamadas };
}

describe('bordes de fecha a las 21:00 de Santiago', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(INSTANTE_21H_SANTIAGO);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('obtenerMetricasDelDia acota el día con los límites de Santiago, no de UTC', async () => {
    const { cliente, llamadas } = crearClienteEspia();

    await obtenerMetricasDelDia(cliente, TENANT, INSTANTE_21H_SANTIAGO);

    const consultaDia = llamadas.find((l) => l.or.length > 0);
    expect(consultaDia, 'se esperaba la consulta de pedidos del día').toBeDefined();
    const expresion = consultaDia!.or[0];

    // El día civil es el chileno (26), no el de UTC (27).
    expect(expresion).toContain(`fecha_compromiso.eq.${DIA_SANTIAGO}`);

    // Y la ventana sobre `creado_en` son los instantes de la medianoche
    // chilena: 04:00Z del 26 hasta 04:00Z del 27 (invierno, UTC−4).
    // El bug pegaba `2026-07-26T00:00:00.000Z`, cuatro horas antes, con lo que
    // entraban los pedidos de la noche del 25 y faltaban los del propio 26.
    expect(expresion).toContain('creado_en.gte.2026-07-26T04:00:00.000Z');
    expect(expresion).toContain('creado_en.lt.2026-07-27T04:00:00.000Z');

    // La ventana es semiabierta: nada de `23:59:59.999`, que perdía el último
    // milisegundo del día.
    expect(expresion).not.toContain('23:59:59');
  });

  it('obtenerMetricasDelDia mide "rezagados de ayer" contra el día anterior chileno', async () => {
    const { cliente, llamadas } = crearClienteEspia();

    await obtenerMetricasDelDia(cliente, TENANT, INSTANTE_21H_SANTIAGO);

    // El día anterior al 26 de julio chileno es el 25 — no el 26, que es lo
    // que daría restarle un día al "hoy" de UTC (el 27).
    const filtrosFechaCompromiso = llamadas
      .flatMap((l) => l.eq)
      .filter(([campo]) => campo === 'fecha_compromiso')
      .map(([, valor]) => valor);

    expect(filtrosFechaCompromiso).toContain('2026-07-25');
    expect(filtrosFechaCompromiso).not.toContain('2026-07-26');
  });

  it('obtenerSlaPorSeller con ventana "semana" cubre 7 días, no 6', async () => {
    const { cliente, llamadas } = crearClienteEspia();

    await obtenerSlaPorSeller(cliente, TENANT, INSTANTE_21H_SANTIAGO, 'semana');

    const consulta = llamadas.find((l) => l.gte.length > 0 && l.lte.length > 0);
    expect(consulta, 'se esperaba la consulta de SLA acotada por fecha').toBeDefined();

    const desde = consulta!.gte.find(([c]) => c === 'fecha_compromiso')?.[1];
    const hasta = consulta!.lte.find(([c]) => c === 'fecha_compromiso')?.[1];

    // 20 → 26 de julio son 7 días inclusive. El bug derivaba el extremo
    // inferior desde el "hoy" de UTC (el 27), dando el 21 y una ventana de 6.
    expect(hasta).toBe(DIA_SANTIAGO);
    expect(desde).toBe('2026-07-20');
  });

  it('obtenerSlaPorSeller con ventana "dia" usa el mismo día en ambos extremos', async () => {
    const { cliente, llamadas } = crearClienteEspia();

    await obtenerSlaPorSeller(cliente, TENANT, INSTANTE_21H_SANTIAGO, 'dia');

    const consulta = llamadas.find((l) => l.gte.length > 0 && l.lte.length > 0);
    const desde = consulta!.gte.find(([c]) => c === 'fecha_compromiso')?.[1];
    const hasta = consulta!.lte.find(([c]) => c === 'fecha_compromiso')?.[1];

    expect(desde).toBe(DIA_SANTIAGO);
    expect(hasta).toBe(DIA_SANTIAGO);
  });
});
