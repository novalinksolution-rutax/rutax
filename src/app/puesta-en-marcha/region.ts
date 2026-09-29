/**
 * Caja envolvente de la Región Metropolitana (con holgura: hay couriers que
 * reparten en Melipilla, Colina o Paine). Es la misma caja que acota el mapa de
 * la Torre (`ENCUADRE_RM.limites`), copiada aquí para que el paso 2 no dependa
 * de las carpetas privadas de otra pantalla. Sirve a la vez a la validación de
 * servidor (H8: fuera de cobertura) y al pin del cliente.
 */
export const LIMITES_REGION: readonly [readonly [number, number], readonly [number, number]] = [
  [-71.9, -34.45],
  [-69.6, -32.8],
];

export function dentroDeLaRegion(lat: number, long: number): boolean {
  const [[oeste, sur], [este, norte]] = LIMITES_REGION;
  return long >= oeste && long <= este && lat >= sur && lat <= norte;
}
