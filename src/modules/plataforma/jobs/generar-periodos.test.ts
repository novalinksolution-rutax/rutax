/**
 * Tests del job `plataforma/generarPeriodos` (F2, item J — facturación anual).
 *
 * Mismo patrón que `cobrar-periodo-auto.test.ts`: se prueba la lógica de
 * negocio PURA extraída del job (`calcularPeriodoSuscripcion`,
 * `aniversarioMasRecienteDesde`) sin runtime de Inngest ni BD.
 *
 * Cubre lo pedido:
 * - mensual: sin cambios de comportamiento (primer/último día del mes de "hoy").
 * - anual: genera EN el aniversario (mismo mes/día del ancla).
 * - anual: en meses intermedios devuelve el MISMO `periodo_inicio` que ya se
 *   generó (el UNIQUE (suscripcion_id, periodo_inicio) de BD hace el resto —
 *   el cron lo cuenta como "omitido").
 * - trial: monto 0 en ambas periodicidades.
 */

import { describe, it, expect } from 'vitest';
import { calcularPeriodoSuscripcion, aniversarioMasRecienteDesde } from './generar-periodos';

describe('aniversarioMasRecienteDesde', () => {
  it('el aniversario de este año ya ocurrió → lo devuelve', () => {
    expect(aniversarioMasRecienteDesde('2026-03-01', '2026-07-15')).toBe('2026-03-01');
  });

  it('el aniversario de este año TODAVÍA no ocurre → devuelve el del año anterior', () => {
    expect(aniversarioMasRecienteDesde('2026-09-01', '2026-07-15')).toBe('2025-09-01');
  });

  it('hoy es exactamente el día del aniversario → lo devuelve (inclusive)', () => {
    expect(aniversarioMasRecienteDesde('2026-03-01', '2026-03-01')).toBe('2026-03-01');
  });

  it('mes intermedio: el mismo mes/año siguen dando el MISMO periodo_inicio (para que el cron lo omita)', () => {
    const marzo = aniversarioMasRecienteDesde('2026-03-01', '2026-03-01');
    const abril = aniversarioMasRecienteDesde('2026-03-01', '2026-04-01');
    const mayo = aniversarioMasRecienteDesde('2026-03-01', '2026-05-01');
    expect(abril).toBe(marzo);
    expect(mayo).toBe(marzo);
  });

  it('ancla en 29-feb (bisiesto) sobre un año NO bisiesto: clampa al 28-feb', () => {
    expect(aniversarioMasRecienteDesde('2024-02-29', '2026-02-28')).toBe('2026-02-28');
  });
});

describe('calcularPeriodoSuscripcion — mensual (sin cambios de comportamiento)', () => {
  it('activa: primer/último día del mes de "hoy", monto = precio mensual del plan', () => {
    const r = calcularPeriodoSuscripcion({
      estado: 'activa',
      periodicidad: 'mensual',
      precioMensualClp: 19990,
      precioAnualClp: 199900,
      fechaAncla: '2020-01-01',
      hoy: '2026-07-15',
    });
    expect(r).toEqual({
      periodoInicio: '2026-07-01',
      periodoFin: '2026-07-31',
      montoClp: 19990,
      venceEn: '2026-08-05',
    });
  });

  it('trial: mismos límites de período, monto 0', () => {
    const r = calcularPeriodoSuscripcion({
      estado: 'trial',
      periodicidad: 'mensual',
      precioMensualClp: 19990,
      precioAnualClp: 199900,
      fechaAncla: '2020-01-01',
      hoy: '2026-07-15',
    });
    expect(r.montoClp).toBe(0);
    expect(r.periodoInicio).toBe('2026-07-01');
    expect(r.periodoFin).toBe('2026-07-31');
  });

  it('cruce de año: diciembre vence en enero del año siguiente', () => {
    const r = calcularPeriodoSuscripcion({
      estado: 'activa',
      periodicidad: 'mensual',
      precioMensualClp: 19990,
      precioAnualClp: 199900,
      fechaAncla: '2020-01-01',
      hoy: '2026-12-15',
    });
    expect(r.periodoInicio).toBe('2026-12-01');
    expect(r.periodoFin).toBe('2026-12-31');
    expect(r.venceEn).toBe('2027-01-05');
  });

  it('febrero de año no bisiesto: último día = 28', () => {
    const r = calcularPeriodoSuscripcion({
      estado: 'activa',
      periodicidad: 'mensual',
      precioMensualClp: 19990,
      precioAnualClp: 199900,
      fechaAncla: '2020-01-01',
      hoy: '2026-02-10',
    });
    expect(r.periodoFin).toBe('2026-02-28');
  });
});

describe('calcularPeriodoSuscripcion — anual (F2, item J)', () => {
  it('genera EN el aniversario: ciclo de un año completo, monto = precio anual del plan', () => {
    const r = calcularPeriodoSuscripcion({
      estado: 'activa',
      periodicidad: 'anual',
      precioMensualClp: 19990,
      precioAnualClp: 199900,
      fechaAncla: '2026-03-01',
      hoy: '2026-03-01', // el cron corre el día 1 de cada mes — coincide con el aniversario
    });
    expect(r).toEqual({
      periodoInicio: '2026-03-01',
      periodoFin: '2027-02-28',
      montoClp: 199900,
      venceEn: '2027-03-05',
    });
  });

  it('skip en meses intermedios: devuelve el MISMO periodo_inicio que ya se generó en el aniversario', () => {
    const enAniversario = calcularPeriodoSuscripcion({
      estado: 'activa',
      periodicidad: 'anual',
      precioMensualClp: 19990,
      precioAnualClp: 199900,
      fechaAncla: '2026-03-01',
      hoy: '2026-03-01',
    });
    const mesIntermedio = calcularPeriodoSuscripcion({
      estado: 'activa',
      periodicidad: 'anual',
      precioMensualClp: 19990,
      precioAnualClp: 199900,
      fechaAncla: '2026-03-01',
      hoy: '2026-07-01', // 4 meses después, MISMO ciclo vigente
    });
    // Mismo periodo_inicio → el UNIQUE(suscripcion_id, periodo_inicio) de BD
    // hace que el segundo INSERT sea ignorado (el cron lo cuenta "omitido").
    expect(mesIntermedio.periodoInicio).toBe(enAniversario.periodoInicio);
  });

  it('trial anual: mismos límites de ciclo, monto 0', () => {
    const r = calcularPeriodoSuscripcion({
      estado: 'trial',
      periodicidad: 'anual',
      precioMensualClp: 19990,
      precioAnualClp: 199900,
      fechaAncla: '2026-03-01',
      hoy: '2026-03-01',
    });
    expect(r.montoClp).toBe(0);
    expect(r.periodoInicio).toBe('2026-03-01');
  });

  it('cruza un año bisiesto: el ciclo incluye el 29 de febrero', () => {
    const r = calcularPeriodoSuscripcion({
      estado: 'activa',
      periodicidad: 'anual',
      precioMensualClp: 19990,
      precioAnualClp: 199900,
      fechaAncla: '2028-01-01',
      hoy: '2028-01-01', // 2028 es bisiesto
    });
    expect(r.periodoInicio).toBe('2028-01-01');
    expect(r.periodoFin).toBe('2028-12-31');
  });
});
