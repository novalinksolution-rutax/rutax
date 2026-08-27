/**
 * Adaptador de Google Route Optimization API — el solver por calle, con tráfico.
 * =====================================================================
 *
 * Endpoint: `POST https://routeoptimization.googleapis.com/v1/projects/{id}:optimizeTours`
 *
 * Es el proveedor que resuelve la secuencia Y devuelve la geometría real de la
 * calle (`populateTransitionPolylines`), que es lo que hace que el trazado del
 * mapa deje de ser una recta entre pines.
 *
 * =============================================================================
 * UN VEHÍCULO POR LLAMADA, Y ESO ES UNA DECISIÓN DE PRODUCTO, NO UNA LIMITACIÓN
 * =============================================================================
 * El SKU se decide por la cantidad de vehículos del request: uno solo cae en
 * **SingleVehicleRouting**; dos o más caen en Fleet Routing, que es Enterprise
 * y se cotiza aparte. Rutax rutea **por conductor**, sobre paradas que el
 * coordinador ya repartió a mano (`docs/arquitectura/retiro-y-ruteo.md` §4: la
 * asignación NO es clustering automático), así que un vehículo por llamada es
 * exactamente el modelo del negocio.
 *
 * ⚠️ Si algún día alguien mete dos vehículos en un request «para ahorrar una
 * llamada», cambia de SKU sin avisar y la factura no se parece a la del mes
 * anterior.
 *
 * =============================================================================
 * SE COBRA POR ENVÍO. CADA LLAMADA CUESTA TANTAS PARADAS COMO MANDES
 * =============================================================================
 * No por request: por envío. Una ruta de 30 paradas cuesta 30 unidades cada vez
 * que se optimiza. Re-optimizar diez veces en la tarde cuesta diez veces.
 * Quien llame a esto tiene que saberlo — y por eso re-optimizar «lo que queda»
 * (que encoge durante el día) es más barato que re-optimizar la ruta entera.
 *
 * =============================================================================
 * EL TRAMO FINAL HACIA EL ANCLA SE DESCARTA AQUÍ. NO EN LA PANTALLA
 * =============================================================================
 * `docs/seguridad/punto-de-termino-conductor.md` §4.3, canal 3: *«la polilínea
 * termina en la última parada. Nunca se dibuja el tramo final»*. Google sí
 * devuelve ese tramo —lo pidió el `endLocation`—, y su polilínea dibuja el
 * camino hasta la casa del conductor.
 *
 * Por eso el recorte vive en este archivo, en `tramosVisibles`, y no en el
 * componente del mapa: si el dato viaja hasta el navegador del coordinador, ya
 * se filtró, aunque nadie lo pinte. Se conservan **exactamente
 * `visitas.length` tramos**, exista o no ancla, así que la salida tiene la
 * misma forma en los dos casos — que es la condición dura del §4.
 *
 * ⚠️ NUNCA loguear el cuerpo del request ni la respuesta: llevan las
 * coordenadas de los destinatarios y, en el `endLocation`, el domicilio del
 * conductor (canal 12).
 */

import type {
  EntradaOptimizacion,
  RutaOptimizada,
  TramoRuta,
} from '../tipos-optimizacion';
import { ErrorRuteoProveedor } from '../errores';
import { leerProyectoGoogle, obtenerTokenAcceso } from './google-credenciales';

/**
 * Tope de espera de la llamada.
 *
 * El coordinador está mirando la pantalla a las 15:50 con la flota esperando
 * para salir a las 16:00. Preferimos caer al motor local —línea recta, pero
 * instantáneo— antes que dejarlo sin nada mientras un socket cuelga.
 */
const TIMEOUT_MS = 20_000;

// =============================================================================
// Forma de la respuesta (solo lo que se consume)
// =============================================================================

interface VisitaGoogle {
  shipmentIndex?: number;
  isPickup?: boolean;
}

interface TransicionGoogle {
  travelDistanceMeters?: number;
  travelDuration?: string;
  routePolyline?: { points?: string };
}

interface RespuestaGoogle {
  routes?: {
    visits?: VisitaGoogle[];
    transitions?: TransicionGoogle[];
  }[];
}

/**
 * Convierte la `Duration` de protobuf (`"300s"`, `"300.500s"`) a segundos.
 *
 * Devuelve 0 ante cualquier cosa que no sepa leer: una duración ilegible no
 * puede tumbar una ruta que por lo demás está bien resuelta.
 */
export function segundosDesdeDuracion(duracion: string | undefined): number {
  if (typeof duracion !== 'string') return 0;
  const valor = Number.parseFloat(duracion.replace(/s$/, ''));
  return Number.isFinite(valor) && valor >= 0 ? valor : 0;
}

/**
 * Se queda con los tramos que pueden salir del módulo: origen→1, 1→2, …,
 * (n-1)→n. Descarta el n→ancla que Google agrega cuando hay `endLocation`.
 *
 * Exportada para que la prueba de privacidad la ejerza directamente: es la
 * función que sostiene el canal 3.
 */
