/**
 * Pruebas de la agregación de la Torre v2.
 * =====================================================================
 *
 * Todo lo de este archivo es puro, y es justo lo que se equivoca en silencio: un
 * pedido contado dos veces, una comuna que no empareja por un acento, un corte
 * leído al revés. Nada de eso lanza — produce un número plausible y equivocado.
 */

import { describe, it, expect } from 'vitest';
import {
  avanceDeConductores,
  calcularFrescura,
  cargaPorComuna,
  claveDeUbicacion,
  contarPorUbicacion,
  diaCerrado,
  estaEnRiesgoDeCorte,
  indexarComunaAZona,
  minutosHastaCorte,
  resolverPedido,
  unificarRegistros,
  MINUTOS_RIESGO_DE_CORTE,
  UMBRAL_FRESCURA_MINUTOS,
  type PedidoAgregable,
  type RegistroDeEntrega,
} from './agregacion';

const SIN_INCIDENCIAS = new Map<string, number>();
const SIN_RIESGO = new Set<string>();

function pedido(over: Partial<PedidoAgregable> & { id: string }): PedidoAgregable {
  return { comuna: 'Ñuñoa', estado: 'asignado', ubicado: true, ...over };
}

function registro(over: Partial<RegistroDeEntrega> & { pedidoId: string }): RegistroDeEntrega {
  return {
    conductorId: 'c1',
    entregado: true,
    registradoEn: '2026-08-03T15:00:00.000Z',
    ...over,
  };
}

// =============================================================================
// Índice comuna → zona
// =============================================================================

describe('indexarComunaAZona', () => {
  it('empareja sin importar acentos ni mayúsculas', () => {
    const indice = indexarComunaAZona([{ id: 'z1', comunas: ['Ñuñoa', 'Providencia'] }]);
    expect(indice.get('nunoa')).toBe('z1');
  });

  it('si dos zonas declaran la misma comuna, gana la primera', () => {
    const indice = indexarComunaAZona([
      { id: 'z1', comunas: ['Maipú'] },
      { id: 'z2', comunas: ['Maipú'] },
    ]);
    expect(indice.get('maipu')).toBe('z1');
  });
});

// =============================================================================
// Corte — F7
// =============================================================================

describe('minutosHastaCorte', () => {
  const ventanas = [
    { zonaId: null, horaCorte: '18:00', activa: true },
    { zonaId: 'z1', horaCorte: '12:00', activa: true },
    { zonaId: 'z2', horaCorte: '09:00', activa: true },
  ];

  it('toma el corte MÁS TEMPRANO entre los aplicables, no el de la zona', () => {
    // z1 tiene su override a las 12:00 y además le aplica el default de las
    // 18:00. El que aprieta es el primero que vence.
    expect(minutosHastaCorte(ventanas, 'z1', 10 * 60)).toBe(120);
  });

  it('una zona sin override cae en la ventana por defecto', () => {
    expect(minutosHastaCorte(ventanas, 'z9', 10 * 60)).toBe(8 * 60);
  });

  it('no considera el corte de OTRA zona', () => {
    // Si tomara el de z2 (09:00), z1 a las 10:00 ya estaría vencida.
    expect(minutosHastaCorte(ventanas, 'z1', 10 * 60)).toBeGreaterThan(0);
  });

  it('un corte ya vencido devuelve 0, nunca un negativo', () => {
    expect(minutosHastaCorte(ventanas, 'z1', 23 * 60)).toBe(0);
  });

  it('sin ventanas configuradas devuelve null: «sin dato» no es «sin tiempo»', () => {
    expect(minutosHastaCorte([], 'z1', 600)).toBeNull();
  });

  it('ignora las ventanas inactivas', () => {
    const soloInactiva = [{ zonaId: null, horaCorte: '09:00', activa: false }];
    expect(minutosHastaCorte(soloInactiva, null, 600)).toBeNull();
  });
});

