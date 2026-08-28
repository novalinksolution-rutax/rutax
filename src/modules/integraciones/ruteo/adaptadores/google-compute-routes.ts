/**
 * Adaptador de TRAZADO — la geometría de un orden que ya está decidido.
 * =============================================================================
 *
 * 🔴 **Por qué existe (2026-08-27).** `resolverRuta` no llama al optimizador
 * cuando hay paradas fijadas, y con razón: un solver al que le pides que
 * reordene y además respete una parada clavada en el medio devuelve una
 * geometría que ya no une los pines que la pantalla dibuja. Así que caía al
 * motor local, que mide en línea recta.
 *
 * Eso estaba bien mientras fijar fuera raro. Dejó de estarlo el día que el
 * conductor pudo arrastrar una parada o tocar «Ir a esta ahora»: **desde
 * entonces fijar es lo normal**, y tocar el orden una vez costaba la geometría
 * de calle de todo el día. En el mapa se veía como una ruta punteada que va a
 * ninguna parte.
 *
 * =============================================================================
 * ESTE NO DECIDE NADA. SOLO DIBUJA
 * =============================================================================
 * `optimizarRuta` (Route Optimization) responde **en qué orden ir**.
 * `trazarRuta` (Compute Routes) responde **por dónde pasa la calle** de un
 * orden que ya tomó otro. Son dos APIs distintas y dos facturas distintas.
 *
 * La distinción importa al mirar el gasto: Route Optimization cobra **por
 * parada**; Compute Routes cobra **por petición**. Trazar 30 paradas cuesta lo
 * mismo que trazar 3.
 *
 * =============================================================================
 * ⚠️ EL TOPE DE 25 PUNTOS INTERMEDIOS, Y POR ESO SE PARTE EN TRAMOS
 * =============================================================================
 * Compute Routes acepta un máximo de **25 `intermediates`** por petición. Una
 * ruta de 30 paradas no cabe, así que se parte y se cosen las piernas.
 *
 * El corte **repite el punto de unión**: el último de un pedazo es el primero
 * del siguiente. Sin eso faltaría la pierna que los une y el trazado tendría un
 * hueco justo donde nadie lo busca.
 *
 * =============================================================================
 * ⚠️ EL TRAMO FINAL NO SE PIDE — CANAL 3
 * =============================================================================
 * Igual que el optimizador: la polilínea **termina en la última parada**. El
 * punto de término del conductor no entra en esta llamada ni siquiera como
 * destino, porque acá el destino sí saldría dibujado. Ver
 * `docs/seguridad/punto-de-termino-conductor.md` §4.3.
 */

import { ErrorRuteoProveedor } from '../errores';
import { leerProyectoGoogle, obtenerTokenAcceso } from './google-credenciales';
import type { Punto } from '@/lib/geo/distancia';
import type { TramoRuta } from '../tipos-optimizacion';

const TIMEOUT_MS = 20_000;

/** Lo que Compute Routes acepta por petición. Google lo impone, no nosotros. */
const MAX_INTERMEDIOS = 25;

interface RespuestaComputeRoutes {
  routes?: {
    legs?: {
      distanceMeters?: number;
      duration?: string;
      polyline?: { encodedPolyline?: string };
    }[];
  }[];
}

