/**
 * Pruebas del cálculo determinístico de la restricción vehicular GEC.
 * =====================================================================
 *
 * Función pura: sin red, sin reloj, sin entorno. Los casos salen del Plan
 * Operacional GEC 2026 del MMA (Cuadros 13, 14 y 15) — ver la cita completa en
 * `restriccion-gec.ts`.
 *
 * Fechas de referencia usadas (calendario 2026, verificadas):
 *   lun 2026-05-04 · mar 2026-05-05 · mié 2026-05-06 · jue 2026-05-07 ·
 *   vie 2026-05-08 · sáb 2026-05-09 · dom 2026-05-10
 *   vie 2026-05-01 (feriado irrenunciable, Día del Trabajo)
 *   lun 2026-08-31 (último día de temporada) · mar 2026-09-01 (fuera)
 */

import { describe, it, expect } from 'vitest';
import {
  calcularRestriccionPermanente,
  calcularRestriccionesEnRango,
  diaDeLaSemana,
  estaEnTemporadaGEC,
} from './restriccion-gec';

describe('diaDeLaSemana — sin drift de zona horaria', () => {
  it('resuelve el día correcto para fechas civiles conocidas de 2026', () => {
    expect(diaDeLaSemana('2026-05-01')).toBe(5); // viernes
    expect(diaDeLaSemana('2026-05-04')).toBe(1); // lunes
    expect(diaDeLaSemana('2026-05-09')).toBe(6); // sábado
    expect(diaDeLaSemana('2026-05-10')).toBe(0); // domingo
  });

  it('rechaza un formato que no sea YYYY-MM-DD', () => {
    expect(() => diaDeLaSemana('04-05-2026')).toThrow(RangeError);
    expect(() => diaDeLaSemana('2026-5-4')).toThrow(RangeError);
  });
});

describe('calendario semanal de dígitos (Cuadros 13, 14 y 15)', () => {
  const casos: Array<[string, string, number[], number[]]> = [
    ['lunes', '2026-05-04', [8, 9], [6, 7, 8, 9]],
    ['martes', '2026-05-05', [0, 1], [0, 1, 2, 3]],
    ['miércoles', '2026-05-06', [2, 3], [4, 5, 6, 7]],
    ['jueves', '2026-05-07', [4, 5], [8, 9, 0, 1]],
    ['viernes', '2026-05-08', [6, 7], [2, 3, 4, 5]],
  ];

  it.each(casos)(
    '%s → con sello verde %j, sin sello verde %j',
    (_nombre, fecha, conSello, sinSello) => {
      const r = calcularRestriccionPermanente(fecha);
      expect(r).not.toBeNull();

      // `digitos` es el calendario de 2 dígitos: es el que guarda
      // contexto.restriccion_vehicular y el que muestra el contrato congelado.
      expect(r!.digitos).toEqual(conSello);
      expect(r!.tipo).toBe('permanente');
      expect(r!.fecha).toBe(fecha);

      const carga = r!.detallePorTipologia.find(
        (t) => t.tipologia === 'carga_sin_sello_verde',
      );
      expect(carga!.digitos).toEqual(sinSello);
      // Horario propio del transporte de carga, distinto del de autos.
      expect(carga!.desde).toBe('10:00');
      expect(carga!.hasta).toBe('18:00');
    },
  );

  it('los autos con sello verde restringen entre 07:30 y 21:00', () => {
    const r = calcularRestriccionPermanente('2026-05-04')!;
    const auto = r.detallePorTipologia.find(
      (t) => t.tipologia === 'auto_con_sello_verde',
    )!;
    expect(auto.desde).toBe('07:30');
    expect(auto.hasta).toBe('21:00');
    expect(auto.alcance).toContain('Provincia de Santiago');
  });
});

describe('fin de semana — no hay restricción permanente', () => {
  it('sábado devuelve null', () => {
    expect(calcularRestriccionPermanente('2026-05-09')).toBeNull();
  });

  it('domingo devuelve null', () => {
    expect(calcularRestriccionPermanente('2026-05-10')).toBeNull();
  });
});

