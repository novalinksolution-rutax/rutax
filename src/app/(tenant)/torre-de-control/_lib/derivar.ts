/**
 * De `EstadoTorre` a las tres fuentes GeoJSON del mapa.
 * =============================================================================
 *
 * Todo lo de acá es **derivación de cliente**: no pide nada al servidor y no
 * decide nada de negocio. Existe porque las tres fuentes que consume MapLibre
 * son vistas distintas del MISMO dato —las comunas, sus agrupaciones y sus
 * puntos— y calcularlas en el servidor obligaría a mandar tres veces lo mismo.
 *
 * Dos invariantes que se rompen fácil y que tienen prueba:
 *
 *   1. **La suma de lo dibujado da el pendiente de la comuna** (regla 5 del
 *      alcance): `Σ burbujas === comuna.pendientes`. Se cuenta **paquete por
 *      paquete con el estado de cada uno** (`cuentaComoPendiente`), ni por puntos
 *      ni por `pedidos.length`. Contar puntos deja la suma por debajo de la placa
 *      y el mapa esconde carga; contar `pedidos.length` la deja por encima,
 *      porque un punto se clasifica por su representante y arrastra a la burbuja
 *      los paquetes ya entregados del mismo portal. Los dos errores se cometieron.
 *
 *      Ojo con el `+N` del punto: ése SÍ es `pedidos.length`, y a propósito —
 *      responde «cuántos paquetes hay en esta dirección», no «cuántos faltan».
 *      Por eso la suma de los `+N` de una celda puede superar a su burbuja.
 *   2. **La geometría no depende del conteo.** Las comunas se dibujan siempre,
 *      con pedidos o sin ellos; lo que varía es el paso de la rampa. Ver
 *      `geometria.ts`.
 */

import type { Feature, FeatureCollection, Point } from 'geojson';
import type { ComunaEnTorre, PuntoEntrega } from '@/modules/contexto/contrato-torre';
import { claveComuna } from './comunas';
import { limitesDe, type MapaGeometrias } from './geometria';

// =============================================================================
// Rampa de carga — 4 pasos por cuantil
// =============================================================================

/**
 * A qué paso de la rampa (0–3) le toca cada comuna, por cuantiles de pendientes.
 *
 * **Por cuantil y no por umbrales fijos**, que era la alternativa: un courier
 * que mueve 40 paquetes al día y otro que mueve 4.000 verían la misma pantalla
 * con umbrales absolutos —el primero todo en el paso 0, el segundo todo en el 3—
 * y la rampa dejaría de distinguir nada en los dos casos. Con cuantiles la
 * escala se ajusta sola a la operación de cada uno.
 *
 * La rampa es intensidad de una magnitud, no una escala semántica: el número
 * exacto va SIEMPRE en la placa (regla 2 — el color nunca es el único canal).
 *
 * Las comunas sin carga hoy no entran al cálculo y se quedan en el paso 0: si
 * entraran, un día tranquilo con dos comunas activas repartiría los cuatro pasos
 * entre 50 ceros y arruinaría los cortes.
 */
export function pasosDeCarga(comunas: readonly ComunaEnTorre[]): Map<string, number> {
  const conCarga = comunas.filter((c) => c.pendientes > 0);
  const pasos = new Map<string, number>();
  if (conCarga.length === 0) return pasos;

  const ordenados = conCarga.map((c) => c.pendientes).sort((a, b) => a - b);
  const cuantil = (q: number) => ordenados[Math.floor((ordenados.length - 1) * q)];
  const [q1, q2, q3] = [cuantil(0.25), cuantil(0.5), cuantil(0.75)];

  for (const comuna of conCarga) {
    const p = comuna.pendientes;
    pasos.set(claveComuna(comuna.nombre), p <= q1 ? 0 : p <= q2 ? 1 : p <= q3 ? 2 : 3);
  }
  return pasos;
}

// =============================================================================
// Fuente de comunas — nivel 1
// =============================================================================

/** Paso que reciben las comunas sin carga hoy. No se pintan. Ver `geoComunas`. */
export const PASO_SIN_CARGA = -1;

export interface PropiedadesComuna {
  nombre: string;
  /** Paso de la rampa, 0–3, o `PASO_SIN_CARGA` si hoy no tiene nada. */
  paso: number;
  /** La selección, que es lo que produce el velo — no el zoom. */
  activa: boolean;
  pendientes: number;
  total: number;
  incidenciasAbiertas: number;
}

