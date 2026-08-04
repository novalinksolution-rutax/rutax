/**
 * Pruebas de la derivación de cliente del mapa.
 * =============================================================================
 *
 * Lo que se protege acá es la **regla 5 del alcance: el mapa nunca esconde
 * carga**. Es la que más caro cuesta romper, porque no falla: produce un mapa
 * que se ve perfecto y cuenta menos de lo que hay, y una cifra que no cuadra con
 * la operación real destruye la confianza en toda la pantalla.
 */

import { describe, expect, it } from 'vitest';
import type { ComunaEnTorre, PuntoEntrega } from '@/modules/contexto/contrato-torre';
import {
  geoAgrupaciones,
  geoComunas,
  geoPuntos,
  limitesDeLaCarga,
  pasosDeCarga,
  puntosVisibles,
  PASO_SIN_CARGA,
} from './derivar';
import { claveComuna } from './comunas';
import type { MapaGeometrias } from './geometria';

/**
 * Punto de prueba. `agrupados` es azúcar: genera esa cantidad de pedidos en la
 * ubicación, que es lo que el contrato lleva de verdad.
 */
function punto(
  over: Partial<PuntoEntrega> & { id: string; agrupados?: number },
): PuntoEntrega {
  const { agrupados = 1, ...resto } = over;
  return {
    posicion: { lat: -33.45, long: -70.66 },
    estado: 'pendiente',
    comuna: 'Santiago',
    conductorId: null,
    cercaDelCorte: false,
    pedidos: Array.from({ length: agrupados }, (_, i) => ({
      id: `${over.id}-${i}`,
      codigoEnvio: 'FLEX-1',
      estado: (resto.estado ?? 'pendiente') as PuntoEntrega['estado'],
      conductorNombre: null,
      sellerNombre: null,
      intentosPrevios: 0,
    })),
    ...resto,
  };
}

function comuna(over: Partial<ComunaEnTorre> & { nombre: string }): ComunaEnTorre {
  return {
    pendientes: 0,
    total: 0,
    entregados: 0,
    incidenciasAbiertas: 0,
    enRiesgoDeCorte: 0,
    centro: { lat: -33.45, long: -70.66 },
    zonaId: null,
    ...over,
  };
}

/** Geometría de mentira: solo hace falta que exista una entrada por comuna. */
function geometrias(...nombres: string[]): MapaGeometrias {
  return new Map(
    nombres.map((n) => [
      claveComuna(n),
      {
        type: 'Feature' as const,
        geometry: { type: 'Polygon' as const, coordinates: [] },
        properties: { comuna: n, cut: '13101' },
      },
    ]),
  );
}

// =============================================================================
// Regla 5 — la suma de lo dibujado da el pendiente
// =============================================================================

