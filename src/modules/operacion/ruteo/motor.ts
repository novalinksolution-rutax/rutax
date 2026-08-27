/**
 * Motor de ruteo — vecino cercano + 2-opt + Or-opt sobre una matriz de
 * distancias.
 * =====================================================================
 *
 * Punto de entrada público del módulo: `calcularRuta`. Lógica pura, sin
 * pantallas y sin persistencia — es exactamente el alcance de la etapa 7
 * (`docs/arquitectura/retiro-y-ruteo-plan.md` §Etapa 7): quien llame a esta
 * función decide qué hacer con el resultado (guardar la secuencia, mostrarla,
 * recalcular tras un reordenamiento manual, etc.).
 *
 * =============================================================================
 * DECISIÓN DE PRODUCTO CERRADA (no se reabre aquí)
 * =============================================================================
 * `docs/arquitectura/retiro-y-ruteo.md` §4/§4.1: TypeScript puro sobre
 * haversine, US$0/mes, detrás de un puerto asíncrono desde el día uno
 * (`integraciones/ruteo/puerto.ts`) para que cambiar a una matriz por calle
 * sea una línea en una fábrica, no un refactor de este archivo.
 *
 * =============================================================================
 * LAS DISTANCIAS SON EN LÍNEA RECTA, Y ESO SE SABE
 * =============================================================================
 * En Santiago el Mapocho, la Costanera y Vespucio producen saltos
 * visiblemente absurdos contra una ruta real por calle. Este motor NO lo
 * disimula: no hay heurística de "penalizar cruces de río" ni nada que
 * pretenda ser más preciso de lo que es. El salvavidas es el reordenamiento
 * manual, que viene en otra etapa — y por eso el contrato de este módulo es
 * deliberadamente simple (`ParadaARutear`/`RutaCalculada`, sin nada de
 * estado interno del solver): recalcular no depende de conservar nada de una
 * corrida anterior, así que un reordenamiento manual puede aplicarse encima
 * del resultado sin tener que volver a llamar a este motor.
 *
 * =============================================================================
 * UN PEDIDO SIN COORDENADA NO PUEDE DESAPARECER
 * =============================================================================
 * `lat`/`long` nulos, no finitos (`NaN`/`Infinity`) o fuera del rango físico
 * de una coordenada (lat ∈ [-90,90], long ∈ [-180,180] — una coordenada mala
 * real, no una regla de negocio sobre dónde queda Chile: eso haría que los
 * propios casos de prueba con geometría sintética, tipo cuadrado en (0,0),
 * dejaran de servir) van a `sinUbicar` con motivo `'sin_coordenada'`. Nunca
 * se descartan en silencio — ver `separarUbicables`.
 *
 * =============================================================================
 * PRIVACIDAD DEL PUNTO DE TÉRMINO — LA RAZÓN DE `costo.ts`
 * =============================================================================
 * `docs/seguridad/punto-de-termino-conductor.md` §4 manda sobre este alcance
 * en todo lo que toque `destino`. La condición dura: la salida es idéntica en
 * forma exista o no destino, y `distanciaTotalM` NUNCA incluye el tramo final
 * hacia él (canal 5 de esa sección) — por eso `costo.ts` separa
 * `costoPublico` (lo que se reporta) de `costoInterno` (lo que usa el
 * optimizador para decidir el orden). `destino` SÍ puede cambiar qué parada
 * queda al final —es la función completa del parámetro: la ruta tiende a
 * terminar cerca de casa— y por lo tanto puede cambiar legítimamente
 * `distanciaTotalM` respecto de la misma entrada sin destino, porque el
 * ORDEN elegido puede ser distinto. Eso NO es la fuga que ese documento
 * prohíbe: la fuga sería que el número incluyera literalmente el tramo hacia
 * el ancla (no la incluye — ver `costoPublico`), o que `RutaCalculada`
 * expusiera la coordenada (no hay campo donde quepa — ver `tipos.ts`). Que el
 * ORDEN varíe según haya o no destino es el residuo aceptado y documentado en
 * §4.4 de ese mismo documento ("el jefe casi siempre ya sabe dónde vive su
 * conductor; lo nuevo que podría notar es que sus rutas tienden a terminar
 * por su sector") — no algo que este motor deba, o pueda, eliminar sin
 * volver inútil el parámetro. La prueba de privacidad de `motor.test.ts`
 * fija esta distinción con un caso donde el número SÍ es idéntico (nada que
 * reordenar) y documenta por qué el caso donde difiere no es un canal nuevo.
 *
 * NUNCA se incluye `lat`/`long` en un mensaje de error de este módulo: un
 * error de validación del `destino` podría terminar en un log u observability
 * (Sentry) — canal 12 del documento citado. Se identifica el punto inválido
 * por nombre ("origen"/"destino"), nunca por valor.
 */

