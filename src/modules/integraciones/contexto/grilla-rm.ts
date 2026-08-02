/**
 * Grilla de muestreo de la Región Metropolitana.
 * =====================================================================
 *
 * Los proveedores de pronóstico cobran (o limitan) POR LLAMADA y aceptan UNA
 * coordenada por llamada. Pedir las 52 comunas serían 52 llamadas por ciclo y
 * por fuente; con dos fuentes cada hora, 2.496 llamadas al día.
 *
 * Y sobre todo: **sería sobre-muestrear**. Los modelos meteorológicos globales
 * resuelven en celdas de ~10–25 km; el de calidad del aire (CAMS) es aún más
 * grueso. La Región Metropolitana tiene ~80 km de lado. Pedir dos comunas
 * separadas por 3 km devuelve el MISMO número interpolado dos veces: no es más
 * precisión, es la misma cifra pagada dos veces.
 *
 * -----------------------------------------------------------------------------
 * CÓMO SE ELIGIERON ESTOS 14 PUNTOS (no están puestos a ojo)
 * -----------------------------------------------------------------------------
 * Algoritmo voraz de k-centros (Gonzalez) sobre los 52 centroides comunales
 * reales de `CENTROIDES_RM`, sembrado en Santiago —el centro operativo— y
 * ejecutado una sola vez para fijar la lista. Minimiza la distancia MÁXIMA de
 * una comuna a su punto, que es la métrica que importa: lo que se quiere acotar
 * es el peor caso, no el promedio.
 *
 * Resultados medidos sobre las 52 comunas:
 *
 *     k =  8  →  máximo 25,4 km
 *     k = 10  →  máximo 21,4 km
 *     k = 12  →  máximo 17,9 km
 *     k = 14  →  máximo 12,6 km   ← elegido
 *
 * Se corta en 14 porque ahí el peor caso (12,6 km, Peñalolén) ya cae dentro de
 * la celda del propio modelo. Bajar más el máximo no traería datos distintos;
 * traería las mismas cifras en más llamadas.
 *
 * Con 14 puntos: **336 llamadas al día por fuente** (14 × 24 ciclos), 672
 * sumando clima y aire. El tier gratuito de OpenWeather admite 60 por minuto y
 * 1.000.000 al mes; esto son ~20.000 al mes.
 *
 * -----------------------------------------------------------------------------
 * LA CONSECUENCIA QUE HAY QUE TENER PRESENTE
 * -----------------------------------------------------------------------------
 * Un solo punto (Santiago) cubre **25 comunas del casco urbano**, así que todas
 * reciben el mismo pronóstico y el factor clima no distingue Centro de Oriente.
 * Es deliberado y es honesto: el modelo tampoco los distingue. Agregar puntos
 * dentro de la cuenca para que las zonas «se vean» distintas sería fabricar una
 * diferencia que el dato no sostiene.
 *
 * Si algún día se quiere de verdad diferenciar dentro de la cuenca, no se
 * resuelve con más puntos de esta grilla: hace falta otra fuente (una red de
 * estaciones como SINCA, que mide en el terreno en vez de interpolar).
 */

import { distanciaEnMetros } from '@/lib/geo/distancia';
import { CENTROIDES_RM } from '@/lib/geo/centroides-rm';
import { COMUNAS_RM, type ComunaRM } from '@/lib/ui/comunas-rm';

export interface PuntoGrilla {
  /**
   * Nombre de la comuna cuyo centroide es este punto. Es una ETIQUETA para
   * poder leer logs y pruebas, no un ámbito: el punto representa a todas las
   * comunas que lo tienen como más cercano, no solo a la que le da nombre.
   */
  referencia: ComunaRM;
  lat: number;
  long: number;
}

/**
 * Los 14 puntos, en el orden en que los eligió el algoritmo (Santiago primero,
 * luego el más lejano al conjunto ya elegido). Las coordenadas son los
 * centroides reales de `CENTROIDES_RM`, no valores redondeados a mano.
 */
