/**
 * Geometría mínima: distancia entre dos puntos y pertenencia a un radio.
 * =====================================================================
 *
 * Es TODO el cálculo geométrico que hace el servidor. No se instala PostGIS a
 * propósito: los dos cruces que el producto necesita —¿este evento cae sobre
 * esta zona?, ¿este pedido cae dentro de este perímetro?— están modelados como
 * círculos en el contrato de la Torre de control (`radioMetros` en eventos de
 * ciudad, celdas de clima y marcas operativas). Todo es centro + radio; no hay
 * un solo polígono que consultar en SQL.
 *
 * Menos exacto que una intersección de polígonos, suficiente para decidir, y
 * ahorra una extensión de Postgres que después hay que operar y versionar.
 *
 * Funciones puras, sin I/O. La proyección del mapa vive aparte: esto es
 * distancia sobre la esfera, no coordenadas de pantalla.
 */

/** Radio medio de la Tierra en metros (esfera IUGG). */
const RADIO_TIERRA_M = 6_371_008.8;

export interface Punto {
  lat: number;
  long: number;
}

const aRadianes = (grados: number) => (grados * Math.PI) / 180;

/**
 * Distancia del gran círculo entre dos puntos, en metros (haversine).
 *
 * A la escala de la Región Metropolitana (~130 km de extremo a extremo) el
 * error contra un elipsoide es de metros: irrelevante para decidir si un pedido
 * cae dentro de un perímetro de 1,8 km.
 */
export function distanciaEnMetros(a: Punto, b: Punto): number {
  const deltaLat = aRadianes(b.lat - a.lat);
  const deltaLong = aRadianes(b.long - a.long);
  const latA = aRadianes(a.lat);
  const latB = aRadianes(b.lat);

  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(latA) * Math.cos(latB) * Math.sin(deltaLong / 2) ** 2;

  return 2 * RADIO_TIERRA_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * ¿El punto cae dentro del círculo de centro `centro` y radio `radioMetros`?
 *
 * El borde cuenta como dentro: un pedido justo sobre el perímetro de un corte
 * de tránsito está afectado. Un radio no positivo no contiene a nadie.
 */
export function estaDentroDelRadio(
  punto: Punto,
  centro: Punto,
  radioMetros: number,
): boolean {
  if (!(radioMetros > 0)) return false;
  return distanciaEnMetros(punto, centro) <= radioMetros;
}
