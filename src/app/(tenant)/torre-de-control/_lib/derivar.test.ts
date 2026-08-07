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
  cuentaComoPendiente,
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

  it('ni los entregados ni las incidencias burbujean: la suma es el PENDIENTE', () => {
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
    // 4 + 1. Lo entregado ya no pide ir a ninguna parte, y el `fallido` de la
    // incidencia tampoco: ya se intentó y no vuelve a salir hoy. La placa lo
    // excluye de «faltan», así que la burbuja también — si no, no cuadran.
    expect(total).toBe(5);
  });

  it('un edificio de estados MEZCLADOS cuenta paquete por paquete', () => {
    // El bug que destapó el QA del 2026-08-04. Un punto se clasifica por su
    // pedido REPRESENTANTE, así que contar `pedidos.length` sobre los puntos «no
    // entregados» arrastraba a la burbuja los paquetes ya entregados del mismo
    // portal: la burbuja daba 18 donde la placa decía 13, en dos comunas.
    const edificio = punto({ id: 'a', agrupados: 3 });
    edificio.pedidos[0].estado = 'pendiente';
    edificio.pedidos[1].estado = 'entregado';
    edificio.pedidos[2].estado = 'entregado';

    const total = geoAgrupaciones([edificio], 'Santiago').features.reduce(
      (suma, f) => suma + (f.properties?.cantidad as number),
      0,
    );
    // Uno solo falta en esa dirección, aunque el portal tenga tres paquetes.
    expect(total).toBe(1);
  });

  it('el `+N` del punto NO se reduce: dice cuántos hay, no cuántos faltan', () => {
    // Es la contracara del caso anterior y hay que dejarla explícita: la burbuja
    // cuenta lo que falta, el `+N` cuenta lo que hay en esa dirección. Que no
    // coincidan es correcto — y por eso la ficha pagina los tres.
    const edificio = punto({ id: 'a', agrupados: 3 });
    edificio.pedidos[1].estado = 'entregado';
    edificio.pedidos[2].estado = 'entregado';

    const fc = geoPuntos([edificio]);
    expect(fc.features[0].properties?.agrupados).toBe(3);
  });

  it('un punto donde YA no falta nada deja de burbujear', () => {
    // Su representante puede seguir siendo `pendiente` por prioridad visual, pero
    // si ningún paquete cuenta, la celda no existe.
    const edificio = punto({ id: 'a', agrupados: 2 });
    edificio.pedidos[0].estado = 'entregado';
    edificio.pedidos[1].estado = 'incidencia';

    expect(geoAgrupaciones([edificio], 'Santiago').features).toHaveLength(0);
  });

  it('cuentaComoPendiente es la MISMA definición que usa la placa', () => {
    // Si alguien separa las dos, la suma deja de dar la cifra de la placa y el
    // mapa empieza a mentir sobre la carga. `entregado` y `fallido` son los
    // estados cerrados en `agregacion.ts`; `incidencia` es como llega el fallido
    // al mapa.
    expect(cuentaComoPendiente('pendiente')).toBe(true);
    expect(cuentaComoPendiente('en_ruta')).toBe(true);
    expect(cuentaComoPendiente('entregado')).toBe(false);
    expect(cuentaComoPendiente('incidencia')).toBe(false);
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

  // ---------------------------------------------------------------------------
  // El bug de Puente Alto (QA 2026-08-04)
  // ---------------------------------------------------------------------------

  it('el secano vacío de una comuna grande NO estira el encuadre', () => {
    // Con la unión de CAJAS, la de Colina (0,2° de radio en esta fixture) mandaba
    // el borde norte a -33,0 aunque sus pedidos estuvieran en -33,25. Ese margen
    // vacío empujaba el ajuste contra `zoomMinimo` y el recorte se llevaba el sur.
    const limites = limitesDeLaCarga(
      geo,
      [
        comuna({ nombre: 'Santiago', pendientes: 61, total: 120 }),
        comuna({ nombre: 'Colina', pendientes: 30, total: 48 }),
      ],
      [
        punto({ id: 's', comuna: 'Santiago', posicion: { lat: -33.45, long: -70.66 } }),
        punto({ id: 'c', comuna: 'Colina', posicion: { lat: -33.25, long: -70.67 } }),
      ],
    );
    // El norte lo pone el PEDIDO de Colina (-33,25), no su polígono (-33,0).
    expect(limites![1][1]).toBeCloseTo(-33.25, 5);
  });

  it('la comuna del extremo sur entra en el encuadre', () => {
    // Puente Alto quedaba 0,055° fuera del borde inferior con 39 pendientes.
    const limites = limitesDeLaCarga(
      geo,
      [comuna({ nombre: 'Colina', pendientes: 30 }), comuna({ nombre: 'Puente Alto', pendientes: 39 })],
      [
        punto({ id: 'c', comuna: 'Colina', posicion: { lat: -33.14, long: -70.67 } }),
        punto({ id: 'p', comuna: 'Puente Alto', posicion: { lat: -33.61, long: -70.57 } }),
      ],
    );
    const [[, sur], [, norte]] = limites!;
    expect(sur).toBeLessThanOrEqual(-33.61);
    expect(norte).toBeGreaterThanOrEqual(-33.14);
  });

  it('lo entregado no estira el encuadre: solo la carga viva', () => {
    const limites = limitesDeLaCarga(
      geo,
      [comuna({ nombre: 'Santiago', pendientes: 3 })],
      [
        punto({ id: 'vivo', posicion: { lat: -33.45, long: -70.66 } }),
        punto({ id: 'listo', estado: 'entregado', posicion: { lat: -33.9, long: -71.2 } }),
      ],
    );
    expect(limites![0][1]).toBeCloseTo(-33.45, 5);
  });

  it('sin puntos ubicados se cae a la caja de los polígonos', () => {
    // Día ya cerrado o geocodificación pendiente: peor encuadre, pero la pantalla
    // nunca se queda sin nada que mostrar.
    const limites = limitesDeLaCarga(
      geo,
      [comuna({ nombre: 'Santiago', pendientes: 5 })],
      [punto({ id: 'listo', estado: 'entregado' })],
    );
    expect(limites).not.toBeNull();
    expect(limites![1][1]).toBeCloseTo(-33.42, 5);
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
