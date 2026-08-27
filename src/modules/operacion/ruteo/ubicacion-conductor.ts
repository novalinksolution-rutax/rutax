/**
 * La posición que la app del conductor manda para rutear desde donde está.
 * =============================================================================
 *
 * Vive en un módulo y no dentro del `route.ts` porque un archivo de ruta de Next
 * solo puede exportar sus manejadores HTTP: sacarlo acá es lo que permite
 * probarlo, y esta función es exactamente la que hay que probar.
 *
 * ⚠️ **La posición NO se persiste en ninguna parte.** Entra en la función de
 * costo del solver y no sale por el otro lado, igual que el ancla de término:
 * ninguna columna la guarda, no viaja al coordinador y no deja recorrido
 * (Ley 21.431 — `docs/seguridad/punto-de-termino-conductor.md`). Lo único que
 * queda escrito es el ORDEN resultante.
 */

/**
 * Valida la posición que manda la app.
 *
 * Falla CERRADO: cualquier cosa que no sean dos números en rango se ignora y la
 * ruta sale desde la bodega, que es el comportamiento de siempre. Un origen
 * basura desplazaría la secuencia entera sin que nadie lo note — mejor una ruta
 * como antes que una ruta calculada desde el Golfo de Guinea.
 */
export function ubicacionUsable(valor: unknown): { lat: number; long: number } | null {
  if (typeof valor !== "object" || valor === null) return null;
  const v = valor as { lat?: unknown; long?: unknown };
  if (typeof v.lat !== "number" || typeof v.long !== "number") return null;
  if (!Number.isFinite(v.lat) || !Number.isFinite(v.long)) return null;
  if (v.lat < -90 || v.lat > 90 || v.long < -180 || v.long > 180) return null;
  // (0,0) es el valor que devuelve un GPS que no fijó posición, no una
  // coordenada real: cae en el Atlántico y arruinaría la secuencia entera.
  if (v.lat === 0 && v.long === 0) return null;
  return { lat: v.lat, long: v.long };
}