/**
 * Las 52 comunas de la RM, siempre, con la carga del día pegada encima.
 *
 * Se recorre la GEOMETRÍA y no la lista del composer, y ése es el punto entero
 * de este archivo: una comuna sin pedidos hoy se dibuja igual, en el paso 0.
 */
export function geoComunas(
  geometrias: MapaGeometrias,
  comunas: readonly ComunaEnTorre[],
  comunaActiva: string | null,
): FeatureCollection {
  const porClave = new Map(comunas.map((c) => [claveComuna(c.nombre), c]));
  const pasos = pasosDeCarga(comunas);
  const claveActiva = comunaActiva ? claveComuna(comunaActiva) : null;

  const features: Feature[] = [];
  for (const [clave, geometria] of geometrias) {
    const datos = porClave.get(clave);
    const propiedades: PropiedadesComuna = {
      // El nombre que se muestra sale de la geometría cuando la comuna no tiene
      // carga: es el único que existe en ese caso.
      nombre: datos?.nombre ?? geometria.properties.comuna,
      // ⚠️ `PASO_SIN_CARGA` y no 0. El 0 es el escalón MÁS BAJO de la rampa, no
      // «nada»: usarlo para las comunas sin pedidos pintaba de azul las 52
      // comunas de la RM, con carga o sin ella. El resultado era una capa azul
      // que cubría el mapa entero y no correspondía a ningún dato — se reportó,
      // con razón, como «esa capa parece mal ubicada». No lo estaba: estaba de
      // más. Con la comuna vacía sin pintar, el azul vuelve a significar una
      // sola cosa: **acá queda carga**.
      paso: pasos.get(clave) ?? PASO_SIN_CARGA,
      activa: claveActiva === clave,
      pendientes: datos?.pendientes ?? 0,
      total: datos?.total ?? 0,
      incidenciasAbiertas: datos?.incidenciasAbiertas ?? 0,
    };
    features.push({ ...geometria, properties: propiedades } as Feature);
  }
  return { type: 'FeatureCollection', features };
}

/**
 * La caja que contiene TODA la carga que sigue en la calle hoy.
 *
 * ⚠️ **El encuadre de entrada no puede ser una constante.** `ENCUADRE_RM` está
 * centrado en el Gran Santiago; un courier que reparte en Colina, Buin o
 * Melipilla tiene esa carga fuera de pantalla, y una comuna con 30 pendientes
 * que no se dibuja es el mapa escondiendo carga — regla 5 del alcance.
 *
 * ⚠️ **Se une la caja de los PEDIDOS, no la de los polígonos**, y esto costó un
 * bug en producción de QA. La primera versión unía `limitesDe(geometria)` con un
 * argumento razonable —«una comuna grande cabe entera, no solo su centro»— pero
 * una comuna periurbana arrastra kilómetros de secano sin un solo pedido: la caja
 * de Colina mide 0,40° de latitud ella sola y llega hasta −32,94, mientras sus 30
 * pedidos viven entre −33,26 y −33,14. Esos 0,19° vacíos inflaban la unión hasta
 * no caber en el lienzo, el ajuste chocaba contra `zoomMinimo` y **el recorte se
 * lo llevaba el sur**: Puente Alto, con 39 pendientes, quedaba entero fuera de
 * pantalla. El mapa escondía carga por culpa del arreglo que existía para no
 * esconderla.
 *
 * Encuadrar los pedidos resuelve las dos cosas a la vez: la comuna periférica
 * entra (sus pedidos están dentro) y el secano vacío deja de pedir espacio.
 *
 * Se toman los puntos **no entregados**, que son los que el mapa dibuja como
 * carga viva. Si no queda ninguno ubicado —día ya cerrado, o geocodificación
 * pendiente— se cae a la caja de los polígonos de las comunas con pendientes,
 * que es peor encuadre pero nunca deja la pantalla sin nada. Devuelve `null` solo
 * cuando tampoco hay eso, y ahí manda el encuadre por defecto de la RM.
 */
