/**
 * Tests del predicado de staleness del watchdog de salud (QW3).
 *
 * Se prueba `motivoCronSinSalud` — la regla que decide si un cron vigilado está
 * sin salud — sin BD ni Inngest. Verifica que NO alerta en el arranque (sin
 * telemetría), que alerta ante fallo del último run, y que respeta el umbral.
 */

import { describe, it, expect } from 'vitest';
import { motivoCronSinSalud, corresponderVigilar } from './verificar-salud';

const AHORA = Date.parse('2026-07-09T12:00:00Z');
const haceHoras = (h: number) => new Date(AHORA - h * 3_600_000).toISOString();

describe('motivoCronSinSalud', () => {
  it('sin telemetría (fila undefined) → null (no alertar en el arranque)', () => {
    expect(motivoCronSinSalud(undefined, 27, AHORA)).toBeNull();
  });

  it('último run en error → alerta con el motivo del fallo', () => {
    const motivo = motivoCronSinSalud(
      { estado: 'error', error: 'timeout de BD', ultimo_ok_en: haceHoras(1) },
      27,
      AHORA,
    );
    expect(motivo).toContain('falló');
    expect(motivo).toContain('timeout de BD');
  });

  it('último éxito dentro del umbral → sano (null)', () => {
    expect(
      motivoCronSinSalud({ estado: 'ok', error: null, ultimo_ok_en: haceHoras(20) }, 27, AHORA),
    ).toBeNull();
  });

  it('último éxito fuera del umbral → alerta de staleness', () => {
    const motivo = motivoCronSinSalud(
      { estado: 'ok', error: null, ultimo_ok_en: haceHoras(30) },
      27,
      AHORA,
    );
    expect(motivo).toContain('sin ejecución exitosa');
    expect(motivo).toContain('máx 27h');
  });

  it('nunca tuvo un éxito (ultimo_ok_en null) pero último run no es error → null', () => {
    // Caso borde: un run en curso o recién empezado; no se alerta por staleness.
    expect(
      motivoCronSinSalud({ estado: 'ejecutando', error: null, ultimo_ok_en: null }, 2, AHORA),
    ).toBeNull();
  });
});

describe("corresponderVigilar — el descanso nocturno no es un cron muerto", () => {
  const ventana = { desde: 6, hasta: 22 };

  it("un cron sin horario se vigila siempre", () => {
    expect(corresponderVigilar(undefined, 2, 3)).toBe(true);
  });

  it("de madrugada NO se vigila: es el descanso (la falsa alarma del 21-sep)", () => {
    expect(corresponderVigilar(ventana, 2, 3)).toBe(false);
    expect(corresponderVigilar(ventana, 2, 23)).toBe(false);
  });

  it("a las 6 recién arranca: se espera a que haya tenido tiempo de correr", () => {
    expect(corresponderVigilar(ventana, 2, 6)).toBe(false);
    expect(corresponderVigilar(ventana, 2, 7)).toBe(false);
  });

  it("contraprueba: dentro del horario SÍ se vigila, o la red no detectaría nada", () => {
    expect(corresponderVigilar(ventana, 2, 8)).toBe(true);
    expect(corresponderVigilar(ventana, 2, 15)).toBe(true);
    expect(corresponderVigilar(ventana, 2, 22)).toBe(true);
  });
});