import { obtenerPuertoMatriz, type PuertoMatriz } from '@/modules/integraciones/ruteo/puerto';
import type { PuntoRuteo } from '@/modules/integraciones/ruteo/tipos';
import type { Punto } from '@/lib/geo/distancia';
import { construirVecinoCercano } from './vecino-cercano';
import { ejecutarDosOpt, TOPE_PASADAS_DOS_OPT } from './dos-opt';
import { ejecutarOrOpt, TOPE_PASADAS_OR_OPT } from './or-opt';
import { costoPublico, ORIGEN_ID, DESTINO_ID, type DistanciaFn } from './costo';
import { fusionarConFijas, separarFijas } from './paradas-fijas';
import type { EntradaRuteo, ParadaARutear, ParadaSinUbicar, RutaCalculada } from './tipos';

/**
 * Rondas máximas alternando 2-opt ⇄ Or-opt. Cada operador converge por su
 * cuenta hasta su propio tope de pasadas; se alternan porque un movimiento de
 * uno puede abrir una mejora para el otro (el ejemplo de libro: Or-opt saca
 * una parada aislada del medio de un tramo, lo que puede destapar un cruce
 * que antes 2-opt no veía rentable arreglar). Si una ronda completa no
 * mejora nada por ninguno de los dos lados, se corta antes — el tope es la
 * red de seguridad, no lo habitual.
 */
export const TOPE_RONDAS = 5;

/** ¿Es un número usable como coordenada? No nulo, no `NaN`/`Infinity`. */
function coordenadaValida(valor: number | null): valor is number {
  return valor !== null && Number.isFinite(valor);
}

/**
 * Rango físico universal de una coordenada (lat ∈ [-90,90], long ∈
 * [-180,180]) — no una regla de negocio sobre dónde queda Chile: eso
 * invalidaría los propios casos de prueba con geometría sintética (un
 * cuadrado de paradas en torno a `(0,0)`, por ejemplo). Solo descarta lo que
 * no podría ser una coordenada en ningún lugar del planeta.
 */
function enRangoFisico(lat: number, long: number): boolean {
  return lat >= -90 && lat <= 90 && long >= -180 && long <= 180;
}

/**
 * Valida que un punto OBLIGATORIO (`origen`, o `destino` cuando no es null)
 * tenga coordenadas usables. Nunca incluye el valor de `lat`/`long` en el
 * mensaje — ver la nota de privacidad en la cabecera del archivo.
 */
function validarPuntoObligatorio(punto: Punto, nombre: 'origen' | 'destino'): void {
  if (
    !coordenadaValida(punto.lat) ||
    !coordenadaValida(punto.long) ||
    !enRangoFisico(punto.lat, punto.long)
  ) {
    throw new Error(`calcularRuta: el ${nombre} no tiene una coordenada válida.`);
  }
}

interface ParadaUbicada {
  pedidoId: string;
  lat: number;
  long: number;
  /** Posición impuesta por el conductor, si la hay. Ver `paradas-fijas.ts`. */
  ordenFijo?: number | null;
}

function separarUbicables(paradas: readonly ParadaARutear[]): {
  ubicables: ParadaUbicada[];
  sinUbicar: ParadaSinUbicar[];
} {
  const ubicables: ParadaUbicada[] = [];
  const sinUbicar: ParadaSinUbicar[] = [];

  for (const parada of paradas) {
    const { lat, long } = parada;
    if (coordenadaValida(lat) && coordenadaValida(long) && enRangoFisico(lat, long)) {
      ubicables.push({ pedidoId: parada.pedidoId, lat, long, ordenFijo: parada.ordenFijo });
    } else {
      sinUbicar.push({ pedidoId: parada.pedidoId, motivo: 'sin_coordenada' });
    }
  }

  return { ubicables, sinUbicar };
}