export function limitesDeLaCarga(
  geometrias: MapaGeometrias,
  comunas: readonly ComunaEnTorre[],
  puntos: readonly PuntoEntrega[] = [],
): [[number, number], [number, number]] | null {
  let oeste = Infinity;
  let sur = Infinity;
  let este = -Infinity;
  let norte = -Infinity;
  let hubo = false;

  for (const punto of puntos) {
    if (punto.estado === 'entregado') continue;
    const { lat, long } = punto.posicion;
    if (long < oeste) oeste = long;
    if (lat < sur) sur = lat;
    if (long > este) este = long;
    if (lat > norte) norte = lat;
    hubo = true;
  }

  // Respaldo: sin puntos vivos ubicados, la caja de los polígonos con carga.
  if (!hubo) {
    for (const comuna of comunas) {
      if (comuna.pendientes === 0) continue;
      const geometria = geometrias.get(claveComuna(comuna.nombre));
      if (!geometria) continue;
      const [[o, s], [e, n]] = limitesDe(geometria);
      if (o < oeste) oeste = o;
      if (s < sur) sur = s;
      if (e > este) este = e;
      if (n > norte) norte = n;
      hubo = true;
    }
  }

  return hubo
    ? [
        [oeste, sur],
        [este, norte],
      ]
    : null;
}

// =============================================================================
// Fuente de puntos — nivel 3
// =============================================================================

export interface PropiedadesPunto {
  id: string;
  estado: PuntoEntrega['estado'];
  cercaDelCorte: boolean;
  agrupados: number;
  codigo: string;
  comuna: string;
  conductor: string;
  seller: string;
  intentosPrevios: number;
  /**
   * `true` cuando hay una agrupación abierta y este punto NO es suyo. El estilo
   * lo atenúa; ver `atenuar()` en `estilo.ts`.
   */
  foraneo: boolean;
}

/** Los puntos de la comuna activa, o los de toda la región si no hay ninguna. */
export function puntosVisibles(
  puntos: readonly PuntoEntrega[],
  comunaActiva: string | null,
): PuntoEntrega[] {
  if (!comunaActiva) return [...puntos];
  const clave = claveComuna(comunaActiva);
  return puntos.filter((p) => p.comuna !== null && claveComuna(p.comuna) === clave);
}

/**
 * @param celdaAbierta Celda de la agrupación que el usuario abrió, o `null`. Los
 *   puntos de otras celdas salen marcados como `foraneo` y el estilo los atenúa.
 */
export function geoPuntos(
  puntos: readonly PuntoEntrega[],
  celdaAbierta: string | null = null,
): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: puntos.map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.posicion.long, p.posicion.lat] },
      properties: {
        id: p.id,
        estado: p.estado,
        cercaDelCorte: p.cercaDelCorte,
        // Se DERIVA del largo de la lista: no hay un campo aparte que pueda
        // decir «+2» mientras la ficha pagina tres.
        agrupados: p.pedidos.length,
        // Las propiedades de MapLibre no admiten `null` en las expresiones de
        // texto sin ensuciar cada `text-field` con un `coalesce`; el vacío se
        // resuelve acá, una vez.
        codigo: p.pedidos[0]?.codigoEnvio ?? '',
        comuna: p.comuna ?? '',
        conductor: p.pedidos[0]?.conductorNombre ?? '',
        seller: p.pedidos[0]?.sellerNombre ?? '',
        intentosPrevios: p.pedidos[0]?.intentosPrevios ?? 0,
        foraneo: celdaAbierta !== null && celdaDe(p.posicion) !== celdaAbierta,
      } satisfies PropiedadesPunto,
    })),
  };
}

// =============================================================================
// Fuente de agrupaciones — nivel 2
// =============================================================================

/**
 * Lado de la celda de agrupación, en grados. Dos decimales ≈ **1,1 km** en
 * Santiago.
 *
 * Es un orden de magnitud por encima del colapso de edificio del servidor
 * (~20 m), y tiene que serlo: el nivel 2 responde «¿en qué parte de la comuna
 * está la carga?», no «¿qué edificio?». Con celdas de 200 m habría una burbuja
 * por cuadra y el nivel 2 sería el nivel 3 con otro dibujo.
 */
const LADO_CELDA_GRADOS = 0.01;

/**
 * A qué burbuja pertenece un punto. Viaja en las dos fuentes para poder cruzar
 * la burbuja que el usuario abrió con los puntos que la componen.
 */
export function celdaDe(posicion: { lat: number; long: number }): string {
  return `${Math.floor(posicion.long / LADO_CELDA_GRADOS)}:${Math.floor(posicion.lat / LADO_CELDA_GRADOS)}`;
}

