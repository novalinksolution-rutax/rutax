/**
 * La hoja inferior — dónde queda al soltar el dedo.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * QUÉ ES, Y POR QUÉ NO ES UN PANEL LATERAL ENCOGIDO
 * -----------------------------------------------------------------------------
 * El sistema define la `hoja inferior` con tres rasgos: **media y completa**,
 * **con arrastre** y **con pie fijo**. Hoy, en un teléfono, los paneles de este
 * producto entran desde la derecha ocupando la pantalla entera — que es un panel
 * de escritorio al que le quitaron el ancho.
 *
 * La diferencia no es de estilo:
 *
 * · **Media deja ver lo de atrás.** El coordinador abre «pedidos seleccionados»
 *   para revisar qué lleva, y necesita seguir viendo la lista de la que los
 *   sacó. Un panel a pantalla completa lo obliga a cerrarlo para mirar, y a
 *   abrirlo otra vez para seguir.
 * · **El arrastre es la salida que el pulgar alcanza.** La «X» vive arriba a la
 *   derecha; en un teléfono grande, sostenido con una mano, ese punto queda
 *   fuera del alcance del pulgar. Arrastrar hacia abajo se hace desde donde ya
 *   está la mano.
 * · **El pie fijo es lo que evita el peor error de esta familia.** Con el
 *   contenido y el botón en el mismo desplazamiento, el «Asignar» queda debajo
 *   del pliegue y hay que recordar bajar hasta el final para encontrarlo. Es un
 *   defecto que este producto ya ha tenido.
 *
 * -----------------------------------------------------------------------------
 * LOS UMBRALES, Y POR QUÉ NO SON SIMÉTRICOS
 * -----------------------------------------------------------------------------
 * Un gesto **no se decide por dónde terminó, sino por lo que quiso hacer**. Por
 * eso hay dos caminos y no una regla de punto medio:
 *
 * · **Un arrastre corto y rápido es una intención**, aunque haya recorrido dos
 *   centímetros: si va hacia abajo, cerrar; hacia arriba, expandir. Es el
 *   movimiento que hace alguien apurado, y exigirle recorrer media pantalla lo
 *   obliga a repetirlo.
 * · **Un arrastre lento manda por su distancia**, porque ahí sí está mirando
 *   dónde suelta.
 *
 * Y **cerrar cuesta más que volver a media**: desde `completa`, un tirón hacia
 * abajo baja a `media` en vez de cerrar. Cerrar por accidente pierde el trabajo
 * que hay dentro de la hoja; quedarse en media no pierde nada.
 */

export type PuntoHoja = "media" | "completa";
export type DestinoHoja = PuntoHoja | "cerrar";

/** Cuánto de la ventana ocupa cada punto. */
export const ALTO_HOJA: Record<PuntoHoja, number> = {
  media: 0.58,
  // No llega a 1: el resto de la pantalla asomando por arriba es lo que dice,
  // sin una palabra, que esto es una capa y no una pantalla nueva.
  completa: 0.92,
};

/** Arriba de esta velocidad (px/ms) el gesto vale por su intención, no por su distancia. */
export const VELOCIDAD_INTENCION = 0.5;

/** Fracción de la ventana que hay que recorrer para que un arrastre lento cuente. */
export const FRACCION_ARRASTRE = 0.25;

/**
 * Dónde queda la hoja al soltar.
 *
 * `desplazamiento` es positivo hacia abajo, en píxeles. `velocidad` en px/ms,
 * con el mismo signo.
 */
export function destinoAlSoltar({
  punto,
  desplazamiento,
  velocidad,
  altoVentana,
}: {
  punto: PuntoHoja;
  desplazamiento: number;
  velocidad: number;
  altoVentana: number;
}): DestinoHoja {
  const rapido = Math.abs(velocidad) >= VELOCIDAD_INTENCION;
  const lejos = Math.abs(desplazamiento) >= altoVentana * FRACCION_ARRASTRE;

  // Ni rápido ni lejos: fue un roce. Se queda donde estaba.
  if (!rapido && !lejos) return punto;

  const haciaAbajo = (rapido ? velocidad : desplazamiento) > 0;

  if (haciaAbajo) {
    // ⚠️ Desde `completa` un tirón hacia abajo NO cierra: baja a `media`.
    // Cerrar por accidente pierde lo que haya dentro; quedarse en media, nada.
    return punto === "completa" ? "media" : "cerrar";
  }
  return "completa";
}

/**
 * Alto de la hoja mientras el dedo la arrastra.
 *
 * ⚠️ **Hacia arriba se resiste.** Pasado el tope, el arrastre avanza a un tercio
 * — la hoja «se estira» y vuelve. Sin eso, el dedo sigue subiendo y la hoja se
 * queda clavada sin señal alguna, que se lee como que la aplicación se colgó.
 * Hacia abajo no hay resistencia: ahí el gesto sí puede terminar en cerrar.
 */
export function altoDurante({
  punto,
  desplazamiento,
  altoVentana,
}: {
  punto: PuntoHoja;
  desplazamiento: number;
  altoVentana: number;
}): number {
  const base = altoVentana * ALTO_HOJA[punto];
  const propuesto = base - desplazamiento;
  const tope = altoVentana * ALTO_HOJA.completa;
  if (propuesto <= tope) return Math.max(0, propuesto);
  return tope + (propuesto - tope) / 3;
}