export const GRILLA_RM: readonly PuntoGrilla[] = [
  { referencia: 'Santiago', lat: -33.4489, long: -70.6693 },
  { referencia: 'San Pedro', lat: -33.8917, long: -71.4583 },
  { referencia: 'Tiltil', lat: -33.0833, long: -70.9333 },
  { referencia: 'María Pinto', lat: -33.5167, long: -71.1333 },
  { referencia: 'Paine', lat: -33.8083, long: -70.7417 },
  { referencia: 'San José de Maipo', lat: -33.6417, long: -70.3528 },
  { referencia: 'Alhué', lat: -34.0289, long: -71.1019 },
  { referencia: 'Colina', lat: -33.2019, long: -70.6747 },
  { referencia: 'Peñaflor', lat: -33.6097, long: -70.8769 },
  { referencia: 'Pirque', lat: -33.6389, long: -70.5917 },
  { referencia: 'Lampa', lat: -33.2833, long: -70.8833 },
  { referencia: 'Melipilla', lat: -33.6889, long: -71.2153 },
  { referencia: 'Lo Barnechea', lat: -33.35, long: -70.5167 },
  { referencia: 'Isla de Maipo', lat: -33.75, long: -70.8972 },
];

/** Peor distancia medida comuna→punto, en metros. La verifica un test. */
export const DISTANCIA_MAXIMA_GRILLA_M = 12_700;

/**
 * Punto de la grilla que le corresponde a una comuna: el más cercano por
 * distancia geodésica.
 *
 * Se calcula, no se tabula: una tabla escrita a mano se desincroniza en cuanto
 * alguien mueve un punto de la grilla, y lo haría en silencio — la comuna
 * seguiría teniendo dato, solo que del sitio equivocado.
 */
export function puntoDeComuna(comuna: ComunaRM): PuntoGrilla {
  const centroide = CENTROIDES_RM[comuna];
  let mejor = GRILLA_RM[0];
  let mejorDistancia = Number.POSITIVE_INFINITY;

  for (const punto of GRILLA_RM) {
    const distancia = distanciaEnMetros(centroide, punto);
    if (distancia < mejorDistancia) {
      mejorDistancia = distancia;
      mejor = punto;
    }
  }

  return mejor;
}

/**
 * Comunas a consultar: las pedidas, o las 52 de la RM por defecto.
 *
 * Valida contra el catálogo y **lanza** ante una comuna desconocida en vez de
 * ignorarla: una comuna mal escrita que se salta en silencio produce un tablero
 * al que le falta un pedazo de ciudad sin que nadie lo note.
 */
export function comunasDeConsulta(comunas?: readonly ComunaRM[]): ComunaRM[] {
  if (comunas === undefined) return [...COMUNAS_RM];

  const catalogo = new Set<string>(COMUNAS_RM);
  const desconocidas = comunas.filter((c) => !catalogo.has(c));
  if (desconocidas.length > 0) {
    throw new RangeError(
      `Comunas fuera del catálogo de la RM: ${desconocidas.join(', ')}`,
    );
  }
  return [...comunas];
}

/**
 * Reparte las comunas pedidas entre los puntos de la grilla.
 *
 * Devuelve solo los puntos que alguna comuna necesita: si el courier opera dos
 * comunas del centro, se hacen DOS llamadas menos que si se recorriera la
 * grilla entera. El job normal pide las 52 y usa los 14.
 */
export function agruparComunasPorPunto(
  comunas: readonly ComunaRM[] = COMUNAS_RM,
): { punto: PuntoGrilla; comunas: ComunaRM[] }[] {
  const porReferencia = new Map<string, { punto: PuntoGrilla; comunas: ComunaRM[] }>();

  for (const comuna of comunas) {
    const punto = puntoDeComuna(comuna);
    const grupo = porReferencia.get(punto.referencia);
    if (grupo) grupo.comunas.push(comuna);
    else porReferencia.set(punto.referencia, { punto, comunas: [comuna] });
  }

  // Se devuelve en el orden de `GRILLA_RM` y no en el de inserción: así el orden
  // de las llamadas no depende del orden en que llegaron las comunas, y las
  // pruebas y los logs son estables.
  return GRILLA_RM.map((punto) => porReferencia.get(punto.referencia)).filter(
    (grupo): grupo is { punto: PuntoGrilla; comunas: ComunaRM[] } => grupo !== undefined,
  );
}
