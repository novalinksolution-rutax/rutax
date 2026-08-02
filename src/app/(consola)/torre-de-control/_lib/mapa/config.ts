/**
 * Cartografía de R3 — de dónde salen los dos activos del mapa.
 * ===========================================================================
 *
 * Son dos, con ciclos de vida opuestos, y por eso se sirven distinto:
 *
 * 1. GEOMETRÍA COMUNAL (DPA 2023) — 113 KB, versionada en `public/mapas/`.
 *    Es el dato que el módulo NO puede perder: sin ella no hay zonas que pintar
 *    y el mapa deja de existir. Cambia una vez cada varios años (cuando la
 *    SUBDERE publica una DPA nueva), así que vive en el repo, entra en el
 *    diff de una revisión y no depende de que nadie haya subido nada.
 *
 *    Es COMUNAL a propósito, no disuelta por zona: cada courier agrupa sus
 *    comunas distinto, así que disolver en el build fijaría la agrupación de
 *    un tenant para todos. La disolución comuna→zona se hace en el cliente
 *    con `topojson-client.merge()` — ver `geometria.ts`.
 *
 * 2. BASEMAP (PMTiles recortado a la RM) — ~19 MB, FUERA del repo, en el
 *    bucket público `contexto-mapas`. No se versiona por dos razones: pesa
 *    tres órdenes de magnitud más que la geometría, y se regenera del build
 *    público de Protomaps cada vez que se quiera OSM más fresco. Se publica
 *    con `scripts/mapa/publicar-cartografia.mjs`.
 *
 * DEGRADACIÓN: si el basemap no está publicado (`NEXT_PUBLIC_MAPA_BASEMAP_URL`
 * vacía) el mapa SIGUE funcionando — pinta las zonas sobre Papel, sin el
 * plano urbano debajo. Es exactamente lo que el módulo necesita para
 * responder «dónde»; el basemap es orientación, no dato. Un mapa que se cae
 * entero porque falta un tile de calle sería peor que uno sobrio.
 */

/** Geometría comunal DPA 2023, servida como estático del propio Next. */
export const RUTA_TOPOJSON_COMUNAS = "/mapas/comunas-rm.topojson.json";

/** Nombre de la capa dentro del TopoJSON (lo fija el script de generación). */
export const CAPA_TOPOJSON = "comunas";

/**
 * URL del archivo PMTiles del basemap, o `null` si no está publicado.
 *
 * `NEXT_PUBLIC_` porque MapLibre lo pide desde el navegador con requests de
 * rango HTTP. No es un secreto: es cartografía OSM en un bucket público.
 */
export function urlBasemap(): string | null {
  const url = process.env.NEXT_PUBLIC_MAPA_BASEMAP_URL?.trim();
  return url ? url : null;
}

/**
 * Atribución visible en el borde del mapa.
 *
 * NO es opcional y NO puede ir escondida tras un botón de «i»:
 * - OpenStreetMap la exige por licencia (ODbL) para cualquier obra derivada.
 * - OpenWeather permite el tier gratuito en un SaaS comercial **a cambio de
 *   atribución visible en pantalla** — es la condición que hizo viable
 *   reemplazar a Open-Meteo, cuyo tier libre prohíbe el uso comercial.
 * - La DPA 2023 es de SUBDERE/INE y citarla es, además, lo que le dice al
 *   coordinador que los límites que ve son los oficiales y no un dibujo.
 *
 * El handoff no le dejó espacio en la retícula; se lo abre R3 con una franja
 * propia al pie del mapa (ver `atribucion-mapa.tsx`).
 */
export const ATRIBUCIONES = [
  { etiqueta: "© OpenStreetMap", href: "https://www.openstreetmap.org/copyright" },
  // Texto LITERAL que exige la licencia del tier gratuito de OpenWeather
  // («Weather data provided by OpenWeather» + enlace al sitio). Es la condición
  // bajo la cual un producto comercial puede usar el tier gratuito: no es una
  // etiqueta que se pueda acortar ni traducir a gusto.
  { etiqueta: "Weather data provided by OpenWeather", href: "https://openweathermap.org/" },
  { etiqueta: "Límites DPA 2023 · SUBDERE/INE", href: "https://www.ide.cl/" },
] as const;
