/**
 * Tipos públicos del motor de ruteo — etapa 7 de "retiro en bodega + ruteo"
 * (`docs/arquitectura/retiro-y-ruteo.md` §4/§4.1,
 * `docs/arquitectura/retiro-y-ruteo-plan.md` §Etapa 7).
 * =====================================================================
 *
 * `RutaCalculada` es, a propósito, la ÚNICA superficie por la que un dato
 * podría colarse hacia el coordinador. Ver
 * `docs/seguridad/punto-de-termino-conductor.md` §4 (revisión de privacidad
 * previa a construir, manda sobre este alcance en todo lo que toque
 * `destino`): el punto de término del conductor entra como PARÁMETRO del
 * cálculo, nunca como valor de salida — por eso este tipo no tiene un solo
 * campo donde quepa una coordenada del destino, ni siquiera indirectamente
 * (ver la nota de `distanciaTotalM` abajo). Si algún día alguien agrega un
 * campo a `RutaCalculada`, tiene que releer esa sección primero.
 */

import type { Punto } from '@/lib/geo/distancia';

/** Una parada candidata a rutear: el pedido, con su coordenada si la tiene. */
export interface ParadaARutear {
  pedidoId: string;
  lat: number | null;
  long: number | null;
  /**
   * Posición 1-based que el conductor le impuso a mano. `undefined`/`null` =
   * el motor decide dónde va.
   *
   * Existe porque **una corrección manual que el motor deshace es peor que no
   * tener motor**: el conductor arregla el salto absurdo del Mapocho y treinta
   * segundos después el recálculo se lo borra. Ver `paradas-fijas.ts`.
   */
  ordenFijo?: number | null;
}

export interface EntradaRuteo {
  /** Origen: la bodega del courier. Siempre presente. */
  origen: Punto;
  /**
   * Fin de ruta opcional: el punto de término del conductor
   * (futura `operacion.punto_termino_conductor`). Es un PARÁMETRO del
   * cálculo, igual que la fórmula de haversine: entra en la función de costo
   * y no sale por el otro lado (`RutaCalculada` no lo referencia jamás).
   * `null` = el conductor no lo definió, o no ejerció el consentimiento: la
   * ruta termina en la última parada y la FORMA de la salida es idéntica a
   * la del caso con destino (ver `motor.ts` y `costo.ts`).
   */
  destino: Punto | null;
  paradas: readonly ParadaARutear[];
}

/**
 * Por qué una parada no entró a la secuencia. Hoy solo hay un motivo — sin
 * coordenada usable (nula, no finita, o fuera del rango físico de lat/long,
 * que es la forma que toma una coordenada corrupta) — porque es el único que
 * define el contrato de esta etapa. Nunca se descarta una parada en
 * silencio: toda la que no entra a `secuencia` aparece aquí.
 */
export interface ParadaSinUbicar {
  pedidoId: string;
  motivo: 'sin_coordenada';
}

export interface RutaCalculada {
  /** Las paradas en el orden de visita. `orden` arranca en 1 (primera parada = 1). */
  secuencia: readonly { pedidoId: string; orden: number }[];
  /** Las que no se pudieron rutear, con su motivo. Nunca se descartan en silencio. */
  sinUbicar: readonly ParadaSinUbicar[];
  /**
   * Metros de bodega a la ÚLTIMA parada de `secuencia`. SIEMPRE se calcula
   * así, exista o no `destino` — nunca incluye el tramo final hacia el punto
   * de término.
   *
   * Es la condición dura de `punto-de-termino-conductor.md` §4.3 (canal 5,
   * "Totales de distancia y duración"): sumarle el tramo a casa permitiría,
   * comparando los totales de dos conductores con las mismas paradas, deducir
   * quién definió un punto de término y a qué distancia. `destino` SÍ influye
   * en qué orden termina eligiendo el optimizador (es la razón de que exista
   * — ver `motor.ts`), pero nunca en este número: el número siempre se
   * recalcula desde cero como "origen → primera → … → última", sin importar
   * qué tan cerca o lejos haya quedado el destino de la última parada.
   */
  distanciaTotalM: number;
}
