/**
 * Cartografía de la Torre v2 — de dónde sale cada activo del mapa.
 * =============================================================================
 *
 * Tres activos, con ciclos de vida distintos, y por eso se sirven distinto:
 *
 * 1. GEOMETRÍA COMUNAL (DPA 2023) — 113 KB, **versionada** en `public/mapas/`.
 *    Sin ella no hay comunas que pintar y el mapa deja de existir; cambia una
 *    vez cada varios años. Es COMUNAL a propósito, nunca disuelta por zona:
 *    cada courier agrupa sus comunas distinto (el disuelto lo hace el cliente).
 *
 * 2. BASEMAP (PMTiles recortado a la RM) — ~19 MB, **fuera del repo**, en el
 *    bucket público `contexto-mapas`. Se regenera del build público de
 *    Protomaps con `scripts/mapa/construir-basemap.mjs` y se sube con
 *    `scripts/mapa/publicar-basemap.mjs`.
 *
 * 3. GLIFOS DE FUENTE (PBF) — ~410 KB, **fuera del repo**, junto al basemap.
 *    Nuevos en la v2: la v1 no los necesitaba porque su basemap no tenía una
 *    sola etiqueta. Ver `docs/torre-de-control/lenguaje-visual-v2.md` §5.
 *
 * DEGRADACIÓN: sin basemap el mapa SIGUE funcionando — pinta las comunas sobre
 * el color de tierra, sin plano urbano debajo. Es un estado válido y declarado.
 * Lo que se pierde ahí es ubicar el punto de entrega, que es justo lo que el
 * plano aporta; por eso la pantalla lo dice en vez de disimularlo.
 */

/** Geometría comunal DPA 2023, servida como estático del propio Next. */
export const RUTA_TOPOJSON_COMUNAS = '/mapas/comunas-rm.topojson.json';

/** Nombre de la capa dentro del TopoJSON (lo fija el script de generación). */
export const CAPA_TOPOJSON = 'comunas';

/**
 * URL del PMTiles del basemap, o `null` si no está publicado.
 *
 * `NEXT_PUBLIC_` porque MapLibre lo pide desde el navegador con requests de
 * rango HTTP. No es un secreto: es cartografía OSM en un bucket público.
 */
export function urlBasemap(): string | null {
  const url = process.env.NEXT_PUBLIC_MAPA_BASEMAP_URL?.trim();
  return url ? url : null;
}

/**
 * Base de los glifos: MapLibre le pega `/{fontstack}/{range}.pbf`.
 *
 * Si no está definida, el estilo se construye SIN etiquetas (ver `estilo.ts`):
 * un `glyphs` apuntando a la nada hace que MapLibre descarte la capa `symbol`
 * entera y deje el plano mudo, que es justo lo que la v2 vino a corregir. Mejor
 * un plano sin nombres a propósito que uno roto por accidente.
 */
export function urlGlifos(): string | null {
  const url = process.env.NEXT_PUBLIC_MAPA_GLIFOS_URL?.trim();
  return url ? url.replace(/\/$/, '') : null;
}

/**
 * Atribución visible al pie del mapa. **No es opcional y no puede esconderse
 * tras un botón de «i»:**
 *
 * - OpenStreetMap la exige por licencia (ODbL) para cualquier obra derivada.
 * - La DPA 2023 es de SUBDERE/INE, y citarla le dice al coordinador que los
 *   límites que ve son los oficiales y no un dibujo.
 * - Noto Sans se distribuye bajo la SIL Open Font License, que pide conservar
 *   el aviso de licencia junto a los archivos de fuente (va en el bucket, con
 *   el `OFL.txt` al lado); acá se nombra porque es texto que se ve en pantalla.
 *
 * La de OpenWeather **se retiró** con el apagado de clima y aire (Vía A): ya no
 * queda un solo dato de OpenWeather en el producto.
 */
export const ATRIBUCIONES = [
  { etiqueta: '© OpenStreetMap', href: 'https://www.openstreetmap.org/copyright' },
  { etiqueta: 'Límites DPA 2023 · SUBDERE/INE', href: 'https://www.ide.cl/' },
] as const;
