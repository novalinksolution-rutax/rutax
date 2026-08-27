/**
 * Tipos del puerto de OPTIMIZACIÓN de ruta — el solver completo, por calle.
 * =====================================================================
 *
 * Hermano de `tipos.ts`, y hay que no confundirlos:
 *
 * - `PuertoMatriz` (`tipos.ts`) entrega **distancias**, y el solver es nuestro
 *   (`operacion/ruteo/motor.ts`: vecino cercano + 2-opt + Or-opt).
 * - `PuertoOptimizacionRuta` (este archivo) entrega **la secuencia ya resuelta**
 *   por un servicio externo, con la geometría real de la calle.
 *
 * Los dos conviven a propósito. El motor local sigue siendo el camino por
 * defecto —determinista, sin red, US$0— y este puerto es el que se enciende
 * cuando el courier paga por ruta real con tráfico.
 *
 * =============================================================================
 * POR QUÉ ESTO NO ES UN ADAPTADOR MÁS DE `PuertoMatriz`
 * =============================================================================
 * Se evaluó y se descartó por PLATA, no por gusto. Los dos productos de Google
 * cobran por unidades distintas:
 *
 * - Compute Route Matrix cobra **por elemento** (orígenes × destinos). Una ruta
 *   de 30 paradas + bodega + ancla son 32×32 = 1.024 unidades. Crece al
 *   cuadrado.
 * - Route Optimization cobra **por envío**, o sea por parada: 30 unidades.
 *   Crece lineal.
 *
 * A volumen de un courier de 10 conductores eso es ~US$1.100/mes contra
 * ~US$28/mes por el mismo trabajo. Por eso la matriz se queda con el adaptador
 * de haversine y lo que se compra es el solver entero.
 *
 * =============================================================================
 * EL ANCLA ES UN PARÁMETRO Y NO SALE POR NINGÚN LADO
 * =============================================================================
 * `docs/seguridad/punto-de-termino-conductor.md` §4.3 manda sobre todo lo que
 * toque `destino`, y este puerto abre un canal que ese documento ya había
 * previsto: **el canal 3, la polilínea**.
 *
 * La regla, textual: *«termina en la última parada. Nunca se dibuja el tramo
 * final»*. Por eso `RutaOptimizada.tramos` tiene **exactamente tantos tramos
 * como paradas** —origen→1, 1→2, …, (n-1)→n— exista o no ancla. El tramo
 * n→ancla que el proveedor sí devuelve **se descarta dentro del adaptador**, no
 * en la pantalla: si viaja hasta el navegador del coordinador, ya se filtró.
 *
 * Lo mismo para `distanciaTotalM` y `duracionTotalS`, por el canal 5: se suman
 * sobre los tramos que quedan, nunca sobre lo que devolvió el proveedor.
 *
 * Y por el canal 4 (encuadre del mapa): como el ancla no sale, un `fitBounds`
 * sobre esta salida no puede delatarla ni por accidente.
 */

import type { Punto } from '@/lib/geo/distancia';

/**
 * Una parada a optimizar. A diferencia de `ParadaARutear` del motor local,
 * aquí `lat`/`long` **no son nulables**: el proveedor rechaza un punto sin
 * coordenada, así que separar las ubicables de las que no es responsabilidad
 * del llamador (`operacion/ruta-manifiesto.ts`), que ya lo hace para el motor
 * local con `puntoUsable`.
 *
 * Consecuencia deliberada: este puerto **no tiene** `sinUbicar`. Una parada sin
 * coordenada no llega hasta acá.
 */
export interface ParadaAOptimizar extends Punto {
  pedidoId: string;
}

export interface EntradaOptimizacion {
  /** Origen: la bodega del courier. Siempre presente. */
  origen: Punto;
  /**
   * Fin de ruta opcional: el punto de término del conductor. **Entra y no
   * sale.** Ver la cabecera de este archivo y el §4.3 del documento de
   * privacidad.
   */
  destino: Punto | null;
  paradas: readonly ParadaAOptimizar[];
}

/**
 * Un tramo entre dos puntos consecutivos de la ruta.
 *
 * `polilinea` es la geometría **por calle** codificada con el algoritmo de
 * polilíneas de Google — es exactamente lo que hace que el trazado del mapa
 * deje de ser una recta entre pines. `null` si el proveedor no la entregó.
 */
export interface TramoRuta {
  distanciaM: number;
  /** Segundos, con las condiciones de tráfico que aplique el proveedor. */
  duracionS: number;
  polilinea: string | null;
}

export interface RutaOptimizada {
  /** Las paradas en orden de visita. `orden` arranca en 1. */
  secuencia: readonly { pedidoId: string; orden: number }[];
  /**
   * Tramos de la ruta, en orden: origen→1, 1→2, …, (n-1)→n.
   *
   * ⚠️ **Siempre `secuencia.length` tramos**, exista o no ancla. El tramo final
   * hacia el punto de término se descarta en el adaptador. Canal 3 del §4.3.
   */
  tramos: readonly TramoRuta[];
  /** Suma de `tramos`. Nunca incluye el tramo al ancla. Canal 5. */
  distanciaTotalM: number;
  /** Suma de `tramos`. Nunca incluye el tramo al ancla. Canal 5. */
  duracionTotalS: number;
}