/**
 * ¿Este paquete cuenta como carga que todavía falta por entregar?
 *
 * Es la MISMA definición que usa `comuna.pendientes` en el servidor
 * (`agregacion.ts`: `entregado` y `fallido` son estados cerrados), reescrita acá
 * en los términos del mapa. Que las dos definiciones coincidan es lo que sostiene
 * el invariante 1: si alguien las separa, la suma de las burbujas deja de dar la
 * cifra de la placa y el mapa empieza a mentir sobre la carga.
 */
export function cuentaComoPendiente(estado: PuntoEntrega['estado']): boolean {
  return estado !== 'entregado' && estado !== 'incidencia';
}

export interface PropiedadesAgrupacion {
  /** Cuántos PEDIDOS, no cuántos puntos. Ver el invariante 1 del encabezado. */
  cantidad: number;
  /** Su celda, para poder saber qué puntos la componen al abrirla. */
  celda: string;
}

/**
 * Las burbujas del nivel 2: los pedidos que todavía cuentan, por celda.
 *
 * ⚠️ **Sin comuna activa NO hay burbujas.** Es la regla que hace que acercarse
 * con la rueda se sienta limpio: al bajar de nivel sin haber elegido nada, el
 * mapa no se llena de globos de toda la ciudad; se ve el plano, y al cruzar al
 * nivel 3 aparecen los puntos. Las burbujas son el resumen **de una comuna**, y
 * un resumen de todo a la vez no resume nada.
 *
 * Es además coherente con el velo: entrar en una comuna es lo que apaga el resto
 * de la ciudad, y la burbuja es el otro lado de esa misma selección.
 *
 * **El centro es el promedio de sus puntos, no el de la celda.** Una burbuja en
 * el centro geométrico de la celda puede caer en medio de un parque vacío y
 * miente sobre dónde está la carga; el promedio siempre cae donde hay pedidos.
 *
 * **Los entregados no burbujean**: el nivel 2 existe para decidir dónde hay que
 * ir, y lo ya entregado no pide ir a ninguna parte. Es coherente con la placa,
 * que también cuenta lo que falta.
 *
 * ⚠️ **Se cuenta paquete por paquete, con el estado de CADA UNO**, y esto es el
 * invariante 1 del encabezado. Contar `pedidos.length` sobre los puntos «no
 * entregados» —como hacía la primera versión— parece equivalente y no lo es: un
 * punto se clasifica por su pedido REPRESENTANTE, así que un portal con tres
 * paquetes de los que uno sigue pendiente y dos ya se entregaron sumaba 3 a la
 * burbuja mientras la placa contaba 1. Medido en el fixture: la burbuja daba 18
 * donde la placa decía 13, en dos comunas distintas.
 *
 * **La incidencia tampoco burbujea** (decisión de producto, 2026-08-04). Un
 * `fallido` ya se intentó y no vuelve a salir hoy: la placa no lo cuenta en
 * «faltan», así que la burbuja tampoco. La señal no se pierde — la incidencia
 * sigue teniendo su punto rojo en la placa de la comuna y su punto rojo propio en
 * el nivel 3, que es donde se actúa sobre ella.
 *
 * Con las dos reglas, `Σ burbujas === comuna.pendientes`. Hay prueba.
 */
export function geoAgrupaciones(
  puntos: readonly PuntoEntrega[],
  comunaActiva: string | null,
): FeatureCollection<Point> {
  if (!comunaActiva) return { type: 'FeatureCollection', features: [] };

  const celdas = new Map<string, { x: number; y: number; puntos: number; cantidad: number }>();

  for (const p of puntos) {
    // Paquete por paquete y con SU estado, no el del representante del punto.
    const cuentan = p.pedidos.filter((q) => cuentaComoPendiente(q.estado)).length;
    if (cuentan === 0) continue;
    const clave = celdaDe(p.posicion);
    const celda = celdas.get(clave) ?? { x: 0, y: 0, puntos: 0, cantidad: 0 };
    celda.x += p.posicion.long;
    celda.y += p.posicion.lat;
    celda.puntos += 1;
    celda.cantidad += cuentan;
    celdas.set(clave, celda);
  }

  return {
    type: 'FeatureCollection',
    features: [...celdas].map(([clave, c]) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [c.x / c.puntos, c.y / c.puntos] },
      properties: { cantidad: c.cantidad, celda: clave } satisfies PropiedadesAgrupacion,
    })),
  };
}
