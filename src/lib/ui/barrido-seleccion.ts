/**
 * El barrido vertical — seleccionar arrastrando el dedo.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * EL TERCER NIVEL DE SELECCIÓN, Y POR QUÉ HACE FALTA
 * -----------------------------------------------------------------------------
 * El sistema define **tres** niveles de selección táctil: la fila suelta, la
 * cabecera de grupo, y **el barrido vertical**. Los dos primeros ya existían; el
 * que falta es justo el que usa la operación real:
 *
 * El coordinador filtra el panel —Vitacura + Lo Barnechea + Las Condes, 40
 * pedidos—, **selecciona 30 y los asigna en bloque**. Con un toque por fila son
 * treinta toques de pie en la bodega, con el camión descargando al lado y el
 * reloj corriendo hacia las 16:00. Con un barrido es un gesto.
 *
 * -----------------------------------------------------------------------------
 * EL SENTIDO LO FIJA LA PRIMERA FILA, Y CADA FILA SE TOCA UNA SOLA VEZ
 * -----------------------------------------------------------------------------
 * Si el barrido empieza sobre una fila **sin marcar**, todo lo que toque se
 * marca; si empieza sobre una **marcada**, todo se desmarca. Nunca alterna fila
 * por fila.
 *
 * Alternar sería el comportamiento «obvio» y es el equivocado: el dedo pasa dos
 * veces por la misma fila solo cuando tiembla o corrige el rumbo, y el
 * coordinador terminaría con un puñado de pedidos sin marcar sin haberse dado
 * cuenta. Por eso se lleva el registro de lo ya tocado: **volver a pasar por
 * encima no hace nada**, que es lo que la mano espera.
 *
 * ⚠️ Y ese registro es además lo que hace correcto el gesto con una API de
 * *alternar*: la pantalla de asignar no expone «marca esto», expone
 * `onAlternarUno`. Sin `tocadas`, un segundo roce sobre la misma fila la
 * desharía.
 */

export interface EstadoBarrido {
  /** Qué le pasa a todo lo que toque: `true` marca, `false` desmarca. */
  objetivo: boolean;
  /** Filas ya aplicadas en este barrido. */
  tocadas: Set<string>;
}

/** Empieza un barrido. El sentido sale del estado de la primera fila, invertido. */
export function iniciarBarrido(estabaMarcada: boolean): EstadoBarrido {
  return { objetivo: !estabaMarcada, tocadas: new Set() };
}

/**
 * Qué filas de un tramo hay que alternar para que queden como manda el barrido.
 *
 * ⚠️ **El tramo existe porque el dedo se mueve más rápido que los eventos.** Al
 * barrer con ganas, el navegador emite un `pointerenter` cada varios píxeles y
 * **se salta filas enteras**: sin esto, un barrido rápido deja huecos sin marcar
 * en medio de la selección, y el coordinador asigna 24 pedidos creyendo que
 * asignó 30.
 *
 * `desde` y `hasta` son índices de la lista visible, en cualquier orden. Las
 * filas devueltas quedan anotadas como tocadas: quien llama solo tiene que
 * alternarlas.
 */
export function filasAAlternar(
  barrido: EstadoBarrido,
  ids: readonly string[],
  desde: number,
  hasta: number,
  estaMarcada: (id: string) => boolean,
): string[] {
  const ini = Math.max(0, Math.min(desde, hasta));
  const fin = Math.min(ids.length - 1, Math.max(desde, hasta));
  const alternar: string[] = [];
  for (let i = ini; i <= fin; i += 1) {
    const id = ids[i];
    if (barrido.tocadas.has(id)) continue;
    barrido.tocadas.add(id);
    if (estaMarcada(id) !== barrido.objetivo) alternar.push(id);
  }
  return alternar;
}
