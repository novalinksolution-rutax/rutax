/**
 * Tests de la agregación de insumos del motor de riesgo.
 *
 * Lo que se cubre aquí no es «la función devuelve un número»: son las cuatro
 * decisiones que, si se equivocan, producen un tablero plausible y falso —
 * repartir capacidad, elegir el corte que aprieta, colapsar el pronóstico de
 * varias comunas en una zona, y de dónde sale el dinero comprometido.
 */

import { describe, it, expect } from 'vitest';
import {
  RANGO_FRANJA,
  aireDeZonaFranja,
  capacidadPorZona,
  cargaPorZona,
  climaDeZonaFranja,
  eventosDeZonaFranja,
  franjaDeHora,
  indexarPorComunaFechaFranja,
  minutosHastaCorte,
  tasaFallidosPorZona,
  type FilaAire,
  type FilaClima,
} from './agregacion';

const ZONAS = ['z-centro', 'z-oriente', 'z-sur'];

describe('capacidadPorZona', () => {
  it('asigna toda la capacidad del conductor a su única zona', () => {
    const capacidad = capacidadPorZona(
      [{ id: 'c1', capacidadParadas: 30 }],
      [{ conductorId: 'c1', zonaId: 'z-centro' }],
      ZONAS,
    );
    expect(capacidad.get('z-centro')).toBe(30);
    expect(capacidad.get('z-oriente')).toBe(0);
    expect(capacidad.get('z-sur')).toBe(0);
  });

  it('NO cuenta dos veces al conductor asignado a dos zonas', () => {
    const capacidad = capacidadPorZona(
      [{ id: 'c1', capacidadParadas: 30 }],
      [
        { conductorId: 'c1', zonaId: 'z-centro' },
        { conductorId: 'c1', zonaId: 'z-oriente' },
      ],
      ZONAS,
    );
    expect(capacidad.get('z-centro')).toBe(15);
    expect(capacidad.get('z-oriente')).toBe(15);
    // Y el total sigue siendo el que hay, no el doble.
    const total = [...capacidad.values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(30);
  });

  it('reparte entre todas las zonas al conductor sin asignación (pool flexible)', () => {
    const capacidad = capacidadPorZona([{ id: 'c1', capacidadParadas: 30 }], [], ZONAS);
    expect([...capacidad.values()]).toEqual([10, 10, 10]);
  });

  it('ignora asignaciones a zonas que ya no existen', () => {
    const capacidad = capacidadPorZona(
      [{ id: 'c1', capacidadParadas: 20 }],
      [{ conductorId: 'c1', zonaId: 'z-borrada' }],
      ZONAS,
    );
    // Sin asignaciones válidas vuelve al pool flexible, no desaparece.
    expect([...capacidad.values()]).toEqual([6, 6, 6]);
  });

  it('deja todas las zonas en cero si no hay conductores disponibles', () => {
    const capacidad = capacidadPorZona([], [], ZONAS);
    expect([...capacidad.values()]).toEqual([0, 0, 0]);
  });
});

describe('minutosHastaCorte', () => {
  const AHORA = { fecha: '2026-07-25', horaMinutos: 9 * 60 + 14 };

  it('toma el corte MÁS TEMPRANO entre los aplicables, no el último', () => {
    const minutos = minutosHastaCorte(
      [
        { zonaId: 'z-centro', horaCorte: '18:00', activa: true },
        { zonaId: null, horaCorte: '12:00', activa: true },
      ],
      'z-centro',
      '2026-07-25',
      AHORA,
    );
    expect(minutos).toBe(12 * 60 - (9 * 60 + 14)); // 166
  });

  it('ignora las ventanas de OTRA zona', () => {
    const minutos = minutosHastaCorte(
      [
        { zonaId: 'z-oriente', horaCorte: '10:00', activa: true },
        { zonaId: 'z-centro', horaCorte: '17:00', activa: true },
      ],
      'z-centro',
      '2026-07-25',
      AHORA,
    );
    expect(minutos).toBe(17 * 60 - (9 * 60 + 14));
  });

  it('ignora las ventanas inactivas', () => {
    const minutos = minutosHastaCorte(
      [
        { zonaId: null, horaCorte: '10:00', activa: false },
        { zonaId: 'z-centro', horaCorte: '16:00', activa: true },
      ],
      'z-centro',
      '2026-07-25',
      AHORA,
    );
    expect(minutos).toBe(16 * 60 - (9 * 60 + 14));
  });

  it('suma los días de calendario para un horizonte futuro', () => {
    const minutos = minutosHastaCorte(
      [{ zonaId: null, horaCorte: '12:00', activa: true }],
      'z-centro',
      '2026-07-27',
      AHORA,
    );
    expect(minutos).toBe(2 * 1440 + 12 * 60 - (9 * 60 + 14));
  });

  it('devuelve 0 —no un negativo— cuando el corte ya venció', () => {
    const minutos = minutosHastaCorte(
      [{ zonaId: null, horaCorte: '08:00', activa: true }],
      'z-centro',
      '2026-07-25',
      AHORA,
    );
    expect(minutos).toBe(0);
  });

  it('devuelve null si el courier no configuró ninguna ventana', () => {
    expect(minutosHastaCorte([], 'z-centro', '2026-07-25', AHORA)).toBeNull();
  });

  it('acepta la hora con segundos, como la devuelve Postgres', () => {
    const minutos = minutosHastaCorte(
      [{ zonaId: null, horaCorte: '12:00:00', activa: true }],
      'z-centro',
      '2026-07-25',
      AHORA,
    );
    expect(minutos).toBe(12 * 60 - (9 * 60 + 14));
  });
});

describe('franjaDeHora', () => {
  it('parte el día en las tres franjas de la migración', () => {
    expect(franjaDeHora('08:00')).toBe('manana');
    expect(franjaDeHora('11:59')).toBe('manana');
    expect(franjaDeHora('12:00')).toBe('tarde'); // borde abierto por arriba
    expect(franjaDeHora('16:59')).toBe('tarde');
    expect(franjaDeHora('17:00')).toBe('punta');
    expect(franjaDeHora('20:59')).toBe('punta');
  });

  it('devuelve null fuera de la jornada de reparto', () => {
    expect(franjaDeHora('07:59')).toBeNull();
    expect(franjaDeHora('21:00')).toBeNull();
    expect(franjaDeHora('03:00')).toBeNull();
  });
});

describe('climaDeZonaFranja', () => {
  // 16:00 en Santiago (UTC-4 en julio) = 20:00Z → franja tarde del día 25.
  const FILAS: FilaClima[] = [
    { comuna: 'Las Condes', hora: '2026-07-25T20:00:00Z', precipitacionMm: 8, vientoKmh: 20 },
    { comuna: 'Vitacura', hora: '2026-07-25T20:00:00Z', precipitacionMm: 0, vientoKmh: 45 },
    { comuna: 'Santiago', hora: '2026-07-25T20:00:00Z', precipitacionMm: 30, vientoKmh: 10 },
  ];

  it('toma el PEOR de las comunas de la zona, no el promedio', () => {
    const indice = indexarPorComunaFechaFranja(FILAS);
    const clima = climaDeZonaFranja(indice, ['Las Condes', 'Vitacura'], '2026-07-25', 'tarde');
    expect(clima.precipitacionMaximaMmHora).toBe(8); // no 4
    expect(clima.vientoMaximoKmh).toBe(45);
  });

  it('no mezcla comunas de otra zona', () => {
    const indice = indexarPorComunaFechaFranja(FILAS);
    const clima = climaDeZonaFranja(indice, ['Las Condes', 'Vitacura'], '2026-07-25', 'tarde');
    expect(clima.precipitacionMaximaMmHora).not.toBe(30); // Santiago no es de esta zona
  });

  it('empareja la comuna ignorando acentos y caja', () => {
    const indice = indexarPorComunaFechaFranja([
      { comuna: 'ÑUÑOA', hora: '2026-07-25T20:00:00Z', precipitacionMm: 5, vientoKmh: null },
    ]);
    const clima = climaDeZonaFranja(indice, ['Ñuñoa'], '2026-07-25', 'tarde');
    expect(clima.precipitacionMaximaMmHora).toBe(5);
  });

  it('devuelve el neutro cuando no hay pronóstico para esa franja', () => {
    const indice = indexarPorComunaFechaFranja(FILAS);
    const clima = climaDeZonaFranja(indice, ['Las Condes'], '2026-07-25', 'manana');
    expect(clima.precipitacionMaximaMmHora).toBe(0);
    expect(clima.vientoMaximoKmh).toBeNull();
  });

  it('viaja con la ventana local de su franja', () => {
    const indice = indexarPorComunaFechaFranja(FILAS);
    const clima = climaDeZonaFranja(indice, ['Las Condes'], '2026-07-25', 'punta');
    expect(clima.ventanaInicioLocal).toBe(RANGO_FRANJA.punta.desde);
    expect(clima.ventanaFinLocal).toBe(RANGO_FRANJA.punta.hasta);
  });

  it('clasifica la hora por la FECHA DE SANTIAGO, no por la UTC', () => {
    // 26-jul 00:30 UTC = 25-jul 20:30 en Santiago → punta del día 25. Leerlo
    // como UTC lo metería en el día 26 y la franja quedaría vacía.
    // (La hora se escribe con minutos distintos de cero a propósito: el guard
    // de zona horaria de este módulo prohíbe el literal de medianoche UTC,
    // porque es la firma del bug que busca.)
    const indice = indexarPorComunaFechaFranja([
      { comuna: 'Santiago', hora: '2026-07-26T00:30:00Z', precipitacionMm: 12, vientoKmh: null },
    ]);
    expect(climaDeZonaFranja(indice, ['Santiago'], '2026-07-25', 'punta').precipitacionMaximaMmHora).toBe(12);
    expect(climaDeZonaFranja(indice, ['Santiago'], '2026-07-26', 'punta').precipitacionMaximaMmHora).toBe(0);
  });
});

describe('aireDeZonaFranja', () => {
  const FILAS: FilaAire[] = [
    { comuna: 'Puente Alto', hora: '2026-07-25T20:00:00Z', nivelEstimado: 'preemergencia' },
    { comuna: 'La Florida', hora: '2026-07-25T20:00:00Z', nivelEstimado: 'regular' },
  ];

  it('toma el peor nivel de la zona', () => {
    const indice = indexarPorComunaFechaFranja(FILAS);
    expect(aireDeZonaFranja(indice, ['Puente Alto', 'La Florida'], '2026-07-25', 'tarde')).toBe(
      'preemergencia',
    );
  });

  it('sin dato devuelve el neutro y no lo peor', () => {
    const indice = indexarPorComunaFechaFranja(FILAS);
    expect(aireDeZonaFranja(indice, ['Maipú'], '2026-07-25', 'tarde')).toBe('bueno');
  });
});

describe('eventosDeZonaFranja', () => {
  const PARTIDO = {
    nombre: 'Partido en el Estadio Nacional',
    comuna: 'Ñuñoa',
    // 18:00 a 23:30 hora de Santiago.
    ventanaInicio: '2026-07-25T22:00:00Z',
    ventanaFin: '2026-07-26T03:30:00Z',
    asistenciaEstimada: 42000,
  };

  it('cae en la franja punta de su día', () => {
    const { eventos } = eventosDeZonaFranja([PARTIDO], ['Ñuñoa'], '2026-07-25', 'punta');
    expect(eventos).toHaveLength(1);
    expect(eventos[0].asistenciaEstimada).toBe(42000);
  });

  it('no cae en franjas anteriores del mismo día', () => {
    expect(eventosDeZonaFranja([PARTIDO], ['Ñuñoa'], '2026-07-25', 'manana').eventos).toHaveLength(0);
    expect(eventosDeZonaFranja([PARTIDO], ['Ñuñoa'], '2026-07-25', 'tarde').eventos).toHaveLength(0);
  });

  it('no cae sobre una zona que no incluye su comuna', () => {
    expect(eventosDeZonaFranja([PARTIDO], ['Maipú'], '2026-07-25', 'punta').eventos).toHaveLength(0);
  });

  it('un evento sin término conocido sigue contando', () => {
    const abierto = { ...PARTIDO, ventanaFin: null };
    expect(eventosDeZonaFranja([abierto], ['Ñuñoa'], '2026-07-25', 'punta').eventos).toHaveLength(1);
  });

  it('no cuenta en un día anterior al de inicio', () => {
    expect(eventosDeZonaFranja([PARTIDO], ['Ñuñoa'], '2026-07-24', 'punta').eventos).toHaveLength(0);
  });
});

describe('cargaPorZona', () => {
  const COMUNA_A_ZONA = new Map([
    ['santiago', 'z-centro'],
    ['las condes', 'z-oriente'],
  ]);
  const TARIFAS = new Map([
    ['t-flex', 2500],
    ['t-same-day', 4000],
  ]);

  it('cuenta pendientes y valoriza con la tarifa del pedido', () => {
    const carga = cargaPorZona(
      [
        { destinatarioComuna: 'Santiago', fechaCompromiso: '2026-07-25', tarifaAplicableId: 't-flex' },
        { destinatarioComuna: 'Santiago', fechaCompromiso: '2026-07-25', tarifaAplicableId: 't-same-day' },
      ],
      COMUNA_A_ZONA,
      TARIFAS,
      '2026-07-25',
    );
    expect(carga.get('z-centro')).toEqual({ pendientes: 2, montoClp: 6500 });
  });

  it('cuenta el pedido sin tarifa pero NO le inventa un precio', () => {
    const carga = cargaPorZona(
      [
        { destinatarioComuna: 'Santiago', fechaCompromiso: '2026-07-25', tarifaAplicableId: null },
        { destinatarioComuna: 'Santiago', fechaCompromiso: '2026-07-25', tarifaAplicableId: 't-flex' },
      ],
      COMUNA_A_ZONA,
      TARIFAS,
      '2026-07-25',
    );
    expect(carga.get('z-centro')).toEqual({ pendientes: 2, montoClp: 2500 });
  });

  it('descarta los pedidos de otra fecha', () => {
    const carga = cargaPorZona(
      [{ destinatarioComuna: 'Santiago', fechaCompromiso: '2026-07-26', tarifaAplicableId: 't-flex' }],
      COMUNA_A_ZONA,
      TARIFAS,
      '2026-07-25',
    );
    expect(carga.get('z-centro')).toBeUndefined();
  });

  it('descarta el pedido de una comuna que ninguna zona cubre', () => {
    const carga = cargaPorZona(
      [{ destinatarioComuna: 'Melipilla', fechaCompromiso: '2026-07-25', tarifaAplicableId: 't-flex' }],
      COMUNA_A_ZONA,
      TARIFAS,
      '2026-07-25',
    );
    expect(carga.size).toBe(0);
  });

  it('empareja la comuna del pedido ignorando acentos', () => {
    const carga = cargaPorZona(
      [{ destinatarioComuna: 'LAS CONDES', fechaCompromiso: '2026-07-25', tarifaAplicableId: 't-flex' }],
      COMUNA_A_ZONA,
      TARIFAS,
      '2026-07-25',
    );
    expect(carga.get('z-oriente')?.pendientes).toBe(1);
  });
});

describe('tasaFallidosPorZona', () => {
  const COMUNA_A_ZONA = new Map([['santiago', 'z-centro']]);

  function cerrados(fallidos: number, entregados: number) {
    return [
      ...Array.from({ length: fallidos }, () => ({ destinatarioComuna: 'Santiago', estado: 'fallido' })),
      ...Array.from({ length: entregados }, () => ({ destinatarioComuna: 'Santiago', estado: 'entregado' })),
    ];
  }

  it('calcula el porcentaje sobre los intentos cerrados', () => {
    const tasas = tasaFallidosPorZona(cerrados(5, 45), COMUNA_A_ZONA);
    expect(tasas.get('z-centro')).toBeCloseTo(10, 6);
  });

  it('devuelve null con muestra insuficiente, en vez de fingir precisión', () => {
    const tasas = tasaFallidosPorZona(cerrados(1, 4), COMUNA_A_ZONA);
    expect(tasas.get('z-centro')).toBeNull();
  });

  it('no cuenta cancelados ni devueltos como intento', () => {
    const base = cerrados(5, 45);
    const conRuido = [
      ...base,
      ...Array.from({ length: 50 }, () => ({ destinatarioComuna: 'Santiago', estado: 'cancelado' })),
    ];
    expect(tasaFallidosPorZona(conRuido, COMUNA_A_ZONA).get('z-centro')).toBeCloseTo(10, 6);
  });

  it('cuenta las variantes manuales de entregado y fallido', () => {
    const filas = [
      ...Array.from({ length: 10 }, () => ({ destinatarioComuna: 'Santiago', estado: 'fallido_manual' })),
      ...Array.from({ length: 10 }, () => ({ destinatarioComuna: 'Santiago', estado: 'entregado_manual' })),
    ];
    expect(tasaFallidosPorZona(filas, COMUNA_A_ZONA).get('z-centro')).toBeCloseTo(50, 6);
  });
});
