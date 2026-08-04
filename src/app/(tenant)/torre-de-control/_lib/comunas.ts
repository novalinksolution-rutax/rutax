/**
 * Clave de comparación de nombres de comuna, del lado del CLIENTE.
 * =============================================================================
 *
 * **Por qué no se reusa `normalizarComuna` de `integraciones/geocoding`**, que
 * hace exactamente esto: ese módulo importa `node:crypto` para el hash del caché
 * de geocoding, y arrastrarlo a un componente de cliente metería Node en el
 * bundle del navegador. Cinco líneas duplicadas cuestan menos que eso.
 *
 * ⚠️ **Las dos tienen que producir la misma clave.** El servidor empareja
 * comunas con `normalizarComuna` y acá se emparejan contra la geometría DPA
 * 2023; si divergieran, una comuna dejaría de pintarse sin que nada falle — que
 * es la forma más cara de romper este mapa. Hay una prueba que las compara.
 */

/**
 * Sin acentos, en minúsculas y sin espacios de sobra.
 *
 * No resuelve sinónimos ni abreviaturas: «Estación Central» y «Est. Central» son
 * claves distintas. Alcanza porque los dos extremos salen de catálogos, no de
 * texto libre.
 */
export function claveComuna(nombre: string): string {
  // Mismos pasos y mismo orden que `normalizarTexto` del servidor. El orden
  // importa: colapsar espacios antes de recortar deja un espacio en los
  // extremos si el original venía con varios.
  return nombre
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
