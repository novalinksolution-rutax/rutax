/**
 * Pruebas del adaptador de Google Route Optimization.
 * =====================================================================
 *
 * La mitad importante de este archivo es la del canal 3
 * (`docs/seguridad/punto-de-termino-conductor.md` §4.3): **la polilínea del
 * tramo final hacia el punto de término del conductor no puede salir del
 * adaptador**. Google la devuelve —se la pedimos con `endLocation`— y dibujarla
 * en el mapa del coordinador sería enseñarle el camino a la casa de su
 * trabajador.
 *
 * Por eso se prueba con CONTRAPRUEBA: no basta con ver que la salida con ancla
 * está recortada; hay que ver que es IDÉNTICA a la salida sin ancla, que es la
 * condición dura del §4 (negarse no puede quedar a la vista del jefe).
 */

import { describe, expect, it } from 'vitest';

import {
  interpretarRespuesta,
  segundosDesdeDuracion,
  tramosVisibles,
} from './google-route-optimization';
import type { ParadaAOptimizar } from '../tipos-optimizacion';

const PARADAS: ParadaAOptimizar[] = [
  { pedidoId: 'ped-A', lat: -33.42, long: -70.61 },
  { pedidoId: 'ped-B', lat: -33.44, long: -70.65 },
  { pedidoId: 'ped-C', lat: -33.46, long: -70.68 },
];

/** La forma que consume el adaptador, anotada para poder variar cada caso. */
interface VisitaFalsa {
  shipmentIndex?: number;
  isPickup?: boolean;
}

/** Tres visitas + los cuatro tramos que Google devuelve CUANDO hay ancla. */
function respuestaConAncla() {
  const visits: VisitaFalsa[] = [
    { shipmentIndex: 0 },
    { shipmentIndex: 1 },
    { shipmentIndex: 2 },
  ];
  return {
    routes: [
      {
        visits,
        transitions: [
          { travelDistanceMeters: 1000, travelDuration: '300s', routePolyline: { points: 'aaa' } },
          { travelDistanceMeters: 2000, travelDuration: '400s', routePolyline: { points: 'bbb' } },
          { travelDistanceMeters: 3000, travelDuration: '500s', routePolyline: { points: 'ccc' } },
          // ⚠️ El tramo a la casa del conductor. NO puede sobrevivir.
          {
            travelDistanceMeters: 9999,
            travelDuration: '999s',
            routePolyline: { points: 'CASA_DEL_CONDUCTOR' },
          },
        ],
      },
    ],
  };
}

/** La misma ruta, pero el conductor NO declaró punto de término. */
function respuestaSinAncla() {
  const r = respuestaConAncla();
  r.routes[0].transitions = r.routes[0].transitions.slice(0, 3);
  return r;
}

describe('segundosDesdeDuracion', () => {
  it('lee el formato Duration de protobuf', () => {
    expect(segundosDesdeDuracion('300s')).toBe(300);
    expect(segundosDesdeDuracion('300.5s')).toBe(300.5);
  });

  it('devuelve 0 ante algo ilegible en vez de tumbar la ruta', () => {
    expect(segundosDesdeDuracion(undefined)).toBe(0);
    expect(segundosDesdeDuracion('no es una duración')).toBe(0);
    expect(segundosDesdeDuracion('-5s')).toBe(0);
  });
});

describe('tramosVisibles — canal 3 del documento de privacidad', () => {
  it('descarta el tramo final hacia el ancla', () => {
    const tramos = tramosVisibles(respuestaConAncla().routes[0].transitions, 3);

    expect(tramos).toHaveLength(3);
    const polilineas = tramos.map((t) => t.polilinea);
    expect(polilineas).toEqual(['aaa', 'bbb', 'ccc']);
    expect(polilineas).not.toContain('CASA_DEL_CONDUCTOR');
  });

  it('nunca deja pasar más tramos que paradas en secuencia', () => {
    // Aunque el proveedor devolviera tramos de más por cualquier razón.
    const deMas = [
      ...respuestaConAncla().routes[0].transitions,
      { travelDistanceMeters: 1, travelDuration: '1s', routePolyline: { points: 'sobra' } },
    ];
    expect(tramosVisibles(deMas, 3)).toHaveLength(3);
  });
});

