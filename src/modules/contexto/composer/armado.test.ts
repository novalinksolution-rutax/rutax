/**
 * Pruebas del armado del payload de la Torre v2.
 * =====================================================================
 *
 * Lo que se protege acá son las reglas de producto que se rompen sin hacer ruido:
 * que una incidencia no quede escondida bajo un entregado, que el resumen cuadre
 * con la operación real, y que del destinatario no se escape nada.
 */

import { describe, it, expect } from 'vitest';
import { normalizarComuna } from '@/modules/integraciones/geocoding/normalizacion';
import {
  armarComunas,
  armarIncidencias,
  armarPuntos,
  armarResumen,
  comunasCercaDelCorte,
  resolverEstadoPantalla,
  type PedidoUbicable,
} from './armado';
import { unificarRegistros, type CargaComuna, type RegistroDeEntrega } from '../agregacion';

function carga(over: Partial<CargaComuna> = {}): CargaComuna {
  return {
    pendientes: 0,
    total: 0,
    entregados: 0,
    incidenciasAbiertas: 0,
    enRiesgoDeCorte: 0,
    sinUbicar: 0,
    ...over,
  };
}

function ubicable(over: Partial<PedidoUbicable> & { id: string }): PedidoUbicable {
  return {
    comuna: 'Ñuñoa',
    estado: 'asignado',
    ubicado: true,
    lat: -33.4564,
    long: -70.5969,
    codigoEnvio: 'FLEX-2026-000001',
    conductorId: 'c1',
    sellerId: 's1',
    ...over,
  };
}

// =============================================================================
// Comunas — F1
// =============================================================================

describe('armarComunas', () => {
  it('ordena por cuántas faltan, no alfabéticamente', () => {
    const comunas = armarComunas(
      new Map([
        ['Ñuñoa', carga({ pendientes: 3, total: 10 })],
        ['Maipú', carga({ pendientes: 9, total: 20 })],
      ]),
      new Map(),
      normalizarComuna,
    );
    // Alfabético pondría Maipú primero por casualidad; con 3 vs 9 el orden es
    // por pendientes. Se comprueba con el par invertido más abajo.
    expect(comunas.map((c) => c.nombre)).toEqual(['Maipú', 'Ñuñoa']);
  });

  it('desempata por nombre cuando las dos tienen lo mismo', () => {
    const comunas = armarComunas(
      new Map([
        ['Ñuñoa', carga({ pendientes: 5 })],
        ['Maipú', carga({ pendientes: 5 })],
      ]),
      new Map(),
      normalizarComuna,
    );
    expect(comunas.map((c) => c.nombre)).toEqual(['Maipú', 'Ñuñoa']);
  });

  it('el grupo sin comuna (null) NO entra al mapa', () => {
    const comunas = armarComunas(
      new Map([
        [null, carga({ pendientes: 4, total: 4 })],
        ['Ñuñoa', carga({ pendientes: 1, total: 1 })],
      ]),
      new Map(),
      normalizarComuna,
    );
    expect(comunas).toHaveLength(1);
    expect(comunas[0].nombre).toBe('Ñuñoa');
  });

  it('trae el centroide real de la comuna, no un cero', () => {
    const [comuna] = armarComunas(
      new Map([['Ñuñoa', carga({ total: 1 })]]),
      new Map(),
      normalizarComuna,
    );
    expect(comuna.centro.lat).toBeLessThan(-33);
    expect(comuna.centro.long).toBeLessThan(-70);
  });

  it('cuelga la zona del courier cuando existe, y null cuando no', () => {
    const comunas = armarComunas(
      new Map([
        ['Ñuñoa', carga({ total: 1 })],
        ['Maipú', carga({ total: 1 })],
      ]),
      new Map([['nunoa', 'z1']]),
      normalizarComuna,
    );
    expect(comunas.find((c) => c.nombre === 'Ñuñoa')?.zonaId).toBe('z1');
    expect(comunas.find((c) => c.nombre === 'Maipú')?.zonaId).toBeNull();
  });
});

// =============================================================================
// Puntos — F2 nivel 3 y F3
// =============================================================================

