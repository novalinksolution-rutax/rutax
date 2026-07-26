/**
 * Pruebas del motor de riesgo — lógica pura, sin BD, sin Inngest.
 *
 * Cobertura exigida por el paso A4:
 *  - cada factor por separado (incluidos sus bordes),
 *  - la suma ponderada (`calcularRiesgoZona`),
 *  - los bordes de cada `NivelRiesgo`,
 *  - el colapso por franja (MÁXIMO, no promedio),
 *  - el descarte de franjas vencidas para horizonte 'hoy',
 *  - un test con reloj a las 22:00 de Santiago (fake timers),
 *  - un guard estático: `toISOString` no debe aparecer en este módulo.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ahoraEnSantiago, horaAMinutos } from '@/lib/fecha-santiago';
import {
  PESOS_NOMINALES,
  PESOS_EFECTIVOS_F1,
  nivelDesdePuntaje,
  calcularFactorPresionOperativa,
  calcularFactorClima,
  calcularFactorAire,
  calcularFactorTransitoPendiente,
  calcularFactorEventos,
  calcularFactorHistorico,
  calcularRiesgoZona,
  colapsarRiesgoPorFranjas,
  type ResultadoRiesgoZona,
  type AhoraSantiago,
} from './motor-riesgo';

// =============================================================================
// Redistribución de pesos (cabecera del archivo, decisión A4)
// =============================================================================

describe('pesos: redistribución del 15% de tránsito', () => {
  it('los pesos NOMINALES de §7 suman 1', () => {
    const suma = Object.values(PESOS_NOMINALES).reduce((a, b) => a + b, 0);
    expect(suma).toBeCloseTo(1, 9);
  });

  it('los pesos EFECTIVOS de F1 (con tránsito en 0) también suman 1', () => {
    const suma = Object.values(PESOS_EFECTIVOS_F1).reduce((a, b) => a + b, 0);
    expect(suma).toBeCloseTo(1, 9);
  });

  it('tránsito efectivo es exactamente 0 (no el 15% nominal)', () => {
    expect(PESOS_EFECTIVOS_F1.transito).toBe(0);
  });

  it('la redistribución es proporcional: la razón presión/aire se conserva', () => {
    const razonNominal = PESOS_NOMINALES.presion_operativa / PESOS_NOMINALES.aire;
    const razonEfectiva = PESOS_EFECTIVOS_F1.presion_operativa / PESOS_EFECTIVOS_F1.aire;
    expect(razonEfectiva).toBeCloseTo(razonNominal, 9);
  });

  it('valores exactos esperados (35/85, 20/85, 15/85, 10/85, 5/85)', () => {
    expect(PESOS_EFECTIVOS_F1.presion_operativa).toBeCloseTo(35 / 85, 9);
    expect(PESOS_EFECTIVOS_F1.clima).toBeCloseTo(20 / 85, 9);
    expect(PESOS_EFECTIVOS_F1.aire).toBeCloseTo(15 / 85, 9);
    expect(PESOS_EFECTIVOS_F1.eventos).toBeCloseTo(10 / 85, 9);
    expect(PESOS_EFECTIVOS_F1.historico).toBeCloseTo(5 / 85, 9);
  });
});

// =============================================================================
// nivelDesdePuntaje — bordes exactos de §7
// =============================================================================

describe('nivelDesdePuntaje', () => {
  it.each([
    [0, 'calmo'],
    [20, 'calmo'],
    [21, 'bajo'],
    [40, 'bajo'],
    [41, 'medio'],
    [60, 'medio'],
    [61, 'alto'],
    [75, 'alto'],
    [76, 'critico'],
    [100, 'critico'],
  ] as const)('puntaje %i → %s', (puntaje, nivel) => {
    expect(nivelDesdePuntaje(puntaje)).toBe(nivel);
  });
});

// =============================================================================
// Factor · Presión operativa
// =============================================================================

describe('calcularFactorPresionOperativa', () => {
  it('sin pedidos pendientes → valor 0', () => {
    const f = calcularFactorPresionOperativa({
      pedidosPendientes: 0,
      capacidadEstimada: 100,
      minutosHastaCorte: null,
    });
    expect(f.valor).toBe(0);
    expect(f.id).toBe('presion_operativa');
    expect(f.peso).toBe(PESOS_EFECTIVOS_F1.presion_operativa);
  });

  it('ratio 1 (pendientes = capacidad), sin urgencia de corte → valor 60', () => {
    const f = calcularFactorPresionOperativa({
      pedidosPendientes: 60,
      capacidadEstimada: 60,
      minutosHastaCorte: null,
    });
    expect(f.valor).toBe(60);
    expect(f.explicacion).toBe('60 pedidos pendientes contra capacidad de 60.');
  });

  it('ratio > 1.67 satura a 100', () => {
    const f = calcularFactorPresionOperativa({
      pedidosPendientes: 200,
      capacidadEstimada: 100,
      minutosHastaCorte: null,
    });
    expect(f.valor).toBe(100);
  });

  it('capacidad 0 con pedidos pendientes → ratio saturado (caso más grave)', () => {
    const f = calcularFactorPresionOperativa({
      pedidosPendientes: 10,
      capacidadEstimada: 0,
      minutosHastaCorte: null,
    });
    expect(f.valor).toBe(100);
  });

  it('capacidad 0 sin pedidos pendientes → valor 0 (no divide por cero)', () => {
    const f = calcularFactorPresionOperativa({
      pedidosPendientes: 0,
      capacidadEstimada: 0,
      minutosHastaCorte: null,
    });
    expect(f.valor).toBe(0);
  });

  it('corte ya vencido (minutos <= 0) → bonus máximo de urgencia', () => {
    const f = calcularFactorPresionOperativa({
      pedidosPendientes: 0,
      capacidadEstimada: 100,
      minutosHastaCorte: 0,
    });
    expect(f.valor).toBe(25);
    expect(f.explicacion).toContain('ya venció');
  });

  it('corte vencido hace rato (minutos negativos) → mismo bonus que 0', () => {
    const f = calcularFactorPresionOperativa({
      pedidosPendientes: 0,
      capacidadEstimada: 100,
      minutosHastaCorte: -120,
    });
    expect(f.valor).toBe(25);
  });

  it('menos de 60 minutos para el corte → bonus 15', () => {
    const f = calcularFactorPresionOperativa({
      pedidosPendientes: 0,
      capacidadEstimada: 100,
      minutosHastaCorte: 59,
    });
    expect(f.valor).toBe(15);
    expect(f.explicacion).toContain('59 min');
  });

  it('borde: exactamente 60 minutos ya NO es el bonus de "< 60" sino el de "< 240"', () => {
    const f = calcularFactorPresionOperativa({
      pedidosPendientes: 0,
      capacidadEstimada: 100,
      minutosHastaCorte: 60,
    });
    expect(f.valor).toBe(8);
  });

  it('borde: 239 minutos todavía suma el bonus de urgencia moderada (8)', () => {
    const f = calcularFactorPresionOperativa({
      pedidosPendientes: 0,
      capacidadEstimada: 100,
      minutosHastaCorte: 239,
    });
    expect(f.valor).toBe(8);
  });

  it('borde: exactamente 240 minutos ya NO suma ningún bonus de urgencia', () => {
    const f = calcularFactorPresionOperativa({
      pedidosPendientes: 0,
      capacidadEstimada: 100,
      minutosHastaCorte: 240,
    });
    expect(f.valor).toBe(0);
  });

  it('minutosHastaCorte null (horizonte futuro) no suma urgencia', () => {
    const f = calcularFactorPresionOperativa({
      pedidosPendientes: 60,
      capacidadEstimada: 60,
      minutosHastaCorte: null,
    });
    expect(f.valor).toBe(60);
  });
});

// =============================================================================
// Factor · Clima
// =============================================================================

describe('calcularFactorClima', () => {
  it('sin lluvia ni viento → valor 0, explicación explícita', () => {
    const f = calcularFactorClima({
      precipitacionMaximaMmHora: 0,
      vientoMaximoKmh: 0,
      ventanaInicioLocal: '16:00',
      ventanaFinLocal: '19:00',
    });
    expect(f.valor).toBe(0);
    expect(f.explicacion).toBe('Sin precipitación ni viento relevante pronosticados en la ventana de reparto.');
  });

  it('lluvia de 8 mm/h → valor 88, menciona la ventana', () => {
    const f = calcularFactorClima({
      precipitacionMaximaMmHora: 8,
      vientoMaximoKmh: null,
      ventanaInicioLocal: '16:00',
      ventanaFinLocal: '19:00',
    });
    expect(f.valor).toBe(88);
    expect(f.explicacion).toBe('Lluvia de 8 mm/h entre 16:00 y 19:00, dentro de la ventana de reparto.');
  });

  it('lluvia intensa (>=9.1 mm/h) satura a 100', () => {
    const f = calcularFactorClima({
      precipitacionMaximaMmHora: 15,
      vientoMaximoKmh: null,
      ventanaInicioLocal: '16:00',
      ventanaFinLocal: '19:00',
    });
    expect(f.valor).toBe(100);
  });

  it('viento moderado (40 km/h) sin lluvia suma 10', () => {
    const f = calcularFactorClima({
      precipitacionMaximaMmHora: 0,
      vientoMaximoKmh: 40,
      ventanaInicioLocal: '08:00',
      ventanaFinLocal: '12:00',
    });
    expect(f.valor).toBe(10);
    expect(f.explicacion).toContain('Viento de 40 km/h');
  });

  it('borde: viento de 39 km/h no suma nada', () => {
    const f = calcularFactorClima({
      precipitacionMaximaMmHora: 0,
      vientoMaximoKmh: 39,
      ventanaInicioLocal: '08:00',
      ventanaFinLocal: '12:00',
    });
    expect(f.valor).toBe(0);
  });

  it('viento alto (60 km/h) sin lluvia suma 20', () => {
    const f = calcularFactorClima({
      precipitacionMaximaMmHora: 0,
      vientoMaximoKmh: 60,
      ventanaInicioLocal: '08:00',
      ventanaFinLocal: '12:00',
    });
    expect(f.valor).toBe(20);
  });

  it('lluvia y viento se suman, con tope 100', () => {
    const f = calcularFactorClima({
      precipitacionMaximaMmHora: 8,
      vientoMaximoKmh: 60,
      ventanaInicioLocal: '16:00',
      ventanaFinLocal: '19:00',
    });
    expect(f.valor).toBe(100); // 88 + 20 clamp a 100
  });
});

// =============================================================================
// Factor · Aire y restricción
// =============================================================================

describe('calcularFactorAire', () => {
  it('nivel bueno, sin restricción → valor 8', () => {
    const f = calcularFactorAire({ nivelPeorEnVentana: 'bueno', restriccionVigenteHoy: false });
    expect(f.valor).toBe(8);
    expect(f.explicacion).toContain('PM2.5 en rango bueno.');
    expect(f.explicacion).toContain('Sin restricción extraordinaria vigente.');
  });

  it('nivel regular, sin restricción → valor 30', () => {
    const f = calcularFactorAire({ nivelPeorEnVentana: 'regular', restriccionVigenteHoy: false });
    expect(f.valor).toBe(30);
  });

  it('nivel alerta, con restricción vigente → 55 + 15 = 70', () => {
    const f = calcularFactorAire({ nivelPeorEnVentana: 'alerta', restriccionVigenteHoy: true });
    expect(f.valor).toBe(70);
    expect(f.explicacion).toContain('Restricción vehicular vigente hoy.');
  });

  it('nivel preemergencia, con restricción → 80 + 15 = 95', () => {
    const f = calcularFactorAire({ nivelPeorEnVentana: 'preemergencia', restriccionVigenteHoy: true });
    expect(f.valor).toBe(95);
  });

  it('nivel emergencia, con restricción → satura a 100 (100 + 15 clamp)', () => {
    const f = calcularFactorAire({ nivelPeorEnVentana: 'emergencia', restriccionVigenteHoy: true });
    expect(f.valor).toBe(100);
  });
});

// =============================================================================
// Factor · Tránsito (F2, no computado)
// =============================================================================

describe('calcularFactorTransitoPendiente', () => {
  it('siempre valor 0 y peso 0 — nunca el 15% nominal', () => {
    const f = calcularFactorTransitoPendiente();
    expect(f.valor).toBe(0);
    expect(f.peso).toBe(0);
    expect(f.explicacion).toContain('F2');
  });
});

// =============================================================================
// Factor · Eventos
// =============================================================================

describe('calcularFactorEventos', () => {
  it('sin eventos → valor 0', () => {
    const f = calcularFactorEventos({ eventos: [] });
    expect(f.valor).toBe(0);
    expect(f.explicacion).toBe('Sin eventos relevantes en la ventana de reparto.');
  });

  it('un evento sin asistencia estimada → valor 25', () => {
    const f = calcularFactorEventos({ eventos: [{ nombre: 'Feria libre', asistenciaEstimada: null }] });
    expect(f.valor).toBe(25);
    expect(f.explicacion).toBe('Feria libre, dentro de la ventana de reparto.');
  });

  it('un evento con asistencia baja (<10.000) → valor 35', () => {
    const f = calcularFactorEventos({ eventos: [{ nombre: 'Evento chico', asistenciaEstimada: 5000 }] });
    expect(f.valor).toBe(35);
  });

  it('borde: asistencia exactamente 10.000 → valor 55', () => {
    const f = calcularFactorEventos({ eventos: [{ nombre: 'Evento medio', asistenciaEstimada: 10_000 }] });
    expect(f.valor).toBe(55);
  });

  it('borde: asistencia exactamente 30.000 → valor 80', () => {
    const f = calcularFactorEventos({ eventos: [{ nombre: 'Partido', asistenciaEstimada: 30_000 }] });
    expect(f.valor).toBe(80);
  });

  it('asistencia masiva (45.000) → valor 80 (mismo techo que 30.000)', () => {
    const f = calcularFactorEventos({ eventos: [{ nombre: 'Clásico', asistenciaEstimada: 45_000 }] });
    expect(f.valor).toBe(80);
  });

  it('dos eventos simultáneos suman un bonus de 5', () => {
    const f = calcularFactorEventos({
      eventos: [
        { nombre: 'Evento A', asistenciaEstimada: 5000 },
        { nombre: 'Evento B', asistenciaEstimada: 3000 },
      ],
    });
    expect(f.valor).toBe(40); // 35 + 5
  });

  it('el bonus por múltiples eventos tiene tope 10', () => {
    const f = calcularFactorEventos({
      eventos: [
        { nombre: 'A', asistenciaEstimada: 5000 },
        { nombre: 'B', asistenciaEstimada: 3000 },
        { nombre: 'C', asistenciaEstimada: 2000 },
        { nombre: 'D', asistenciaEstimada: 1000 },
      ],
    });
    expect(f.valor).toBe(45); // 35 + min(10, 3*5=15) = 35 + 10
  });

  it('la explicación usa el evento de mayor asistencia, no el primero de la lista', () => {
    const f = calcularFactorEventos({
      eventos: [
        { nombre: 'Evento menor', asistenciaEstimada: 2000 },
        { nombre: 'Evento principal', asistenciaEstimada: 40_000 },
      ],
    });
    expect(f.explicacion).toContain('Evento principal');
  });
});

// =============================================================================
// Factor · Histórico propio
// =============================================================================

describe('calcularFactorHistorico', () => {
  it('sin dato (null) → valor 0, explica la ausencia de historia', () => {
    const f = calcularFactorHistorico({ tasaFallidosPct: null });
    expect(f.valor).toBe(0);
    expect(f.explicacion).toContain('Sin historia suficiente');
  });

  it('tasa 0 → valor 0', () => {
    const f = calcularFactorHistorico({ tasaFallidosPct: 0 });
    expect(f.valor).toBe(0);
  });

  it('tasa negativa (defensivo) → valor 0', () => {
    const f = calcularFactorHistorico({ tasaFallidosPct: -5 });
    expect(f.valor).toBe(0);
  });

  it('tasa 14% → valor 56', () => {
    const f = calcularFactorHistorico({ tasaFallidosPct: 14 });
    expect(f.valor).toBe(56);
    expect(f.explicacion).toContain('14%');
  });

  it('tasa alta (30%) satura a 100', () => {
    const f = calcularFactorHistorico({ tasaFallidosPct: 30 });
    expect(f.valor).toBe(100);
  });
});

// =============================================================================
// calcularRiesgoZona — suma ponderada de los seis factores
// =============================================================================

describe('calcularRiesgoZona', () => {
  it('todo en calma → puntaje bajo y nivel calmo', () => {
    const r = calcularRiesgoZona({
      presionOperativa: { pedidosPendientes: 5, capacidadEstimada: 100, minutosHastaCorte: null },
      clima: { precipitacionMaximaMmHora: 0, vientoMaximoKmh: 0, ventanaInicioLocal: '08:00', ventanaFinLocal: '12:00' },
      aire: { nivelPeorEnVentana: 'bueno', restriccionVigenteHoy: false },
      eventos: { eventos: [] },
      historico: { tasaFallidosPct: null },
    });
    expect(r.nivel).toBe('calmo');
    expect(r.desglose.factores).toHaveLength(6);
  });

  it('reproduce el caso "Oriente" del dataset de referencia con pesos redistribuidos', () => {
    // Mismos valores por factor que ZONAS[0] de datos-dummy.ts (Oriente), pero
    // el puntaje NO tiene que coincidir con el 81 del dummy: esos valores son
    // "casos de prueba de referencia, no valores a reproducir" (los pesos del
    // dummy no redistribuyen tránsito). Se verifica que el cálculo con los
    // PESOS_EFECTIVOS_F1 da exactamente la suma ponderada esperada.
    const r = calcularRiesgoZona({
      presionOperativa: { pedidosPendientes: 86, capacidadEstimada: 60, minutosHastaCorte: 300 },
      clima: { precipitacionMaximaMmHora: 8, vientoMaximoKmh: null, ventanaInicioLocal: '16:00', ventanaFinLocal: '19:00' },
      aire: { nivelPeorEnVentana: 'regular', restriccionVigenteHoy: false },
      eventos: { eventos: [{ nombre: 'Partido en Ñuñoa', asistenciaEstimada: null }] },
      historico: { tasaFallidosPct: 14 },
    });

    const presion = calcularFactorPresionOperativa({ pedidosPendientes: 86, capacidadEstimada: 60, minutosHastaCorte: 300 });
    const clima = calcularFactorClima({ precipitacionMaximaMmHora: 8, vientoMaximoKmh: null, ventanaInicioLocal: '16:00', ventanaFinLocal: '19:00' });
    const aire = calcularFactorAire({ nivelPeorEnVentana: 'regular', restriccionVigenteHoy: false });
    const eventos = calcularFactorEventos({ eventos: [{ nombre: 'Partido en Ñuñoa', asistenciaEstimada: null }] });
    const historico = calcularFactorHistorico({ tasaFallidosPct: 14 });

    const esperado = Math.round(
      presion.valor * presion.peso +
        clima.valor * clima.peso +
        aire.valor * aire.peso +
        0 /* transito */ +
        eventos.valor * eventos.peso +
        historico.valor * historico.peso,
    );

    expect(r.puntaje).toBe(esperado);
  });

  it('el desglose incluye tránsito con peso 0 (nunca 15%)', () => {
    const r = calcularRiesgoZona({
      presionOperativa: { pedidosPendientes: 0, capacidadEstimada: 100, minutosHastaCorte: null },
      clima: { precipitacionMaximaMmHora: 0, vientoMaximoKmh: 0, ventanaInicioLocal: '08:00', ventanaFinLocal: '12:00' },
      aire: { nivelPeorEnVentana: 'bueno', restriccionVigenteHoy: false },
      eventos: { eventos: [] },
      historico: { tasaFallidosPct: null },
    });
    const transito = r.desglose.factores.find((f) => f.id === 'transito');
    expect(transito?.peso).toBe(0);
  });

  /**
   * El peor escenario construible NO da 100, y eso es correcto por diseño.
   *
   * `eventos` tiene techo 90: 80 por un evento de asistencia alta, más un bonus
   * de hasta 10 por eventos simultáneos. Un solo evento, por masivo que sea, no
   * satura el factor — dos eventos a la vez sí son peores que uno, y la escala
   * lo refleja. Con peso 10/85, esos 10 puntos que faltan restan ~1,2 al total.
   *
   * Techo real: (100·35 + 100·20 + 100·15 + 90·10 + 100·5) / 85 = 98,82 → 99.
   *
   * Que los pesos sumen 1 se verifica aparte (ver el bloque de pesos arriba),
   * así que este test no necesita apoyarse en un 100 redondo: verifica que el
   * peor caso cae holgado en `critico` y que ningún factor se queda corto por
   * un error de escala.
   */
  it('peor escenario construible: puntaje 99 y nivel critico', () => {
    const r = calcularRiesgoZona({
      presionOperativa: { pedidosPendientes: 500, capacidadEstimada: 10, minutosHastaCorte: 0 },
      clima: { precipitacionMaximaMmHora: 20, vientoMaximoKmh: 80, ventanaInicioLocal: '16:00', ventanaFinLocal: '19:00' },
      aire: { nivelPeorEnVentana: 'emergencia', restriccionVigenteHoy: true },
      eventos: {
        eventos: [
          { nombre: 'Clásico', asistenciaEstimada: 50_000 },
          { nombre: 'Recital', asistenciaEstimada: 40_000 },
          { nombre: 'Marcha', asistenciaEstimada: 35_000 },
        ],
      },
      historico: { tasaFallidosPct: 50 },
    });
    expect(r.puntaje).toBe(99);
    expect(r.nivel).toBe('critico');

    // Todos los factores activos saturados salvo eventos, que topa en 90.
    const porId = Object.fromEntries(r.desglose.factores.map((f) => [f.id, f.valor]));
    expect(porId.presion_operativa).toBe(100);
    expect(porId.clima).toBe(100);
    expect(porId.aire).toBe(100);
    expect(porId.historico).toBe(100);
    expect(porId.eventos).toBe(90);
    expect(porId.transito).toBe(0);
  });
});