describe('interpretarRespuesta', () => {
  it('traduce las visitas a la secuencia, en orden y con los pedidos correctos', () => {
    const ruta = interpretarRespuesta(respuestaConAncla(), PARADAS);

    expect(ruta.secuencia).toEqual([
      { pedidoId: 'ped-A', orden: 1 },
      { pedidoId: 'ped-B', orden: 2 },
      { pedidoId: 'ped-C', orden: 3 },
    ]);
  });

  it('respeta el orden que decidió el proveedor, no el de entrada', () => {
    const datos = respuestaConAncla();
    datos.routes[0].visits = [{ shipmentIndex: 2 }, { shipmentIndex: 0 }, { shipmentIndex: 1 }];

    const ruta = interpretarRespuesta(datos, PARADAS);

    expect(ruta.secuencia.map((s) => s.pedidoId)).toEqual(['ped-C', 'ped-A', 'ped-B']);
    expect(ruta.secuencia.map((s) => s.orden)).toEqual([1, 2, 3]);
  });

  it('NO suma el tramo final en los totales — canal 5', () => {
    const ruta = interpretarRespuesta(respuestaConAncla(), PARADAS);

    // 1000 + 2000 + 3000, jamás los 9999 del tramo a la casa.
    expect(ruta.distanciaTotalM).toBe(6000);
    expect(ruta.duracionTotalS).toBe(1200);
  });

  it('CONTRAPRUEBA: la salida es idéntica con ancla y sin ancla', () => {
    const conAncla = interpretarRespuesta(respuestaConAncla(), PARADAS);
    const sinAncla = interpretarRespuesta(respuestaSinAncla(), PARADAS);

    // Es la condición dura del §4: si la salida difiere, el coordinador puede
    // deducir qué conductores declararon su punto de término.
    expect(conAncla).toEqual(sinAncla);
  });

  it('una parada omitida por el proveedor se queda fuera de la secuencia, no rompe', () => {
    const datos = respuestaConAncla();
    datos.routes[0].visits = [{ shipmentIndex: 0 }, { shipmentIndex: 2 }];

    const ruta = interpretarRespuesta(datos, PARADAS);

    // `ped-B` no entra: el RPC la dejará con `orden_ruta` nulo, que es el
    // estado «sin secuencia» que la pantalla ya sabe mostrar.
    expect(ruta.secuencia.map((s) => s.pedidoId)).toEqual(['ped-A', 'ped-C']);
    expect(ruta.tramos).toHaveLength(2);
  });

  it('ignora un shipmentIndex fuera de rango en vez de inventar una parada', () => {
    const datos = respuestaConAncla();
    datos.routes[0].visits = [{ shipmentIndex: 0 }, { shipmentIndex: 99 }];

    const ruta = interpretarRespuesta(datos, PARADAS);

    expect(ruta.secuencia).toEqual([{ pedidoId: 'ped-A', orden: 1 }]);
  });

  it('descarta las visitas de retiro: este modelo solo manda entregas', () => {
    const datos = respuestaConAncla();
    datos.routes[0].visits = [
      { shipmentIndex: 0, isPickup: true },
      { shipmentIndex: 1 },
    ];

    const ruta = interpretarRespuesta(datos, PARADAS);

    expect(ruta.secuencia).toEqual([{ pedidoId: 'ped-B', orden: 1 }]);
  });

  it('lanza si la respuesta no trae ninguna ruta', () => {
    expect(() => interpretarRespuesta({ routes: [] }, PARADAS)).toThrow(
      /no traía ninguna ruta/,
    );
  });
});