describe('estaEnRiesgoDeCorte', () => {
  it('marca dentro del margen y no fuera', () => {
    expect(estaEnRiesgoDeCorte(MINUTOS_RIESGO_DE_CORTE)).toBe(true);
    expect(estaEnRiesgoDeCorte(MINUTOS_RIESGO_DE_CORTE + 1)).toBe(false);
  });

  it('sin corte configurado NO marca: sería ruido en todo el courier', () => {
    expect(estaEnRiesgoDeCorte(null)).toBe(false);
  });
});

// =============================================================================
// Registros de entrega
// =============================================================================

describe('unificarRegistros', () => {
  it('cuando un pedido tiene POD y cierre, gana el más reciente', () => {
    const unificado = unificarRegistros([
      registro({ pedidoId: 'p1', entregado: false, registradoEn: '2026-08-03T15:00:00.000Z' }),
      registro({ pedidoId: 'p1', entregado: true, registradoEn: '2026-08-03T16:00:00.000Z' }),
    ]);
    expect(unificado.get('p1')?.entregado).toBe(true);
  });

  it('el orden de llegada no cambia el resultado', () => {
    const alReves = unificarRegistros([
      registro({ pedidoId: 'p1', entregado: true, registradoEn: '2026-08-03T16:00:00.000Z' }),
      registro({ pedidoId: 'p1', entregado: false, registradoEn: '2026-08-03T15:00:00.000Z' }),
    ]);
    expect(alReves.get('p1')?.entregado).toBe(true);
  });
});

describe('resolverPedido', () => {
  it('MANDA el registro de Rutax, aunque el estado oficial diga en_ruta', () => {
    // Es el caso Flex: el conductor cerró en la app pero ML todavía no sincronizó.
    const resultado = resolverPedido(
      pedido({ id: 'p1', estado: 'en_ruta' }),
      registro({ pedidoId: 'p1', entregado: true }),
    );
    expect(resultado).toEqual({ cerrado: true, entregado: true });
  });

  it('un cierre «no entregado» cierra el pedido pero no lo cuenta como entrega', () => {
    const resultado = resolverPedido(
      pedido({ id: 'p1', estado: 'en_ruta' }),
      registro({ pedidoId: 'p1', entregado: false }),
    );
    expect(resultado).toEqual({ cerrado: true, entregado: false });
  });

  it('sin registro cae al estado oficial (marcado a mano desde el backoffice)', () => {
    expect(resolverPedido(pedido({ id: 'p1', estado: 'entregado_manual' }), undefined)).toEqual({
      cerrado: true,
      entregado: true,
    });
    expect(resolverPedido(pedido({ id: 'p2', estado: 'fallido' }), undefined)).toEqual({
      cerrado: true,
      entregado: false,
    });
    expect(resolverPedido(pedido({ id: 'p3', estado: 'asignado' }), undefined)).toEqual({
      cerrado: false,
      entregado: false,
    });
  });
});

// =============================================================================
// Carga por comuna — F1
// =============================================================================