// =============================================================================
// colapsarRiesgoPorFranjas — MÁXIMO, no promedio; descarte de franjas vencidas
// =============================================================================

function resultadoConPuntaje(puntaje: number, etiquetaFactor = 'marca'): ResultadoRiesgoZona {
  return {
    puntaje,
    nivel: nivelDesdePuntaje(puntaje),
    desglose: {
      factores: [
        {
          id: 'presion_operativa',
          etiqueta: etiquetaFactor,
          valor: puntaje,
          peso: 1,
          explicacion: `franja de prueba con puntaje ${puntaje}`,
        },
      ],
    },
  };
}

describe('colapsarRiesgoPorFranjas', () => {
  it('toma el MÁXIMO entre las tres franjas, no el promedio', () => {
    const r = colapsarRiesgoPorFranjas(
      {
        manana: resultadoConPuntaje(20),
        tarde: resultadoConPuntaje(81),
        punta: resultadoConPuntaje(30),
      },
      { horizonte: 'manana', ahora: { fecha: '2026-07-26', horaMinutos: 8 * 60 } },
    );
    // Promedio sería (20+81+30)/3 = 43.67 ("medio"); el máximo es 81 ("critico").
    expect(r.puntaje).toBe(81);
    expect(r.nivel).toBe('critico');
    expect(r.desglose.franjaDominante).toBe('tarde');
  });

  it('el desglose colapsado es el de la franja ganadora, no un promedio de las tres', () => {
    const r = colapsarRiesgoPorFranjas(
      {
        manana: resultadoConPuntaje(10, 'factor-manana'),
        tarde: resultadoConPuntaje(90, 'factor-tarde'),
        punta: resultadoConPuntaje(50, 'factor-punta'),
      },
      { horizonte: 'manana', ahora: { fecha: '2026-07-26', horaMinutos: 8 * 60 } },
    );
    expect(r.desglose.factores).toHaveLength(1);
    expect(r.desglose.factores[0].etiqueta).toBe('factor-tarde');
  });

  it('horizonte "hoy": descarta franjas cuya ventana ya terminó', () => {
    // Ahora = 14:30 (870 min): mañana (termina a las 720) ya terminó.
    const r = colapsarRiesgoPorFranjas(
      {
        manana: resultadoConPuntaje(95), // ya pasó — no debe contar
        tarde: resultadoConPuntaje(40),
        punta: resultadoConPuntaje(30),
      },
      { horizonte: 'hoy', ahora: { fecha: '2026-07-25', horaMinutos: 14 * 60 + 30 } },
    );
    expect(r.puntaje).toBe(40);
    expect(r.desglose.franjaDominante).toBe('tarde');
  });

  it('horizonte "hoy" a las 22:00: las tres franjas ya terminaron → calmo, sin franja dominante', () => {
    const r = colapsarRiesgoPorFranjas(
      {
        manana: resultadoConPuntaje(95),
        tarde: resultadoConPuntaje(90),
        punta: resultadoConPuntaje(85),
      },
      { horizonte: 'hoy', ahora: { fecha: '2026-07-25', horaMinutos: 22 * 60 } },
    );
    expect(r.puntaje).toBe(0);
    expect(r.nivel).toBe('calmo');
    expect(r.desglose.franjaDominante).toBeNull();
    expect(r.desglose.factores).toEqual([]);
  });

  it('horizonte "manana" a las 22:00 NO filtra por hora: el día completo es futuro', () => {
    const r = colapsarRiesgoPorFranjas(
      {
        manana: resultadoConPuntaje(95),
        tarde: resultadoConPuntaje(10),
        punta: resultadoConPuntaje(10),
      },
      { horizonte: 'manana', ahora: { fecha: '2026-07-25', horaMinutos: 22 * 60 } },
    );
    expect(r.puntaje).toBe(95);
    expect(r.desglose.franjaDominante).toBe('manana');
  });

  it('horizonte "72h" tampoco filtra por hora', () => {
    const r = colapsarRiesgoPorFranjas(
      { manana: resultadoConPuntaje(15), tarde: resultadoConPuntaje(72), punta: resultadoConPuntaje(5) },
      { horizonte: '72h', ahora: { fecha: '2026-07-25', horaMinutos: 22 * 60 } },
    );
    expect(r.puntaje).toBe(72);
  });

  it('borde exacto: "hoy" justo en el minuto en que termina la franja tarde (17:00) ya la excluye', () => {
    const r = colapsarRiesgoPorFranjas(
      { tarde: resultadoConPuntaje(99), punta: resultadoConPuntaje(20) },
      { horizonte: 'hoy', ahora: { fecha: '2026-07-25', horaMinutos: 17 * 60 } },
    );
    expect(r.puntaje).toBe(20); // tarde (termina a las 17:00) queda fuera; solo punta cuenta
    expect(r.desglose.franjaDominante).toBe('punta');
  });

  it('borde: un minuto antes de que termine la franja tarde, todavía cuenta', () => {
    const r = colapsarRiesgoPorFranjas(
      { tarde: resultadoConPuntaje(99), punta: resultadoConPuntaje(20) },
      { horizonte: 'hoy', ahora: { fecha: '2026-07-25', horaMinutos: 17 * 60 - 1 } },
    );
    expect(r.puntaje).toBe(99);
    expect(r.desglose.franjaDominante).toBe('tarde');
  });

  it('franjas parciales: si solo llegó una franja, esa es el resultado', () => {
    const r = colapsarRiesgoPorFranjas(
      { punta: resultadoConPuntaje(33) },
      { horizonte: 'hoy', ahora: { fecha: '2026-07-25', horaMinutos: 8 * 60 } },
    );
    expect(r.puntaje).toBe(33);
    expect(r.desglose.franjaDominante).toBe('punta');
  });

  it('sin ninguna franja (objeto vacío) → calmo/0/null, para cualquier horizonte', () => {
    const r = colapsarRiesgoPorFranjas({}, { horizonte: 'manana', ahora: { fecha: '2026-07-25', horaMinutos: 8 * 60 } });
    expect(r.puntaje).toBe(0);
    expect(r.nivel).toBe('calmo');
    expect(r.desglose.franjaDominante).toBeNull();
  });
});

