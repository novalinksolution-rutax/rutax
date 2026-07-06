/**
 * Tests de fecha-santiago.ts — utilidades de TZ America/Santiago.
 *
 * Chile tiene DST: en verano (noviembre–marzo) usa CLST (UTC-3),
 * en invierno (abril–octubre) usa CLT (UTC-4).
 * Casos límite cubiertos:
 *   - Hora justo en el corte
 *   - Cambio de día (23:59 → 00:00)
 *   - Horario de verano chileno
 *   - Horario de invierno chileno
 *   - Round-trip: combinar → descomponer da el mismo valor
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ahoraEnSantiago,
  combinarFechaHoraSantiago,
  fechaLocalEnSantiago,
  horaAMinutos,
} from './fecha-santiago';

// ---------------------------------------------------------------------------
// Helpers de test
// ---------------------------------------------------------------------------

/** Offset en minutos del instante dado respecto a UTC (positivo = atrás de UTC). */
function offsetUtcEnMinutos(instante: Date): number {
  // Leer componentes locales de Santiago para calcular el offset real.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const partes = Object.fromEntries(fmt.formatToParts(instante).map((p) => [p.type, p.value]));
  const localMs = Date.UTC(
    Number(partes.year),
    Number(partes.month) - 1,
    Number(partes.day),
    Number(partes.hour),
    Number(partes.minute),
    Number(partes.second),
  );
  return (localMs - instante.getTime()) / 60_000;
}

// ---------------------------------------------------------------------------
// combinarFechaHoraSantiago
// ---------------------------------------------------------------------------

describe('combinarFechaHoraSantiago', () => {
  it('invierno chileno (CLT, UTC-4): "2026-07-15" + "14:30" da las 18:30 UTC', () => {
    // Chile winter: UTC-4 (CLST termina abril, CLT hasta octubre aprox.)
    const instante = combinarFechaHoraSantiago('2026-07-15', '14:30');
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Santiago',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const horaLocal = fmt.format(instante);
    expect(horaLocal).toBe('14:30');
  });

  it('verano chileno (CLST, UTC-3): "2026-01-20" + "10:00" da las 13:00 UTC', () => {
    // Chile summer: UTC-3
    const instante = combinarFechaHoraSantiago('2026-01-20', '10:00');
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Santiago',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const horaLocal = fmt.format(instante);
    expect(horaLocal).toBe('10:00');
  });

  it('hora justo en el corte: "2026-06-19" + "13:00" produce instante cuya hora local = 13:00', () => {
    const instante = combinarFechaHoraSantiago('2026-06-19', '13:00');
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Santiago',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    expect(fmt.format(instante)).toBe('13:00');
  });

  it('cambio de día: "2026-06-30" + "23:59" produce instante cuya hora local = 23:59 del mismo día', () => {
    const instante = combinarFechaHoraSantiago('2026-06-30', '23:59');
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Santiago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const str = fmt.format(instante);
    expect(str).toContain('2026-06-30');
    expect(str).toContain('23:59');
  });

  it('medianoche: "2026-07-01" + "00:00" produce hora local 00:00', () => {
    const instante = combinarFechaHoraSantiago('2026-07-01', '00:00');
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Santiago',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    expect(fmt.format(instante)).toBe('00:00');
  });

  it('formato HH:MM:SS también se acepta', () => {
    const instante = combinarFechaHoraSantiago('2026-06-19', '10:30:00');
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Santiago',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    expect(fmt.format(instante)).toBe('10:30');
  });

  it('lanza RangeError para fecha con formato inválido', () => {
    expect(() => combinarFechaHoraSantiago('2026/06/19', '10:00')).toThrow(RangeError);
    expect(() => combinarFechaHoraSantiago('20260619', '10:00')).toThrow(RangeError);
  });

  it('lanza RangeError para hora con formato inválido', () => {
    expect(() => combinarFechaHoraSantiago('2026-06-19', '10')).toThrow(RangeError);
    expect(() => combinarFechaHoraSantiago('2026-06-19', '1000')).toThrow(RangeError);
  });

  it('round-trip: combinar luego fechaLocalEnSantiago devuelve la fecha original', () => {
    const instante = combinarFechaHoraSantiago('2026-06-19', '09:00');
    expect(fechaLocalEnSantiago(instante)).toBe('2026-06-19');
  });

  it('offset de invierno chileno es -240 minutos (UTC-4)', () => {
    // Julio es CLT (invierno).
    const instante = combinarFechaHoraSantiago('2026-07-15', '12:00');
    // La hora UTC = 12:00 + 4h = 16:00
    expect(instante.getUTCHours()).toBe(16);
  });

  it('offset de verano chileno es -180 minutos (UTC-3)', () => {
    // Enero es CLST (verano).
    const instante = combinarFechaHoraSantiago('2026-01-15', '12:00');
    // La hora UTC = 12:00 + 3h = 15:00
    expect(instante.getUTCHours()).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// ahoraEnSantiago
// ---------------------------------------------------------------------------

describe('ahoraEnSantiago', () => {
  beforeEach(() => {
    // Fijar el reloj en una fecha conocida (invierno, UTC 2026-07-10T17:00:00Z = 13:00 Santiago CLT)
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T17:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('devuelve fecha en formato YYYY-MM-DD', () => {
    const { fecha } = ahoraEnSantiago();
    expect(fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(fecha).toBe('2026-07-10');
  });

  it('devuelve hora en formato HH:MM en Santiago (invierno: UTC-4 → 17:00 UTC = 13:00 local)', () => {
    const { hora } = ahoraEnSantiago();
    expect(hora).toMatch(/^\d{2}:\d{2}$/);
    expect(hora).toBe('13:00');
  });

  it('instante coincide con new Date() fijado', () => {
    const { instante } = ahoraEnSantiago();
    expect(instante.getTime()).toBe(new Date('2026-07-10T17:00:00.000Z').getTime());
  });
});

// ---------------------------------------------------------------------------
// fechaLocalEnSantiago
// ---------------------------------------------------------------------------

describe('fechaLocalEnSantiago', () => {
  it('justo antes de medianoche UTC que sigue siendo el mismo día en Santiago', () => {
    // 23:30 UTC del 14 julio = 19:30 CLT (UTC-4) = mismo día 14
    const instante = new Date('2026-07-14T23:30:00.000Z');
    expect(fechaLocalEnSantiago(instante)).toBe('2026-07-14');
  });

  it('fecha correcta cuando UTC avanzó al día siguiente pero Santiago aún no', () => {
    // 03:00 UTC del 15 = 23:00 CLT del 14 (UTC-4)
    const instante = new Date('2026-07-15T03:00:00.000Z');
    expect(fechaLocalEnSantiago(instante)).toBe('2026-07-14');
  });
});

// ---------------------------------------------------------------------------
// horaAMinutos
// ---------------------------------------------------------------------------

describe('horaAMinutos', () => {
  it('convierte "13:00" a 780 minutos', () => {
    expect(horaAMinutos('13:00')).toBe(780);
  });

  it('convierte "00:00" a 0', () => {
    expect(horaAMinutos('00:00')).toBe(0);
  });

  it('convierte "23:59" a 1439', () => {
    expect(horaAMinutos('23:59')).toBe(1439);
  });
});