describe('la suma de lo dibujado cuadra con el pendiente de la comuna', () => {
  it('una burbuja suma PEDIDOS, no puntos', () => {
    // Un punto de edificio vale por todos sus pedidos. Contando puntos, la suma
    // de las burbujas queda por debajo de la cifra de la placa y el mapa esconde
    // carga sin que nada falle.
    const puntos = [
      punto({ id: 'a', agrupados: 3 }),
      punto({ id: 'b', agrupados: 1 }),
      punto({ id: 'c', agrupados: 5 }),
    ];
    const total = geoAgrupaciones(puntos, 'Santiago').features.reduce(
      (suma, f) => suma + (f.properties?.cantidad as number),
      0,
    );
    expect(total).toBe(9);
  });

  it('los entregados no burbujean, y por eso la suma es el PENDIENTE y no el total', () => {
    const puntos = [
      punto({ id: 'a', agrupados: 4 }),
      punto({ id: 'b', estado: 'entregado', agrupados: 7 }),
      punto({ id: 'c', estado: 'incidencia', agrupados: 2 }),
      punto({ id: 'd', estado: 'en_ruta', agrupados: 1 }),
    ];
    const total = geoAgrupaciones(puntos, 'Santiago').features.reduce(
      (suma, f) => suma + (f.properties?.cantidad as number),
      0,
    );
    // 4 + 2 + 1: lo entregado ya no pide ir a ninguna parte.
    expect(total).toBe(7);
  });

  it('reparte en celdas distintas sin perder ni duplicar pedidos', () => {
    const puntos = [
      punto({ id: 'a', posicion: { lat: -33.45, long: -70.66 }, agrupados: 2 }),
      punto({ id: 'b', posicion: { lat: -33.45, long: -70.66 }, agrupados: 1 }),
      // A ~4 km: otra celda.
      punto({ id: 'c', posicion: { lat: -33.49, long: -70.7 }, agrupados: 6 }),
    ];
    const fc = geoAgrupaciones(puntos, 'Santiago');
    expect(fc.features).toHaveLength(2);
    expect(fc.features.reduce((s, f) => s + (f.properties?.cantidad as number), 0)).toBe(9);
  });

  it('el centro de la burbuja es el promedio de sus puntos, no el de la celda', () => {
    // Una burbuja en el centro geométrico de la celda puede caer en medio de un
    // parque vacío y miente sobre dónde está la carga.
    const fc = geoAgrupaciones(
      [
        punto({ id: 'a', posicion: { lat: -33.451, long: -70.661 } }),
        punto({ id: 'b', posicion: { lat: -33.453, long: -70.663 } }),
      ],
      'Santiago',
    );
    const [long, lat] = fc.features[0].geometry.coordinates;
    expect(long).toBeCloseTo(-70.662, 6);
    expect(lat).toBeCloseTo(-33.452, 6);
  });

  it('la burbuja lleva su celda, y sus puntos la reconocen', () => {
    // Es lo que permite atenuar lo ajeno al abrir una burbuja. Sin este cruce,
    // una burbuja de 4 se abría mezclada con los puntos de las vecinas y la
    // cuenta —4 paquetes en 2 puntos, uno de ellos un edificio de 3— no se podía
    // hacer de un vistazo.
    const dentro = punto({ id: 'a', posicion: { lat: -33.45, long: -70.66 }, agrupados: 3 });
    const fuera = punto({ id: 'b', posicion: { lat: -33.49, long: -70.7 } });
    const celda = geoAgrupaciones([dentro, fuera], 'Santiago').features.find(
      (f) => f.properties?.cantidad === 3,
    )?.properties?.celda as string;

    const fc = geoPuntos([dentro, fuera], celda);
    const porId = new Map(fc.features.map((f) => [f.properties?.id, f.properties?.foraneo]));
    expect(porId.get('a')).toBe(false);
    expect(porId.get('b')).toBe(true);
  });

  it('sin agrupación abierta ningún punto es foráneo', () => {
    const fc = geoPuntos([punto({ id: 'a' }), punto({ id: 'b' })]);
    expect(fc.features.every((f) => f.properties?.foraneo === false)).toBe(true);
  });

  it('SIN comuna activa no hay ni una burbuja', () => {
    // Es lo que hace que acercarse con la rueda se sienta limpio: sin haber
    // elegido nada, el mapa no se llena de globos de toda la ciudad. La burbuja
    // es el resumen DE UNA COMUNA, y un resumen de todo a la vez no resume nada.
    const fc = geoAgrupaciones([punto({ id: 'a' }), punto({ id: 'b' })], null);
    expect(fc.features).toHaveLength(0);
  });
});

// =============================================================================
// La ciudad no depende del conteo
// =============================================================================

describe('geoComunas', () => {
  it('dibuja TODAS las comunas aunque hoy no haya un solo pedido', () => {
    // Es el estado `sin_pedidos`: la ciudad no desaparece porque sea domingo.
    // Antes los polígonos se derivaban de la lista del composer y el mapa
    // quedaba en blanco, que se lee como pantalla rota.
    const fc = geoComunas(geometrias('Santiago', 'Ñuñoa', 'Maipú'), [], null);
    expect(fc.features).toHaveLength(3);
  });

  it('la comuna sin carga NO se pinta: el azul significa «acá queda algo»', () => {
    // El paso 0 es el escalón más bajo de la rampa, no «nada». Usarlo para las
    // comunas vacías pintaba las 52 de la RM tuvieran pedidos o no, y una capa
    // que está en todas partes no informa de ninguna. El polígono sigue
    // dibujado — lo mantiene su borde—, pero sin relleno.
    const fc = geoComunas(
      geometrias('Santiago', 'Ñuñoa'),
      [comuna({ nombre: 'Santiago', pendientes: 12, total: 30 })],
      null,
    );
    const porNombre = new Map(fc.features.map((f) => [f.properties?.nombre, f.properties?.paso]));
    expect(porNombre.get('Santiago')).toBeGreaterThanOrEqual(0);
    expect(porNombre.get('Ñuñoa')).toBe(PASO_SIN_CARGA);
  });

  it('empareja la carga con la geometría ignorando acentos y caja', () => {
    const fc = geoComunas(
      geometrias('Ñuñoa'),
      [comuna({ nombre: 'ÑUÑOA', pendientes: 12, total: 30 })],
      null,
    );
    expect(fc.features[0].properties?.pendientes).toBe(12);
  });

  it('la activa es la SELECCIONADA, y es la única', () => {
    // El velo lo produce la selección, no el zoom: la capa de velo filtra por
    // `!activa`, así que marcar de más apagaría media ciudad sin que nadie lo
    // haya pedido.
    const fc = geoComunas(
      geometrias('Santiago', 'Ñuñoa'),
      [comuna({ nombre: 'Santiago' }), comuna({ nombre: 'Ñuñoa' })],
      'Ñuñoa',
    );
    expect(fc.features.filter((f) => f.properties?.activa)).toHaveLength(1);
    expect(fc.features.find((f) => f.properties?.activa)?.properties?.nombre).toBe('Ñuñoa');
  });
});

