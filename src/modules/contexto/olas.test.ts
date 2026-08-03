/**
 * Pruebas de la proyección de olas comerciales (F9).
 * =====================================================================
 *
 * Lo que importa proteger: que se vean VARIAS olas (con CyberMonday y Navidad
 * ambas en horizonte, quedarse con una escondía la otra), que la ventana de
 * entregas mande sobre la fecha del evento, y que la brecha de conductores —la
 * única cifra accionable— salga del día de mayor brecha y no del de mayor
 * volumen.
 */

import { describe, it, expect } from 'vitest';
import {
  proximasOlas,
  proyectarOla,
  proyectarOlas,
  ventanaDeEntregas,
  volumenBasePorDiaSemana,
  MAXIMO_OLAS_VISIBLES,
  type EventoComercialCatalogo,
} from './olas';

/** CyberDay: la compra ocurre en 3 días y las entregas llegan D+1 a D+4. */
const cyber: EventoComercialCatalogo = {
  id: 'cyber-2026',
  nombre: 'CyberDay',
  arquetipo: 'venta',
  organizador: 'CCS',
  inicio: '2026-10-05',
  fin: '2026-10-07',
  multiplicadorBase: 2.4,
  curvaRezago: { '1': 0.2, '2': 0.35, '3': 0.3, '4': 0.15 },
};

/** Navidad: el regalo tiene que llegar ANTES; la ventana precede al evento. */
const navidad: EventoComercialCatalogo = {
  id: 'navidad-2026',
  nombre: 'Navidad',
  arquetipo: 'regalo',
  organizador: null,
  inicio: '2026-12-25',
  fin: '2026-12-25',
  multiplicadorBase: 1.8,
  curvaRezago: { '-5': 0.3, '-3': 0.4, '-1': 0.3 },
};

const BASE_PAREJA = { 0: 100, 1: 100, 2: 100, 3: 100, 4: 100, 5: 100, 6: 100 };

const COMUN = {
  volumenBase: BASE_PAREJA,
  capacidadDiaria: 120,
  capacidadPorConductor: 30,
  hoy: '2026-10-01',
};

// =============================================================================
// Selección
// =============================================================================

describe('proximasOlas', () => {
  it('devuelve VARIAS, en orden cronológico de ventana de entregas', () => {
    const olas = proximasOlas([navidad, cyber], '2026-10-01', 120);
    expect(olas.map((o) => o.id)).toEqual(['cyber-2026', 'navidad-2026']);
  });

  it('no devuelve más de las visibles', () => {
    const muchos = [1, 2, 3, 4, 5].map((n) => ({
      ...cyber,
      id: `e${n}`,
      inicio: `2026-10-0${n}`,
      fin: `2026-10-0${n}`,
    }));
    expect(proximasOlas(muchos, '2026-10-01', 120)).toHaveLength(MAXIMO_OLAS_VISIBLES);
  });

  it('descarta la ola cuya ventana de entregas ya terminó', () => {
    // El 20 de octubre el CyberDay del 5–7 ya se entregó entero.
    expect(proximasOlas([cyber], '2026-10-20')).toHaveLength(0);
  });

  it('CONSERVA la ola cuyo evento pasó pero cuyas entregas siguen llegando', () => {
    // El 9 de octubre el CyberDay ya terminó, pero su ola es la que se está
    // repartiendo. Ésta es la distinción que justifica el módulo entero.
    expect(proximasOlas([cyber], '2026-10-09').map((o) => o.id)).toEqual(['cyber-2026']);
  });

  it('descarta lo que está más allá del horizonte', () => {
    expect(proximasOlas([navidad], '2026-10-01', 45)).toHaveLength(0);
  });
});

describe('ventanaDeEntregas', () => {
  it('en arquetipo venta, las entregas van DESPUÉS del evento', () => {
    expect(ventanaDeEntregas(cyber)).toEqual({ inicio: '2026-10-06', fin: '2026-10-09' });
  });

  it('en arquetipo regalo, las entregas van ANTES', () => {
    expect(ventanaDeEntregas(navidad)).toEqual({ inicio: '2026-12-20', fin: '2026-12-24' });
  });
});

// =============================================================================
// Proyección
// =============================================================================

describe('proyectarOla', () => {
  it('no publica curva, hitos ni fecha límite de compra: se retiraron', () => {
    const ola = proyectarOla({ ...COMUN, evento: cyber });
    expect(ola).not.toBeNull();
    expect(Object.keys(ola!).sort()).toEqual([
      'arquetipo',
      'brechaConductores',
      'diaCritico',
      'diasParaEvento',
      'fechaEvento',
      'fuenteProyeccion',
      'nombre',
      'organizador',
      'variacionEsperadaPct',
      'ventanaEntregas',
      'id',
    ].sort());
  });

  it('la brecha de conductores es negativa cuando falta gente', () => {
    // Base 100/día, multiplicador 2,4 sobre 3 días = 420 extra repartidos. El
    // peak (0,35) da 100 + 147 = 247 contra capacidad 120: faltan 127 paradas,
    // que a 30 por conductor son 5 conductores.
    const ola = proyectarOla({ ...COMUN, evento: cyber });
    expect(ola!.brechaConductores).toBe(-5);
  });

  it('si la capacidad alcanza, la brecha es 0 y no un positivo inventado', () => {
    const ola = proyectarOla({ ...COMUN, evento: cyber, capacidadDiaria: 5000 });
    expect(ola!.brechaConductores).toBe(0);
  });

  it('el día crítico es el de mayor BRECHA, no el de mayor volumen', () => {
    // Con base pareja, el de mayor brecha coincide con el peak de la curva: D+2.
    const ola = proyectarOla({ ...COMUN, evento: cyber });
    expect(ola!.diaCritico).toBe('2026-10-07');
  });

  it('sin línea base histórica devuelve null: una fila de ceros no es un dato', () => {
    expect(proyectarOla({ ...COMUN, evento: cyber, volumenBase: {} })).toBeNull();
  });

  it('los días para el evento se cuentan en calendario civil', () => {
    const ola = proyectarOla({ ...COMUN, evento: cyber });
    expect(ola!.diasParaEvento).toBe(4);
  });
});

describe('proyectarOlas', () => {
  it('descarta en silencio las que no se pueden proyectar', () => {
    const olas = proyectarOlas([cyber, navidad], { ...COMUN, volumenBase: {} });
    expect(olas).toHaveLength(0);
  });

  it('proyecta todas las que sí tienen base', () => {
    const olas = proyectarOlas([cyber, navidad], COMUN);
    expect(olas.map((o) => o.nombre)).toEqual(['CyberDay', 'Navidad']);
  });
});

// =============================================================================
// Línea base del courier
// =============================================================================

describe('volumenBasePorDiaSemana', () => {
  it('promedia POR DÍA DE SEMANA, no en general', () => {
    // Dos lunes con 2 y 4 pedidos → media de lunes = 3.
    const base = volumenBasePorDiaSemana([
      '2026-10-05',
      '2026-10-05',
      '2026-10-12',
      '2026-10-12',
      '2026-10-12',
      '2026-10-12',
    ]);
    expect(base[1]).toBe(3);
  });

  it('un día sin operación no arrastra la media hacia cero', () => {
    // Solo hay un lunes con dato; los otros lunes del rango no cuentan como 0.
    const base = volumenBasePorDiaSemana(['2026-10-05', '2026-10-05']);
    expect(base[1]).toBe(2);
    expect(base[0]).toBeUndefined();
  });
});