export function tramosVisibles(
  transiciones: readonly TransicionGoogle[],
  totalVisitas: number,
): TramoRuta[] {
  return transiciones.slice(0, totalVisitas).map((t) => ({
    distanciaM: Number.isFinite(t.travelDistanceMeters) ? Number(t.travelDistanceMeters) : 0,
    duracionS: segundosDesdeDuracion(t.travelDuration),
    polilinea: typeof t.routePolyline?.points === 'string' ? t.routePolyline.points : null,
  }));
}

// =============================================================================
// Adaptador
// =============================================================================

export class GoogleRouteOptimizationAdapter {
  async optimizarRuta(entrada: EntradaOptimizacion): Promise<RutaOptimizada> {
    const { origen, destino, paradas } = entrada;

    if (paradas.length === 0) {
      return { secuencia: [], tramos: [], distanciaTotalM: 0, duracionTotalS: 0 };
    }

    const proyecto = leerProyectoGoogle();
    const token = await obtenerTokenAcceso();

    const cuerpo = {
      model: {
        shipments: paradas.map((p) => ({
          deliveries: [{ arrivalLocation: { latitude: p.lat, longitude: p.long } }],
        })),
        vehicles: [
          {
            startLocation: { latitude: origen.lat, longitude: origen.long },
            // El ancla entra ACÁ y no sale por ningún lado. Ver la cabecera.
            ...(destino
              ? { endLocation: { latitude: destino.lat, longitude: destino.long } }
              : {}),
          },
        ],
      },
      populateTransitionPolylines: true,
    };

    let respuesta: Response;
    try {
      respuesta = await fetch(
        `https://routeoptimization.googleapis.com/v1/projects/${encodeURIComponent(proyecto)}:optimizeTours`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(cuerpo),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
    } catch (causa) {
      // Sin adjuntar `cuerpo` ni nada derivado de él: lleva coordenadas.
      const esTimeout = causa instanceof Error && causa.name === 'TimeoutError';
      throw new ErrorRuteoProveedor(
        esTimeout ? `no respondió en ${TIMEOUT_MS} ms` : 'error de red',
      );
    }

    if (!respuesta.ok) {
      const reintentable = respuesta.status >= 500 || respuesta.status === 429;
      throw new ErrorRuteoProveedor(`respondió ${respuesta.status}`, reintentable);
    }

    let datos: RespuestaGoogle;
    try {
      datos = (await respuesta.json()) as RespuestaGoogle;
    } catch {
      throw new ErrorRuteoProveedor('la respuesta no era JSON legible');
    }

    return interpretarRespuesta(datos, paradas);
  }
}

/**
 * Traduce la respuesta de Google al contrato del puerto.
 *
 * **Los envíos omitidos no necesitan tratamiento especial.** Si Google descarta
 * una parada por infactible, no aparece en `visits`, así que no entra en la
 * secuencia — y `operacion/ruta-manifiesto.ts` manda al RPC solo lo que sí
 * entró, dejando el resto con `orden_ruta` nulo. Ese es exactamente el estado
 * «sin secuencia» que la pantalla ya sabe mostrar. No se pierde ninguna parada:
 * se queda sin número, que es distinto.
 *
 * Exportada para poder probarla sin red.
 */
export function interpretarRespuesta(
  datos: RespuestaGoogle,
  paradas: EntradaOptimizacion['paradas'],
): RutaOptimizada {
  const ruta = datos.routes?.[0];
  if (!ruta) {
    throw new ErrorRuteoProveedor('la respuesta no traía ninguna ruta');
  }

  // Solo entregas: el modelo no manda `pickups`, pero un `isPickup` explícito
  // se respeta igual por si el proveedor cambia de forma.
  const visitas = (ruta.visits ?? []).filter((v) => v.isPickup !== true);

  const secuencia: { pedidoId: string; orden: number }[] = [];
  visitas.forEach((visita) => {
    const indice = visita.shipmentIndex ?? 0;
    const parada = paradas[indice];
    // Un índice fuera de rango es respuesta corrupta: se omite esa visita en
    // vez de inventar una parada. Queda sin secuencia, como una omitida.
    if (parada) {
      secuencia.push({ pedidoId: parada.pedidoId, orden: secuencia.length + 1 });
    }
  });

  const tramos = tramosVisibles(ruta.transitions ?? [], secuencia.length);

  return {
    secuencia,
    tramos,
    // Se suman los tramos QUE QUEDARON, nunca los totales del proveedor: los
    // suyos incluyen el trayecto hasta el ancla. Canal 5 del §4.3.
    distanciaTotalM: tramos.reduce((suma, t) => suma + t.distanciaM, 0),
    duracionTotalS: tramos.reduce((suma, t) => suma + t.duracionS, 0),
  };
}