// =============================================================================
// Encuadre de entrada — regla 5: el mapa nunca esconde carga
// =============================================================================

/** Geometría con un cuadrado real alrededor de un punto, para medir cajas. */
function cuadrado(nombre: string, lat: number, long: number, lado: number): MapaGeometrias {
  return new Map([
    [
      claveComuna(nombre),
      {
        type: 'Feature' as const,
        geometry: {
          type: 'Polygon' as const,
          coordinates: [
            [
              [long - lado, lat - lado],
              [long + lado, lat - lado],
              [long + lado, lat + lado],
              [long - lado, lat + lado],
              [long - lado, lat - lado],
            ],
          ],
        },
        properties: { comuna: nombre, cut: '13101' },
      },
    ],
  ]);
}

describe('limitesDeLaCarga', () => {
  const geo: MapaGeometrias = new Map([
    ...cuadrado('Santiago', -33.45, -70.66, 0.03),
    // Muy al norte, como Colina: es el caso que el encuadre fijo dejaba fuera.
    ...cuadrado('Colina', -33.2, -70.67, 0.2),
  ]);

  it('la caja abarca también la comuna periférica', () => {
    // Con `ENCUADRE_RM` fijo, una comuna con 30 pendientes en Colina quedaba
    // fuera de pantalla: no se pintaba, su placa no aparecía, y solo se
    // descubría entrando a la pestaña de comunas. Eso es esconder carga.
    const limites = limitesDeLaCarga(geo, [
      comuna({ nombre: 'Santiago', pendientes: 61, total: 120 }),
      comuna({ nombre: 'Colina', pendientes: 30, total: 48 }),
    ]);
    expect(limites).not.toBeNull();
    // El norte lo pone Colina (-33.0), no Santiago (-33.42).
    expect(limites![1][1]).toBeCloseTo(-33.0, 5);
  });

  it('las comunas sin carga no estiran el encuadre', () => {
    // Encuadrar la ciudad entera por una comuna que hoy no reparte nada dejaría
    // la carga real diminuta en el centro.
    const limites = limitesDeLaCarga(geo, [
      comuna({ nombre: 'Santiago', pendientes: 61, total: 120 }),
      comuna({ nombre: 'Colina', pendientes: 0, total: 0 }),
    ]);
    expect(limites![1][1]).toBeCloseTo(-33.42, 5);
  });

  it('sin carga devuelve null y manda el encuadre por defecto', () => {
    expect(limitesDeLaCarga(geo, [])).toBeNull();
    expect(limitesDeLaCarga(geo, [comuna({ nombre: 'Santiago', pendientes: 0 })])).toBeNull();
  });

  it('una comuna sin geometría no rompe el encuadre', () => {
    const limites = limitesDeLaCarga(geo, [
      comuna({ nombre: 'Santiago', pendientes: 5 }),
      comuna({ nombre: 'Comuna Fantasma', pendientes: 9 }),
    ]);
    expect(limites).not.toBeNull();
  });
});

// =============================================================================
// Rampa de carga
// =============================================================================

describe('pasosDeCarga', () => {
  it('reparte los cuatro pasos por cuantil, no por umbrales absolutos', () => {
    // Con umbrales fijos, un courier de 40 paquetes caería entero en el paso 0 y
    // uno de 4.000 entero en el 3: la rampa dejaría de distinguir en ambos.
    const pasos = pasosDeCarga([
      comuna({ nombre: 'A', pendientes: 1 }),
      comuna({ nombre: 'B', pendientes: 5 }),
      comuna({ nombre: 'C', pendientes: 20 }),
      comuna({ nombre: 'D', pendientes: 90 }),
    ]);
    expect([...new Set(pasos.values())].sort()).toEqual([0, 1, 2, 3]);
  });

  it('las comunas sin carga no entran al cálculo', () => {
    // Si entraran, un día tranquilo con dos comunas activas repartiría los
    // cuatro pasos entre 50 ceros y arruinaría los cortes.
    const pasos = pasosDeCarga([
      comuna({ nombre: 'A', pendientes: 0 }),
      comuna({ nombre: 'B', pendientes: 10 }),
    ]);
    expect(pasos.has(claveComuna('A'))).toBe(false);
    expect(pasos.has(claveComuna('B'))).toBe(true);
  });
});

// =============================================================================
// Filtro por comuna activa
// =============================================================================

describe('puntosVisibles', () => {
  it('sin comuna activa se ven todos', () => {
    expect(puntosVisibles([punto({ id: 'a' }), punto({ id: 'b' })], null)).toHaveLength(2);
  });

  it('con comuna activa se ven solo los suyos, comparando normalizado', () => {
    const puntos = [
      punto({ id: 'a', comuna: 'Ñuñoa' }),
      punto({ id: 'b', comuna: 'Santiago' }),
      punto({ id: 'c', comuna: null }),
    ];
    expect(puntosVisibles(puntos, 'ÑUÑOA').map((p) => p.id)).toEqual(['a']);
  });
});
