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

/**
 * Cuántos ids caben en un `.in(...)` sin acercarse al límite de largo de URL.
 * 200 UUIDs ≈ 7 KB de query string, holgado frente al techo típico de 8-16 KB.
 */
const LOTE_IDS = 200;

/**
 * Lee filas filtrando por una lista de ids, **en lotes**.
 *
 * `.in('col', [...])` viaja en el query string, así que una lista que crece con
 * el volumen del tenant revienta el largo máximo de URL y PostgREST responde
 * `URI too long`. A diferencia del corte por `max_rows`, este SÍ es un error —
 * pero se pierde igual si el llamador lo atrapa por elemento, que es exactamente
 * lo que dejó muerto al detector de líneas huérfanas durante meses: fallaba
 * entero, el `catch` por-tenant lo logueaba, y el resumen informaba
 * "0 hallazgos", que se lee como "todo limpio".
 *
 * **Regla: nunca construir un `.in()` cuyo tamaño dependa del tamaño del tenant.**
 * Si la lista viene de otra consulta, va por acá.
 *
 * Devuelve la unión de todos los lotes, en el orden en que llegaron.
 */
export async function leerPorLotesDeIds<T>(
  etiqueta: string,
  ids: readonly string[],
  consultar: (lote: string[]) => PromiseLike<RespuestaPagina<T>>,
  opciones: { tamanoLote?: number } = {},
): Promise<T[]> {
  if (ids.length === 0) return [];

  const tamano = opciones.tamanoLote ?? LOTE_IDS;
  const acumulado: T[] = [];

  for (let desde = 0; desde < ids.length; desde += tamano) {
    const { data, error } = await consultar(ids.slice(desde, desde + tamano) as string[]);
    if (error) throw new Error(`Error al leer ${etiqueta}: ${error.message}`);
    acumulado.push(...(data ?? []));
  }

  return acumulado;
}
