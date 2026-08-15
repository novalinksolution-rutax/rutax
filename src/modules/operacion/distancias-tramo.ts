/**
 * Distancia de cada tramo de una ruta — para que el salto absurdo se VEA.
 * =============================================================================
 * Etapa 7 de "retiro en bodega + ruteo".
 *
 * ## Por qué existe
 *
 * Las distancias del motor son en LÍNEA RECTA, y eso no se disimula: en Santiago
 * el Mapocho, la Costanera y Vespucio producen secuencias que sobre el plano
 * real son absurdas. El salvavidas declarado es el reordenamiento manual — pero
 * el coordinador solo puede usarlo si VE el salto, y en una lista de treinta
 * direcciones no se ve. Un "12,4 km" entre dos paradas seguidas sí.
 *
 * ## Por qué está en su propio archivo, aislado
 *
 * Es un módulo **puro**: solo depende de `@/lib/geo/distancia`. Eso es
 * deliberado y hay que conservarlo, porque lo importa un componente de cliente
 * (el panel de ruta recalcula los tramos mientras el coordinador arrastra
 * paradas, sin ir al servidor en cada movimiento). Si algún día alguien le
 * agrega aquí un import de Supabase, de un job o de `punto-termino-conductor`,
 * ese árbol entero se va al bundle del navegador.
 *
 * ⚠️ **El punto de término NO participa.** Esta función no lo recibe y no existe
 * un "tramo final" hacia él: `docs/seguridad/punto-de-termino-conductor.md`
 * §4.3, canal 5 — un total que incluyera el tramo a casa permitiría deducir,
 * comparando dos conductores con las mismas paradas, quién definió su punto y a
 * qué distancia. Es una fuga silenciosa y aritmética, y se cierra aquí no
 * teniendo el dato.
 */

import { distanciaEnMetros, type Punto } from "@/lib/geo/distancia";

/** Lo mínimo que necesita una parada para medir su tramo. */
export interface ParadaConCoordenada {
  lat: number | null;
  long: number | null;
}

/**
 * Convierte un par leído de la base (o serializado a props) en un `Punto`, o
 * `null` si no sirve: nulo, no finito, o fuera del rango físico de la esfera.
 *
 * El rango es el universal (lat ∈ [-90,90], long ∈ [-180,180]), no una regla
 * sobre dónde queda Chile — misma decisión que el motor, y por el mismo motivo:
 * solo descarta lo que no podría ser una coordenada en ningún lugar del planeta.
 */
export function puntoUsable(
  lat: number | null | undefined,
  long: number | null | undefined,
): Punto | null {
  if (typeof lat !== "number" || typeof long !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(long)) return null;
  if (lat < -90 || lat > 90 || long < -180 || long > 180) return null;
  return { lat, long };
}

/**
 * Metros entre cada parada y la anterior, en el orden recibido. Devuelve un
 * arreglo del MISMO largo que `paradas`, alineado posición a posición.
 *
 * - El primer tramo se mide desde `origen` (la bodega del courier), no desde
 *   `null`: la ruta empieza en la bodega y ese primer trayecto también cuenta.
 * - Una parada sin coordenada usable tiene tramo `null`, y **no rompe la
 *   cadena**: la siguiente se mide desde la última parada ubicada. Medir desde
 *   una parada cuya posición no conocemos daría un número inventado, y saltarla
 *   entera dejaría un hueco en el total.
 *
 * Ese encadenamiento es exactamente el que usa `costoPublico` del motor sobre la
 * subsecuencia ubicable, así que **la suma de los tramos no nulos coincide con
 * `distanciaTotalM`** para el mismo orden. Es lo que permite a la pantalla
 * mostrar un total que se actualiza al reordenar sin volver a llamar al motor,
 * sin que los dos números puedan divergir.
 */
export function distanciasPorTramo(
  origen: Punto,
  paradas: readonly ParadaConCoordenada[],
): (number | null)[] {
  let anterior: Punto = origen;

  return paradas.map((parada) => {
    const actual = puntoUsable(parada.lat, parada.long);
    if (!actual) return null;

    const metros = distanciaEnMetros(anterior, actual);
    anterior = actual;
    return metros;
  });
}

/**
 * Total de la ruta: la suma de los tramos no nulos.
 *
 * Es el mismo número que `RutaCalculada.distanciaTotalM` — de bodega a la última
 * parada ubicada, **nunca** con un tramo hacia el punto de término.
 */
export function totalDistanciaM(tramos: readonly (number | null)[]): number {
  return tramos.reduce<number>((suma, tramo) => suma + (tramo ?? 0), 0);
}

/**
 * Formato corto para pantalla: metros bajo el kilómetro, kilómetros con un
 * decimal por encima. Coma decimal, que es lo que se lee en Chile.
 */
export function formatearDistancia(metros: number | null): string {
  if (metros === null || !Number.isFinite(metros)) return "—";
  if (metros < 1000) return `${Math.round(metros)} m`;
  return `${(metros / 1000).toLocaleString("es-CL", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} km`;
}
