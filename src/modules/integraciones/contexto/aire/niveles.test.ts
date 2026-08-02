/**
 * Pruebas del mapeo PM2.5 → nivel de episodio.
 * =====================================================================
 *
 * Los cortes salen del Cuadro 1 del Plan Operacional GEC 2026 (MMA):
 *   MP2,5 24 h → Alerta 80-109 · Preemergencia 110-169 · Emergencia ≥170.
 * Y el corte 'bueno'/'regular' de la norma primaria diaria del D.S. 12/2011
 * (50 µg/m³N en 24 h). Ver la cita completa en `niveles.ts`.
 *
 * Se prueban los BORDES exactos, que es donde un umbral mal puesto se nota:
 * 79 no es alerta, 80 sí; 109 sigue siendo alerta, 110 ya es preemergencia.
 */

import { describe, it, expect } from 'vitest';
import {
  clasificarSerie,
  nivelDesdePm25Media24h,
  nivelMasSevero,
  promedioMovil,
  UMBRALES_PM25,
} from './niveles';

describe('nivelDesdePm25Media24h — bordes exactos del Cuadro 1', () => {
  const casos: Array<[number, string]> = [
    [0, 'bueno'],
    [49.9, 'bueno'],
    [50, 'regular'],
    [79, 'regular'],
    [79.9, 'regular'],
    [80, 'alerta'],
    [95, 'alerta'],
    [109, 'alerta'],
    [109.9, 'alerta'],
    [110, 'preemergencia'],
    [140, 'preemergencia'],
    [169, 'preemergencia'],
    [169.9, 'preemergencia'],
    [170, 'emergencia'],
    [400, 'emergencia'],
  ];

  it.each(casos)('%d µg/m³ (media 24 h) → %s', (valor, esperado) => {
    expect(nivelDesdePm25Media24h(valor)).toBe(esperado);
  });

  it('los umbrales publicados son los del Cuadro 1', () => {
    expect(UMBRALES_PM25.alerta).toBe(80);
    expect(UMBRALES_PM25.preemergencia).toBe(110);
    expect(UMBRALES_PM25.emergencia).toBe(170);
    // Criterio de producto anclado en la norma primaria diaria.
    expect(UMBRALES_PM25.regular).toBe(50);
  });

  it('valores absurdos no producen una alerta: caen a bueno', () => {
    expect(nivelDesdePm25Media24h(-5)).toBe('bueno');
    expect(nivelDesdePm25Media24h(Number.NaN)).toBe('bueno');
    expect(nivelDesdePm25Media24h(Number.POSITIVE_INFINITY)).toBe('bueno');
  });
});

describe('promedioMovil — el estadístico que exige la norma', () => {
  it('promedia las últimas N horas terminando en cada índice', () => {
    expect(promedioMovil([10, 20, 30, 40], 2)).toEqual([10, 15, 25, 35]);
  });

  it('con ventana mayor que la serie usa lo disponible', () => {
    expect(promedioMovil([10, 30], 24)).toEqual([10, 20]);
  });

  it('ignora los null en vez de contarlos como cero', () => {
    // Contar el null como 0 daría [10, 5, 20/3] y podría silenciar un episodio.
    expect(promedioMovil([10, null, 30], 3)).toEqual([10, 10, 20]);
  });

  it('una ventana enteramente nula da null, no cero', () => {
    expect(promedioMovil([null, null], 2)).toEqual([null, null]);
  });

  it('rechaza ventanas inválidas', () => {
    expect(() => promedioMovil([1, 2], 0)).toThrow(RangeError);
  });
});

describe('clasificarSerie — por qué NO se clasifica la hora suelta', () => {
  it('un peak horario aislado NO gatilla preemergencia', () => {
    // Caso real de Santiago: la primera hora del 2026-07-26 midió 97,3 µg/m³
    // mientras el resto del día estaba bajo. Clasificar la hora suelta contra
    // el umbral de 80 declararía alerta; el promedio móvil de 24 h no.
    const serie = [97.3, 30, 25, 20, 18, 15, 14, 13, 12, 12, 11, 11];
    const r = clasificarSerie(serie, 24);

    expect(r[0].nivel).toBe('alerta'); // primera hora: la ventana es esa hora
    // Pero al llenarse la ventana el nivel baja: el episodio no era real.
    expect(r[r.length - 1].media24h!).toBeLessThan(30);
    expect(r[r.length - 1].nivel).toBe('bueno');
  });

  it('una serie sostenidamente alta SÍ llega a preemergencia', () => {
    const serie = new Array<number>(24).fill(130);
    const r = clasificarSerie(serie, 24);
    expect(r[23].media24h).toBe(130);
    expect(r[23].nivel).toBe('preemergencia');
  });

  it('devuelve un elemento por hora, en el mismo orden', () => {
    const serie = [10, 20, 30];
    expect(clasificarSerie(serie, 24)).toHaveLength(3);
  });

  it('sin dato en toda la ventana el nivel cae a bueno y media24h queda null', () => {
    const r = clasificarSerie([null, null], 24);
    expect(r[0]).toEqual({ media24h: null, nivel: 'bueno' });
    expect(r[1]).toEqual({ media24h: null, nivel: 'bueno' });
  });
});

describe('nivelMasSevero — agregación horas → día', () => {
  it('elige el más severo de los dos', () => {
    expect(nivelMasSevero('bueno', 'alerta')).toBe('alerta');
    expect(nivelMasSevero('emergencia', 'preemergencia')).toBe('emergencia');
    expect(nivelMasSevero('regular', 'regular')).toBe('regular');
  });
});