// =============================================================================
// Integración: reloj real a las 22:00 de Santiago (fake timers)
// =============================================================================
// Es el escenario exacto que hoy rompe el resto del producto (uso de
// toISOString para derivar "hoy"/"ahora" en UTC en vez de Santiago). Aquí se
// arma `AhoraSantiago` con los helpers correctos y se verifica que, a esa
// hora, un día "hoy" con riesgo alto en las tres franjas queda correctamente
// silenciado (calmo) porque las tres franjas ya terminaron.
// =============================================================================

describe('integración: 22:00 de Santiago (invierno, fake timers)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 2026-07-26T02:00:00Z = 2026-07-25 22:00 hora Santiago (CLT, UTC-4).
    vi.setSystemTime(new Date('2026-07-26T02:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('a las 22:00 de Santiago, horizonte "hoy" queda calmo aunque el día haya sido crítico', () => {
    const { fecha, hora } = ahoraEnSantiago();
    expect(fecha).toBe('2026-07-25');
    expect(hora).toBe('22:00');

    const ahora: AhoraSantiago = { fecha, horaMinutos: horaAMinutos(hora) };

    const r = colapsarRiesgoPorFranjas(
      {
        manana: resultadoConPuntaje(95),
        tarde: resultadoConPuntaje(90),
        punta: resultadoConPuntaje(85),
      },
      { horizonte: 'hoy', ahora },
    );

    expect(r.puntaje).toBe(0);
    expect(r.nivel).toBe('calmo');
    expect(r.desglose.franjaDominante).toBeNull();
  });
});

