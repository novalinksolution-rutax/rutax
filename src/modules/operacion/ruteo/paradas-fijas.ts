/**
 * Paradas fijadas — lo que el conductor movió a mano y el motor no puede
 * volver a mover.
 * =============================================================================
 *
 * =============================================================================
 * POR QUÉ ESTO EXISTE, Y ES LA RAZÓN DE QUE LA APP SIRVA
 * =============================================================================
 * El motor mide en línea recta y a veces propone un salto absurdo: la parada 7
 * al otro lado del Mapocho y la 8 de vuelta. El conductor lo corrige con el
 * dedo. **Si la siguiente re-optimización se lo deshace, deja de usar la app** —
 * y con razón: arregló algo y el sistema se lo borró treinta segundos después.
 *
 * Por eso una parada movida a mano queda FIJA: conserva su posición en todos
 * los recálculos siguientes, hasta que el propio conductor la vuelva a mover.
 *
 * =============================================================================
 * LA ESTRATEGIA: SE OPTIMIZA LO LIBRE Y SE INSERTA LO FIJO
 * =============================================================================
 * `separarFijas` saca las fijadas, el motor ordena solo las libres, y
 * `fusionarConFijas` las devuelve a su sitio exacto.
 *
 * **No es el óptimo global y se elige igual.** Un solver que conociera las
 * posiciones fijas podría elegir mejor qué parada libre va justo antes de una
 * fijada. La diferencia, con 24 paradas y una o dos fijas, es de unos cientos
 * de metros; lo que se gana a cambio es que la promesa se cumpla al pie de la
 * letra: **la parada que el conductor fijó aparece exactamente donde la dejó,
 * siempre, sin excepciones que haya que explicar**. En una función cuya razón
 * de ser es la confianza, la predecibilidad vale más que el metro.
 *
 * Y sirve para los DOS motores —el local y el de Google— sin que ninguno
 * necesite saber nada de esto: los dos reciben solo las libres.
 */

/** Una parada con su posición impuesta, 1-based. */
export interface ParadaFijada {
  pedidoId: string;
  /** Posición que DEBE ocupar en la secuencia final. Empieza en 1. */
  orden: number;
}

/**
 * Separa lo fijado de lo libre.
 *
 * Una parada aparece en `fijas` solo si trae `ordenFijo` **usable**: entero y
 * ≥ 1. Un valor corrupto (0, negativo, fraccionario, `NaN`) se trata como
 * libre en vez de lanzar — el llamador es una ruta HTTP que puede recibir
 * cualquier cosa, y una posición ilegible no puede impedir que se calcule la
 * ruta del día.
 */
export function separarFijas<T extends { pedidoId: string; ordenFijo?: number | null }>(
  paradas: readonly T[],
): { fijas: ParadaFijada[]; libres: T[] } {
  const fijas: ParadaFijada[] = [];
  const libres: T[] = [];

  for (const parada of paradas) {
    const orden = parada.ordenFijo;
    if (typeof orden === 'number' && Number.isInteger(orden) && orden >= 1) {
      fijas.push({ pedidoId: parada.pedidoId, orden });
    } else {
      libres.push(parada);
    }
  }

  return { fijas, libres };
}

/**
 * Devuelve las fijadas a su posición dentro de la secuencia optimizada.
 *
 * ## Las reglas de desempate, que son donde esto se rompe si no se piensan
 *
 * - **Dos fijas con el mismo orden**: gana la primera y la otra se trata como
 *   una más (se inserta a continuación). No se lanza: dos posiciones iguales
 *   son un estado que la base puede llegar a tener y perder la ruta del día
 *   por eso sería peor que resolverlo.
 * - **Un orden más allá del final** (fijar la 30 con 24 paradas): se pega al
 *   final en vez de dejar huecos. Una secuencia con agujeros no significa
 *   nada para un conductor.
 * - **El resultado nunca pierde ni duplica una parada.** Es la única invariante
 *   dura de esta función y la prueba la fija con un caso adversarial.
 */
export function fusionarConFijas(
  secuenciaLibre: readonly string[],
  fijas: readonly ParadaFijada[],
): string[] {
  if (fijas.length === 0) return [...secuenciaLibre];

  // Menor orden primero. Empate resuelto por el orden de llegada, que es
  // estable: dos corridas con la misma entrada dan la misma salida.
  const ordenadas = [...fijas].sort((a, b) => a.orden - b.orden);

  const resultado: string[] = [];
  const librePendiente = [...secuenciaLibre];
  const yaPuesta = new Set<string>();

  for (const fija of ordenadas) {
    if (yaPuesta.has(fija.pedidoId)) continue;
    // Rellenar con libres hasta que la posición de la fija sea la siguiente.
    // `orden - 1` porque `resultado.length` es 0-based.
    while (resultado.length < fija.orden - 1 && librePendiente.length > 0) {
      resultado.push(librePendiente.shift() as string);
    }
    resultado.push(fija.pedidoId);
    yaPuesta.add(fija.pedidoId);
  }

  // Lo que sobró de libres va al final, en el orden que decidió el motor.
  resultado.push(...librePendiente);

  return resultado;
}