describe('borde de la temporada GEC (1 de mayo – 31 de agosto)', () => {
  it('el 30 de abril está fuera: no hay restricción aunque sea jueves', () => {
    expect(diaDeLaSemana('2026-04-30')).toBe(4);
    expect(estaEnTemporadaGEC('2026-04-30')).toBe(false);
    expect(calcularRestriccionPermanente('2026-04-30')).toBeNull();
  });

  it('el 1 de mayo está DENTRO de la temporada, pero es feriado irrenunciable', () => {
    expect(estaEnTemporadaGEC('2026-05-01')).toBe(true);
    // Sin feriados a la vista, la función no puede saberlo y lo declara.
    const sinFeriados = calcularRestriccionPermanente('2026-05-01');
    expect(sinFeriados).not.toBeNull();
    expect(sinFeriados!.feriadosConsiderados).toBe(false);

    // Con el calendario cargado, el 1 de mayo no restringe.
    const conFeriados = calcularRestriccionPermanente('2026-05-01', {
      feriados: new Set(['2026-05-01']),
    });
    expect(conFeriados).toBeNull();
  });

  it('el 4 de mayo es el primer día hábil en que el calendario de dígitos muerde', () => {
    const feriados = new Set(['2026-05-01']);
    // 1 (feriado), 2 (sáb) y 3 (dom) no restringen; el 4 sí.
    expect(calcularRestriccionPermanente('2026-05-01', { feriados })).toBeNull();
    expect(calcularRestriccionPermanente('2026-05-02', { feriados })).toBeNull();
    expect(calcularRestriccionPermanente('2026-05-03', { feriados })).toBeNull();

    const lunes4 = calcularRestriccionPermanente('2026-05-04', { feriados });
    expect(lunes4).not.toBeNull();
    expect(lunes4!.digitos).toEqual([8, 9]);
    expect(lunes4!.feriadosConsiderados).toBe(true);
  });

  it('el 31 de agosto es el último día de temporada; el 1 de septiembre ya no', () => {
    expect(estaEnTemporadaGEC('2026-08-31')).toBe(true);
    expect(calcularRestriccionPermanente('2026-08-31')).not.toBeNull();

    expect(estaEnTemporadaGEC('2026-09-01')).toBe(false);
    // Martes, pero fuera de temporada: no hay restricción permanente.
    expect(diaDeLaSemana('2026-09-01')).toBe(2);
    expect(calcularRestriccionPermanente('2026-09-01')).toBeNull();
  });

  it('en octubre no hay restricción permanente ningún día hábil', () => {
    // El error clásico de implementar solo "día de la semana → dígitos".
    for (const fecha of ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']) {
      expect(calcularRestriccionPermanente(fecha)).toBeNull();
    }
  });
});

describe('feriados dentro de la temporada', () => {
  it('el 21 de mayo (Glorias Navales, jueves) no restringe si está en el conjunto', () => {
    expect(diaDeLaSemana('2026-05-21')).toBe(4);
    expect(calcularRestriccionPermanente('2026-05-21')).not.toBeNull();
    expect(
      calcularRestriccionPermanente('2026-05-21', {
        feriados: new Set(['2026-05-21']),
      }),
    ).toBeNull();
  });
});

describe('el modelo no guarda patentes', () => {
  it('vehiculosAfectados es siempre null, nunca un número inventado', () => {
    const r = calcularRestriccionPermanente('2026-06-10')!;
    expect(r.vehiculosAfectados).toBeNull();
  });
});

describe('determinismo', () => {
  it('la misma fecha produce exactamente el mismo resultado', () => {
    const a = calcularRestriccionPermanente('2026-07-15');
    const b = calcularRestriccionPermanente('2026-07-15');
    expect(a).toEqual(b);
  });
});

describe('calcularRestriccionesEnRango', () => {
  it('una semana completa devuelve solo los 5 días hábiles', () => {
    const r = calcularRestriccionesEnRango('2026-05-04', '2026-05-10');
    expect(r.map((x) => x.fecha)).toEqual([
      '2026-05-04',
      '2026-05-05',
      '2026-05-06',
      '2026-05-07',
      '2026-05-08',
    ]);
  });

  it('un rango que cruza el fin de temporada corta el 31 de agosto', () => {
    const r = calcularRestriccionesEnRango('2026-08-28', '2026-09-04');
    expect(r.map((x) => x.fecha)).toEqual(['2026-08-28', '2026-08-31']);
  });

  it('un rango invertido devuelve vacío en vez de lanzar', () => {
    expect(calcularRestriccionesEnRango('2026-06-10', '2026-06-01')).toEqual([]);
  });

  it('un rango fuera de temporada devuelve vacío', () => {
    expect(calcularRestriccionesEnRango('2026-01-05', '2026-01-30')).toEqual([]);
  });
});