/** `"1234s"` → `1234`. Google devuelve la duración como texto con sufijo. */
function segundos(duracion: string | undefined): number {
  if (!duracion) return 0;
  const n = Number.parseFloat(duracion.replace(/s$/, ''));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function comoWaypoint(p: Punto) {
  return { location: { latLng: { latitude: p.lat, longitude: p.long } } };
}

/**
 * Parte una lista de puntos en pedazos que quepan en una petición.
 *
 * Cada pedazo lleva `MAX_INTERMEDIOS + 2` puntos (origen + intermedios +
 * destino) y **empieza donde terminó el anterior**: el punto de unión se repite
 * a propósito, o la pierna que los une no la pide nadie.
 */
export function partirEnPedazos(puntos: readonly Punto[]): Punto[][] {
  if (puntos.length < 2) return [];
  const porPedazo = MAX_INTERMEDIOS + 2;
  const pedazos: Punto[][] = [];
  let i = 0;
  while (i < puntos.length - 1) {
    const fin = Math.min(i + porPedazo, puntos.length);
    pedazos.push(puntos.slice(i, fin));
    i = fin - 1; // Se repite el último: es el origen del siguiente pedazo.
  }
  return pedazos;
}

export class GoogleComputeRoutesAdapter {
  /**
   * Traza por calle una secuencia YA ordenada.
   *
   * @param puntos origen seguido de las paradas, en orden de visita.
   * @returns un tramo por cada salto: origen→1, 1→2, …, (n-1)→n.
   */
  async trazarRuta(puntos: readonly Punto[]): Promise<TramoRuta[]> {
    if (puntos.length < 2) return [];

    // Se lee ANTES de la primera llamada: un fallo de configuración no debe
    // aparecer a mitad del cosido, con media ruta pedida y pagada.
    leerProyectoGoogle();
    const token = await obtenerTokenAcceso();

    const tramos: TramoRuta[] = [];
    for (const pedazo of partirEnPedazos(puntos)) {
      tramos.push(...(await this.pedirPedazo(pedazo, token)));
    }
    return tramos;
  }

  private async pedirPedazo(pedazo: readonly Punto[], token: string): Promise<TramoRuta[]> {
    const cuerpo = {
      origin: comoWaypoint(pedazo[0]),
      destination: comoWaypoint(pedazo[pedazo.length - 1]),
      intermediates: pedazo.slice(1, -1).map(comoWaypoint),
      travelMode: 'DRIVE',
      // Con tráfico: el conductor sale a las 16:00 en hora punta y una ruta que
      // ignora el atochamiento no le sirve para decidir nada.
      routingPreference: 'TRAFFIC_AWARE',
      polylineEncoding: 'ENCODED_POLYLINE',
      // El orden ya está decidido. Pedirle a Google que lo optimice sería
      // deshacer justo lo que el conductor acaba de fijar con el dedo.
      optimizeWaypointOrder: false,
    };

    let respuesta: Response;
    try {
      respuesta = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          // Obligatoria, y acotada a propósito: sin máscara Google cobra por
          // devolver el objeto entero, y acá lo único que se usa son las
          // piernas.
          'x-goog-fieldmask':
            'routes.legs.polyline.encodedPolyline,routes.legs.distanceMeters,routes.legs.duration',
        },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (causa) {
      // Sin adjuntar `cuerpo` ni nada derivado: lleva coordenadas de entrega.
      const esTimeout = causa instanceof Error && causa.name === 'TimeoutError';
      throw new ErrorRuteoProveedor(
        esTimeout ? `trazado: no respondió en ${TIMEOUT_MS} ms` : 'trazado: error de red',
      );
    }

    if (!respuesta.ok) {
      const reintentable = respuesta.status >= 500 || respuesta.status === 429;
      throw new ErrorRuteoProveedor(`trazado: respondió ${respuesta.status}`, reintentable);
    }

    let datos: RespuestaComputeRoutes;
    try {
      datos = (await respuesta.json()) as RespuestaComputeRoutes;
    } catch {
      throw new ErrorRuteoProveedor('trazado: la respuesta no era JSON legible');
    }

    const piernas = datos.routes?.[0]?.legs ?? [];
    // Una pierna por salto. Si Google devolviera otra cantidad, coser sería
    // adivinar: se descarta el trazado entero y la pantalla cae a la recta, que
    // al menos es honesta sobre lo que sabe.
    if (piernas.length !== pedazo.length - 1) {
      throw new ErrorRuteoProveedor(
        `trazado: se esperaban ${pedazo.length - 1} piernas y llegaron ${piernas.length}`,
      );
    }

    return piernas.map((p) => ({
      distanciaM: p.distanceMeters ?? 0,
      duracionS: segundos(p.duration),
      polilinea: p.polyline?.encodedPolyline ?? null,
    }));
  }
}