describe('cargaPorComuna', () => {
  it('produce la fracción pendientes/total por comuna', () => {
    const carga = cargaPorComuna(
      [
        pedido({ id: 'p1', comuna: 'Ñuñoa' }),
        pedido({ id: 'p2', comuna: 'Ñuñoa' }),
        pedido({ id: 'p3', comuna: 'Ñuñoa', estado: 'entregado' }),
      ],
      new Map(),
      SIN_INCIDENCIAS,
      SIN_RIESGO,
    );

    expect(carga.get('Ñuñoa')).toMatchObject({ total: 3, pendientes: 2, entregados: 1 });
  });

  it('normaliza el nombre de la comuna a su forma canónica', () => {
    const carga = cargaPorComuna(
      [pedido({ id: 'p1', comuna: 'ÑUÑOA' }), pedido({ id: 'p2', comuna: 'nunoa' })],
      new Map(),
      SIN_INCIDENCIAS,
      SIN_RIESGO,
    );

    // Las dos escrituras caen en la MISMA comuna: si no, el mapa mostraría dos.
    expect(carga.size).toBe(1);
    expect(carga.get('Ñuñoa')?.total).toBe(2);
  });

  it('un pedido sin comuna se agrupa bajo null, NO se descarta', () => {
    // Regla 5 del alcance: el mapa nunca esconde carga.
    const carga = cargaPorComuna(
      [pedido({ id: 'p1', comuna: null })],
      new Map(),
      SIN_INCIDENCIAS,
      SIN_RIESGO,
    );
    expect(carga.get(null)?.total).toBe(1);
  });

  it('cuenta los sin ubicar sin sacarlos del total', () => {
    const carga = cargaPorComuna(
      [pedido({ id: 'p1', ubicado: false }), pedido({ id: 'p2', ubicado: true })],
      new Map(),
      SIN_INCIDENCIAS,
      SIN_RIESGO,
    );
    expect(carga.get('Ñuñoa')).toMatchObject({ total: 2, sinUbicar: 1 });
  });

  it('solo los PENDIENTES cuentan como en riesgo de corte', () => {
    const carga = cargaPorComuna(
      [pedido({ id: 'p1' }), pedido({ id: 'p2', estado: 'entregado' })],
      new Map(),
      SIN_INCIDENCIAS,
      new Set(['Ñuñoa']),
    );
    // El entregado no está en riesgo de nada: ya llegó.
    expect(carga.get('Ñuñoa')).toMatchObject({ pendientes: 1, enRiesgoDeCorte: 1 });
  });

  it('el cierre de Rutax baja el contador aunque el estado oficial no se haya movido', () => {
    const carga = cargaPorComuna(
      [pedido({ id: 'p1', estado: 'en_ruta' })],
      unificarRegistros([registro({ pedidoId: 'p1', entregado: true })]),
      SIN_INCIDENCIAS,
      SIN_RIESGO,
    );
    expect(carga.get('Ñuñoa')).toMatchObject({ pendientes: 0, entregados: 1 });
  });
});

// =============================================================================
// Colapso por ubicación — el `+N` de F3
// =============================================================================

describe('colapso por ubicación', () => {
  it('el mismo edificio colapsa: el geocoding resuelve la dirección, no el depto', () => {
    // Éste es el caso real del `+N`. Seis entregas en la misma torre llegan con
    // la coordenada IDÉNTICA, así que la clave es la misma siempre.
    expect(claveDeUbicacion(-33.4489, -70.6693)).toBe(claveDeUbicacion(-33.4489, -70.6693));
  });

  it('dentro de una misma celda de la grilla, colapsa', () => {
    // 0,00005° ≈ 5 m, y estas dos caen en la misma celda.
    expect(claveDeUbicacion(-33.44880, -70.66920)).toBe(claveDeUbicacion(-33.44885, -70.66925));
  });

  it('dos puntos a ~100 m NO se colapsan', () => {
    expect(claveDeUbicacion(-33.4489, -70.6693)).not.toBe(claveDeUbicacion(-33.4498, -70.6693));
  });

  it('cuenta cuántos comparten cada ubicación', () => {
    const conteo = contarPorUbicacion([
      { lat: -33.4489, long: -70.6693 },
      { lat: -33.4489, long: -70.6693 },
      { lat: -33.5, long: -70.7 },
    ]);
    expect([...conteo.values()].sort()).toEqual([1, 2]);
  });
});

// =============================================================================
// Avance por conductor — F13
// =============================================================================

describe('diaCerrado', () => {
  it('el corte es a las 23:00 en punto', () => {
    expect(diaCerrado(22 * 60 + 59)).toBe(false);
    expect(diaCerrado(23 * 60)).toBe(true);
  });
});

