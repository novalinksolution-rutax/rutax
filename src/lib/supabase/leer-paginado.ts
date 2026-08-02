/**
 * Lectura paginada — la defensa contra el tope silencioso de PostgREST.
 * =====================================================================
 *
 * `supabase/config.toml` fija `max_rows = 1000`. Una consulta que devuelve más
 * filas **no falla**: devuelve las primeras 1.000 y ya. No hay error, no hay
 * aviso, no hay diferencia visible entre "hay 1.000" y "hay 40.000".
 *
 * Eso es tolerable en una tabla que se pagina en pantalla, y es un bug de
 * datos en cualquier consulta que después se AGREGA: un conteo por zona, una
 * suma de dinero, un pronóstico por comuna. El resultado sale plausible y
 * equivocado, que es la peor clase de error.
 *
 * Este helper recorre la consulta por páginas hasta agotarla. Se le pasa una
 * función que aplica `.range(desde, hasta)` sobre la consulta ya construida.
 *
 * ```ts
 * const filas = await leerTodasLasFilas('clima_horario', (desde, hasta) =>
 *   supabase.schema('contexto').from('clima_horario')
 *     .select('comuna, hora')
 *     .gte('hora', desdeInstante)
 *     .range(desde, hasta),
 * );
 * ```
 *
 * `tope` existe para que un error de filtro no se convierta en una descarga sin
 * fin: al superarlo, lanza en vez de seguir pidiendo páginas.
 */

/** Tamaño de página. Igual al `max_rows` de PostgREST: una página = un viaje. */
const TAMANO_PAGINA = 1000;

/** Tope de seguridad por defecto. Un filtro mal puesto falla, no descarga sin fin. */
const TOPE_POR_DEFECTO = 100_000;

interface RespuestaPagina<T> {
  data: T[] | null;
  error: { message: string } | null;
}

export async function leerTodasLasFilas<T>(
  etiqueta: string,
  consultar: (desde: number, hasta: number) => PromiseLike<RespuestaPagina<T>>,
  opciones: { tamanoPagina?: number; tope?: number } = {},
): Promise<T[]> {
  const tamano = opciones.tamanoPagina ?? TAMANO_PAGINA;
  const tope = opciones.tope ?? TOPE_POR_DEFECTO;

  const acumulado: T[] = [];
  let desde = 0;

  for (;;) {
    const { data, error } = await consultar(desde, desde + tamano - 1);
    if (error) throw new Error(`Error al leer ${etiqueta}: ${error.message}`);

    const pagina = data ?? [];
    acumulado.push(...pagina);

    // Página incompleta = era la última. Es la única señal fiable: PostgREST no
    // dice "hay más" salvo que se le pida el `count`, que cuesta un escaneo.
    if (pagina.length < tamano) return acumulado;

    if (acumulado.length >= tope) {
      throw new Error(
        `Lectura de ${etiqueta} superó el tope de ${tope} filas. ` +
          `Casi siempre significa que falta un filtro, no que haya tantos datos.`,
      );
    }

    desde += tamano;
  }
}