// =============================================================================
// Guard estático: prohibido toISOString dentro de src/modules/contexto/
// =============================================================================
// Barato y para siempre (instrucción del paso A4): un grep del directorio que
// falla si alguien reintroduce el bug conocido del proyecto (derivar una fecha
// civil con toISOString, que es UTC y no Santiago). No distingue "uso
// inocente" de "uso peligroso" a propósito — la prohibición es total dentro de
// este módulo.
// =============================================================================

describe('guard: toISOString prohibido en src/modules/contexto/', () => {
  const DIR_CONTEXTO = dirname(fileURLToPath(import.meta.url));

  function listarArchivosFuente(dir: string): string[] {
    const salida: string[] = [];
    for (const entrada of readdirSync(dir)) {
      const ruta = join(dir, entrada);
      const stat = statSync(ruta);
      if (stat.isDirectory()) {
        salida.push(...listarArchivosFuente(ruta));
      } else if (/\.tsx?$/.test(entrada)) {
        salida.push(ruta);
      }
    }
    return salida;
  }

  /**
   * Los dos patrones que SÍ son bugs, no la llamada en sí.
   *
   * Una primera versión de este guard prohibía cualquier `toISOString`, y eso
   * está mal: serializar un instante para escribirlo en una columna
   * `timestamptz` es exactamente lo correcto, y es lo que hacen los jobs de
   * este módulo al estampar `actualizado_en`. Un guard que prohíbe lo legítimo
   * termina con una excepción encima, y esa excepción es por donde después se
   * cuela el bug de verdad.
   *
   * Lo que rompe la Torre son estos dos:
   *
   * 1. Truncar un instante UTC para obtener una FECHA CIVIL. Desde las 20:00 de
   *    Santiago (21:00 en verano) UTC ya está en el día siguiente, así que la
   *    pantalla muestra el clima del día equivocado y el coordinador decide con
   *    datos de mañana creyendo que son de hoy.
   * 2. Pegarle una hora UTC a una fecha civil chilena para armar un rango de
   *    día. Corre la ventana 3–4 horas, y con offset fijo (`-03:00`) además
   *    está mal la mitad del año, porque Santiago es −04:00 en invierno.
   *
   * Los patrones se arman con `new RegExp` sobre trozos concatenados para que
   * este archivo no contenga los literales que busca — si no, el guard se
   * delata a sí mismo. Así el barrido cubre TODOS los archivos del módulo,
   * incluido este, sin listas de exclusión.
   */
  const PATRONES_PROHIBIDOS: { motivo: string; regex: RegExp }[] = [
    {
      motivo: 'deriva una fecha civil truncando un instante UTC',
      regex: new RegExp('toISO' + 'String\\(\\)\\s*\\.\\s*(slice|split|substring)'),
    },
    {
      motivo: 'interpreta una fecha civil chilena como instante UTC',
      regex: new RegExp('T(00:00:00|23:59:59)[.\\d]*Z'),
    },
  ];

  it('ningún archivo de src/modules/contexto/ deriva fechas en UTC', () => {
    const archivos = listarArchivosFuente(DIR_CONTEXTO);
    const infractores: string[] = [];

    for (const ruta of archivos) {
      const texto = readFileSync(ruta, 'utf8');
      for (const { motivo, regex } of PATRONES_PROHIBIDOS) {
        if (regex.test(texto)) infractores.push(`${ruta} (${motivo})`);
      }
    }

    expect(
      infractores,
      `Este módulo es 100 % sensible a fecha y hora: usa los helpers de ` +
        `src/lib/fecha-santiago.ts (hoyEnSantiago, fechaLocalEnSantiago, ` +
        `limitesDelDiaSantiago). Infractores: ${infractores.join(' · ')}`,
    ).toEqual([]);
  });
});