describe('avanceDeConductores', () => {
  const paradas = [
    { conductorId: 'c1', pedidoId: 'p1' },
    { conductorId: 'c1', pedidoId: 'p2' },
    { conductorId: 'c2', pedidoId: 'p3' },
  ];
  const nombres = new Map([
    ['c1', 'Pérez'],
    ['c2', 'Soto'],
  ]);
  const pedidos = new Map([
    ['p1', pedido({ id: 'p1' })],
    ['p2', pedido({ id: 'p2' })],
    ['p3', pedido({ id: 'p3' })],
  ]);
  const ahoraMs = Date.parse('2026-08-03T20:00:00.000Z');

  it('durante el día NO declara rezagados: a las 10 AM la palabra no significa nada', () => {
    const avance = avanceDeConductores({
      paradas,
      nombres,
      registros: new Map(),
      pedidos,
      ahoraMs,
      diaCerrado: false,
    });
    expect(avance.every((c) => c.rezagados === null)).toBe(true);
  });

  it('después del cierre, los pendientes pasan a ser paquetes rezagados', () => {
    const avance = avanceDeConductores({
      paradas,
      nombres,
      registros: new Map(),
      pedidos,
      ahoraMs,
      diaCerrado: true,
    });
    expect(avance.find((c) => c.id === 'c1')?.rezagados).toBe(2);
  });

  it('cuenta completados con el cierre de Rutax y ordena por cuánto falta', () => {
    const avance = avanceDeConductores({
      paradas,
      nombres,
      registros: unificarRegistros([registro({ pedidoId: 'p1' })]),
      pedidos,
      ahoraMs,
      diaCerrado: false,
    });

    const perez = avance.find((c) => c.id === 'c1');
    expect(perez).toMatchObject({ asignados: 2, completados: 1, pendientes: 1 });
    // Pérez y Soto quedan con 1 pendiente cada uno: desempata el nombre.
    expect(avance.map((c) => c.nombre)).toEqual(['Pérez', 'Soto']);
  });

  it('el que más pendientes tiene va primero', () => {
    const avance = avanceDeConductores({
      paradas,
      nombres,
      registros: new Map(),
      pedidos,
      ahoraMs,
      diaCerrado: false,
    });
    expect(avance[0].id).toBe('c1');
  });

  it('mide los minutos sin registrar desde el ÚLTIMO cierre del conductor', () => {
    const avance = avanceDeConductores({
      paradas,
      nombres,
      registros: unificarRegistros([
        registro({ pedidoId: 'p1', registradoEn: '2026-08-03T18:00:00.000Z' }),
        registro({ pedidoId: 'p2', registradoEn: '2026-08-03T19:30:00.000Z' }),
      ]),
      pedidos,
      ahoraMs,
      diaCerrado: false,
    });
    expect(avance.find((c) => c.id === 'c1')?.minutosSinRegistrar).toBe(30);
  });

  it('un conductor que no ha cerrado nada no tiene minutaje inventado', () => {
    const avance = avanceDeConductores({
      paradas,
      nombres,
      registros: new Map(),
      pedidos,
      ahoraMs,
      diaCerrado: false,
    });
    expect(avance[0].minutosSinRegistrar).toBeNull();
    expect(avance[0].ultimoRegistroEn).toBeNull();
  });
});

// =============================================================================
// Frescura — F6
// =============================================================================

describe('calcularFrescura', () => {
  const ahoraMs = Date.parse('2026-08-03T20:00:00.000Z');

  it('sin ningún registro NO está atrasada: el courier recién empieza el día', () => {
    expect(calcularFrescura([], ahoraMs)).toEqual({
      ultimoRegistroEn: null,
      edadMinutos: null,
      atrasada: false,
    });
  });

  it('toma el registro más reciente de todos los conductores', () => {
    const frescura = calcularFrescura(
      [
        registro({ pedidoId: 'p1', registradoEn: '2026-08-03T18:00:00.000Z' }),
        registro({ pedidoId: 'p2', registradoEn: '2026-08-03T19:50:00.000Z' }),
      ],
      ahoraMs,
    );
    expect(frescura.edadMinutos).toBe(10);
    expect(frescura.atrasada).toBe(false);
  });

  it('pasado el umbral, deja de estar callada', () => {
    const viejo = new Date(ahoraMs - (UMBRAL_FRESCURA_MINUTOS + 1) * 60_000).toISOString();
    const frescura = calcularFrescura([registro({ pedidoId: 'p1', registradoEn: viejo })], ahoraMs);
    expect(frescura.atrasada).toBe(true);
  });

  it('justo en el umbral todavía calla: el borde no dispara', () => {
    const borde = new Date(ahoraMs - UMBRAL_FRESCURA_MINUTOS * 60_000).toISOString();
    expect(calcularFrescura([registro({ pedidoId: 'p1', registradoEn: borde })], ahoraMs).atrasada).toBe(
      false,
    );
  });
});