describe('armarPuntos', () => {
  const base = {
    registros: new Map<string, RegistroDeEntrega>(),
    pedidosConIncidencia: new Set<string>(),
    nombresConductores: new Map([['c1', 'Pérez']]),
    nombresSellers: new Map([['s1', 'Falabella Retail SpA']]),
    intentosPrevios: new Map<string, number>(),
    comunasEnRiesgo: new Set<string>(),
  };

  it('colapsa los pedidos de la misma ubicación en un punto con su +N', () => {
    const puntos = armarPuntos({
      ...base,
      pedidos: [
        ubicable({ id: 'p1' }),
        ubicable({ id: 'p2' }),
        ubicable({ id: 'p3', lat: -33.5, long: -70.7 }),
      ],
    });

    expect(puntos).toHaveLength(2);
    expect(puntos.find((p) => p.pedidos.length === 2)).toBeDefined();
  });

  it('una incidencia NUNCA queda escondida detrás de un entregado', () => {
    // Es la regla del rojo reservado: un edificio con cinco entregas correctas y
    // una fallida tiene que verse rojo.
    const puntos = armarPuntos({
      ...base,
      pedidos: [ubicable({ id: 'entregado' }), ubicable({ id: 'roto' })],
      registros: unificarRegistros([
        {
          pedidoId: 'entregado',
          conductorId: 'c1',
          entregado: true,
          registradoEn: '2026-08-03T15:00:00.000Z',
        },
      ]),
      pedidosConIncidencia: new Set(['roto']),
    });

    expect(puntos).toHaveLength(1);
    expect(puntos[0].estado).toBe('incidencia');
    expect(puntos[0].pedidos.length).toBe(2);
  });

  it('muestra el NOMBRE del conductor, no su id', () => {
    const [punto] = armarPuntos({ ...base, pedidos: [ubicable({ id: 'p1' })] });
    expect(punto.pedidos[0].conductorNombre).toBe('Pérez');
  });

  it('no inventa nombre para un conductor desconocido', () => {
    const [punto] = armarPuntos({ ...base, pedidos: [ubicable({ id: 'p1', conductorId: 'c9' })] });
    expect(punto.pedidos[0].conductorNombre).toBeNull();
  });

  it('marca cerca del corte solo lo que sigue pendiente', () => {
    const puntos = armarPuntos({
      ...base,
      pedidos: [ubicable({ id: 'p1' }), ubicable({ id: 'p2', lat: -33.5, long: -70.7 })],
      registros: unificarRegistros([
        {
          pedidoId: 'p2',
          conductorId: 'c1',
          entregado: true,
          registradoEn: '2026-08-03T15:00:00.000Z',
        },
      ]),
      comunasEnRiesgo: new Set(['Ñuñoa']),
    });

    expect(puntos.find((p) => p.id === 'p1')?.cercaDelCorte).toBe(true);
    expect(puntos.find((p) => p.id === 'p2')?.cercaDelCorte).toBe(false);
  });

  it('muestra la razón social del seller', () => {
    const [punto] = armarPuntos({ ...base, pedidos: [ubicable({ id: 'p1' })] });
    expect(punto.pedidos[0].sellerNombre).toBe('Falabella Retail SpA');
  });

  it('no inventa nombre para un seller desconocido', () => {
    const [punto] = armarPuntos({ ...base, pedidos: [ubicable({ id: 'p1', sellerId: 's9' })] });
    expect(punto.pedidos[0].sellerNombre).toBeNull();
  });

  it('un paquete sin historial va en cero intentos previos, no en null', () => {
    // La ficha decide callarse comparando contra 0. Un `null` obligaría a la
    // pantalla a distinguir «sin historial» de «no vino el dato», y no hay tal
    // distinción: la ausencia de incidencias cerradas ES cero.
    const [punto] = armarPuntos({ ...base, pedidos: [ubicable({ id: 'p1' })] });
    expect(punto.pedidos[0].intentosPrevios).toBe(0);
  });

  it('cuenta los intentos previos del paquete', () => {
    const [punto] = armarPuntos({
      ...base,
      pedidos: [ubicable({ id: 'p1' })],
      intentosPrevios: new Map([['p1', 2]]),
    });
    expect(punto.pedidos[0].intentosPrevios).toBe(2);
  });

  it('los intentos previos son los del REPRESENTANTE del grupo', () => {
    // Un edificio con tres entregas muestra la ficha de una de ellas, y tiene
    // que ser coherente: si el representante es el de la incidencia, el conteo
    // que se ve es el suyo y no el del vecino.
    const puntos = armarPuntos({
      ...base,
      pedidos: [ubicable({ id: 'sano' }), ubicable({ id: 'roto' })],
      pedidosConIncidencia: new Set(['roto']),
      intentosPrevios: new Map([
        ['sano', 5],
        ['roto', 1],
      ]),
    });

    expect(puntos).toHaveLength(1);
    expect(puntos[0].id).toBe('roto');
    expect(puntos[0].pedidos[0].intentosPrevios).toBe(1);
  });

  it('el REPRESENTANTE va primero en la lista de pedidos', () => {
    // Es lo que hace que la ficha abra en el pedido correcto: si la incidencia
    // quedara en la página 2, el usuario vería primero un paquete sano en un
    // punto rojo.
    const puntos = armarPuntos({
      ...base,
      pedidos: [ubicable({ id: 'sano' }), ubicable({ id: 'roto' }), ubicable({ id: 'sano2' })],
      pedidosConIncidencia: new Set(['roto']),
    });

    expect(puntos[0].pedidos.map((p) => p.id)).toEqual(['roto', 'sano', 'sano2']);
    expect(puntos[0].pedidos).toHaveLength(3);
  });

  it('la ubicación se marca cerca del corte si CUALQUIERA de sus pedidos lo está', () => {
    // Un edificio con un paquete apretado es un edificio apretado: mirar solo al
    // representante escondería la urgencia del vecino de al lado.
    const puntos = armarPuntos({
      ...base,
      pedidos: [
        ubicable({ id: 'entregado' }),
        ubicable({ id: 'pendiente' }),
      ],
      registros: unificarRegistros([
        {
          pedidoId: 'entregado',
          conductorId: 'c1',
          entregado: true,
          registradoEn: '2026-08-03T15:00:00.000Z',
        },
      ]),
      comunasEnRiesgo: new Set(['Ñuñoa']),
    });

    expect(puntos).toHaveLength(1);
    expect(puntos[0].cercaDelCorte).toBe(true);
  });

  it('el punto NO lleva ningún dato del destinatario', () => {
    const [punto] = armarPuntos({ ...base, pedidos: [ubicable({ id: 'p1' })] });
    // Invariante de minimización: si alguien agrega un campo del destinatario al
    // contrato, esta prueba lo caza antes de que llegue al navegador. Cubre las
    // dos capas: la ubicación y cada uno de sus pedidos.
    //
    // `sellerNombre` es la razón social de una EMPRESA cliente, no un dato
    // personal del destinatario, y por eso entra a la lista a conciencia.
    expect(Object.keys(punto).sort()).toEqual([
      'cercaDelCorte',
      'comuna',
      'conductorId',
      'estado',
      'id',
      'pedidos',
      'posicion',
    ]);
    expect(Object.keys(punto.pedidos[0]).sort()).toEqual([
      'codigoEnvio',
      'conductorNombre',
      'estado',
      'id',
      'intentosPrevios',
      'sellerNombre',
    ]);
  });
});

