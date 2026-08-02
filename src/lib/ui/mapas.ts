/**
 * Helpers de navegación a mapas (conductor en terreno).
 * =====================================================================
 * Construyen enlaces universales a Google Maps y Waze desde una dirección de
 * texto. Viven en `src/lib/ui/` para reusarse entre el detalle de parada y la
 * ruta completa del manifiesto (CLAUDE.md: helpers de presentación compartidos).
 */

/** Tope de paradas por URL de ruta: Google Maps `dir` soporta ~10 puntos. */
export const MAX_PARADAS_RUTA = 10;

/** Búsqueda de una dirección en Google Maps (abre la ficha del lugar). */
export function urlGoogleMapsBusqueda(direccion: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(direccion)}`;
}

/** Navegación a una dirección en Waze (muchos conductores en Chile lo prefieren). */
export function urlWazeBusqueda(direccion: string): string {
  return `https://waze.com/ul?q=${encodeURIComponent(direccion)}&navigate=yes`;
}

/**
 * Ruta multi-parada en Google Maps. El origen se omite → usa la ubicación del
 * dispositivo. Devuelve `null` si no hay paradas. Se recorta a `MAX_PARADAS_RUTA`
 * por el límite de la URL; el conductor navega el resto parada por parada.
 */
export function urlGoogleMapsRuta(direcciones: string[]): string | null {
  const dirs = direcciones.map((d) => d.trim()).filter(Boolean).slice(0, MAX_PARADAS_RUTA);
  if (dirs.length === 0) return null;

  const destino = dirs[dirs.length - 1];
  const waypoints = dirs.slice(0, -1);
  const base = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destino)}&travelmode=driving`;
  if (waypoints.length === 0) return base;
  return `${base}&waypoints=${waypoints.map((w) => encodeURIComponent(w)).join("|")}`;
}