/**
 * Valida que ningún `pedidoId` choque entre sí ni con los ids reservados del
 * motor (`ORIGEN_ID`/`DESTINO_ID`). Es un bug del llamador (dos paradas con
 * el mismo pedido, o un pedidoId que por algún motivo colisiona con la llave
 * reservada) — nunca algo que este motor deba adivinar cómo resolver en
 * silencio, porque silenciarlo dejaría dos paradas fundidas en una sola
 * fila de la matriz de distancias.
 */
function validarIdsUnicos(ubicables: readonly ParadaUbicada[]): void {
  const vistos = new Set<string>();
  for (const p of ubicables) {
    if (p.pedidoId === ORIGEN_ID || p.pedidoId === DESTINO_ID) {
      throw new Error(`calcularRuta: pedidoId '${p.pedidoId}' choca con un id reservado del motor.`);
    }
    if (vistos.has(p.pedidoId)) {
      throw new Error(`calcularRuta: pedidoId duplicado '${p.pedidoId}' en las paradas.`);
    }
    vistos.add(p.pedidoId);
  }
}

/**
 * Calcula la ruta de un conductor: ordena `entrada.paradas` a partir de
 * `entrada.origen`, opcionalmente sesgada por `entrada.destino`.
 *
 * `puerto` es inyectable (para pruebas: una matriz de distancias falsa, o
 * simplemente `new HaversineMatrizAdapter()` explícito en vez de la fábrica
 * leyendo variables de entorno). Por defecto usa `obtenerPuertoMatriz()`, que
 * hoy siempre resuelve al adaptador haversine.
 */
export async function calcularRuta(
  entrada: EntradaRuteo,
  puerto: PuertoMatriz = obtenerPuertoMatriz(),
): Promise<RutaCalculada> {
  validarPuntoObligatorio(entrada.origen, 'origen');
  if (entrada.destino !== null) validarPuntoObligatorio(entrada.destino, 'destino');

  const { ubicables, sinUbicar } = separarUbicables(entrada.paradas);
  validarIdsUnicos(ubicables);

  if (ubicables.length === 0) {
    return { secuencia: [], sinUbicar, distanciaTotalM: 0 };
  }

  const puntos: PuntoRuteo[] = [
    { id: ORIGEN_ID, lat: entrada.origen.lat, long: entrada.origen.long },
    ...(entrada.destino !== null
      ? [{ id: DESTINO_ID, lat: entrada.destino.lat, long: entrada.destino.long }]
      : []),
    ...ubicables.map((p) => ({ id: p.pedidoId, lat: p.lat, long: p.long })),
  ];

  // ⚠️ La matriz se construye sobre TODAS las ubicables, fijadas incluidas: son
  // paradas de la ruta y el costo final las atraviesa. Lo que se les niega es
  // participar en el reordenamiento, no existir.
  const matriz = await puerto.calcularMatriz(puntos);
  const distancia: DistanciaFn = (desdeId, haciaId) => matriz.distanciaM(desdeId, haciaId);
  const destinoId = entrada.destino !== null ? DESTINO_ID : null;

  // Lo que el conductor movió a mano no se vuelve a mover. Ver `paradas-fijas.ts`.
  const { fijas, libres } = separarFijas(ubicables);

  let secuencia = construirVecinoCercano(
    libres.map((p) => p.pedidoId),
    distancia,
  );

  for (let ronda = 0; ronda < TOPE_RONDAS; ronda++) {
    const dosOpt = ejecutarDosOpt(secuencia, distancia, destinoId, TOPE_PASADAS_DOS_OPT);
    secuencia = dosOpt.secuencia;

    const orOpt = ejecutarOrOpt(secuencia, distancia, destinoId, TOPE_PASADAS_OR_OPT);
    secuencia = orOpt.secuencia;

    if (!dosOpt.mejoro && !orOpt.mejoro) break; // óptimo local conjunto: ninguno de los dos mejora más
  }

  const secuenciaFinal = fusionarConFijas(secuencia, fijas);

  return {
    secuencia: secuenciaFinal.map((pedidoId, indice) => ({ pedidoId, orden: indice + 1 })),
    sinUbicar,
    // Sobre la secuencia FINAL, no sobre la optimizada: el conductor tiene que
    // ver el kilometraje de la ruta que va a manejar, fijadas incluidas.
    distanciaTotalM: costoPublico(secuenciaFinal, distancia),
  };
}