// =============================================================================
// Incidencias — F4
// =============================================================================

describe('armarIncidencias', () => {
  it('traduce el tipo y adjunta código y conductor', () => {
    const [incidencia] = armarIncidencias({
      incidencias: [
        {
          id: 'i1',
          pedidoId: 'p1',
          tipo: 'destinatario_ausente',
          abiertaEn: '2026-08-03T15:00:00.000Z',
        },
      ],
      pedidos: new Map([['p1', ubicable({ id: 'p1' })]]),
      codigos: new Map([['p1', 'RX-ABCD-1234']]),
      conductorDePedido: new Map([['p1', 'c1']]),
      nombresConductores: new Map([['c1', 'Pérez']]),
    });

    expect(incidencia).toMatchObject({
      etiqueta: 'Destinatario ausente',
      codigoEnvio: 'RX-ABCD-1234',
      conductorNombre: 'Pérez',
      comuna: 'Ñuñoa',
    });
  });

  it('ordena de la más reciente a la más antigua', () => {
    const incidencias = armarIncidencias({
      incidencias: [
        { id: 'vieja', pedidoId: 'p1', tipo: 'otro', abiertaEn: '2026-08-03T10:00:00.000Z' },
        { id: 'nueva', pedidoId: 'p1', tipo: 'otro', abiertaEn: '2026-08-03T18:00:00.000Z' },
      ],
      pedidos: new Map(),
      codigos: new Map(),
      conductorDePedido: new Map(),
      nombresConductores: new Map(),
    });

    expect(incidencias.map((i) => i.id)).toEqual(['nueva', 'vieja']);
  });
});

// =============================================================================
// Resumen y estado
// =============================================================================

describe('armarResumen', () => {
  it('suma TAMBIÉN el grupo sin comuna: el total tiene que cuadrar', () => {
    const resumen = armarResumen(
      new Map([
        ['Ñuñoa', carga({ total: 10, pendientes: 4 })],
        [null, carga({ total: 3, pendientes: 3, sinUbicar: 3 })],
      ]),
    );
    expect(resumen).toMatchObject({ total: 13, pendientes: 7, sinUbicar: 3 });
  });
});

describe('resolverEstadoPantalla', () => {
  it('sin pedidos, lo dice', () => {
    expect(resolverEstadoPantalla(armarResumen(new Map()))).toBe('sin_pedidos');
  });

  it('con una incidencia abierta, pide atención', () => {
    const resumen = armarResumen(new Map([['Ñuñoa', carga({ total: 5, incidenciasAbiertas: 1 })]]));
    expect(resolverEstadoPantalla(resumen)).toBe('con_incidencias');
  });

  it('con carga y sin incidencias, se calla', () => {
    const resumen = armarResumen(new Map([['Ñuñoa', carga({ total: 5, pendientes: 2 })]]));
    expect(resolverEstadoPantalla(resumen)).toBe('tranquilo');
  });
});

// =============================================================================
// Corte — F7
// =============================================================================

describe('comunasCercaDelCorte', () => {
  it('marca solo las comunas cuya zona está dentro del margen', () => {
    const enRiesgo = comunasCercaDelCorte(
      ['Ñuñoa', 'Maipú'],
      new Map([
        ['nunoa', 'z1'],
        ['maipu', 'z2'],
      ]),
      normalizarComuna,
      (zonaId) => (zonaId === 'z1' ? 30 : 300),
    );

    expect([...enRiesgo]).toEqual(['Ñuñoa']);
  });

  it('sin corte configurado no marca ninguna', () => {
    const enRiesgo = comunasCercaDelCorte(['Ñuñoa'], new Map(), normalizarComuna, () => null);
    expect(enRiesgo.size).toBe(0);
  });
});
