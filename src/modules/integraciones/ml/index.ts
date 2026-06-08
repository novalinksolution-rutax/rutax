/**
 * Punto de entrada público del puerto OAuth de Mercado Libre.
 *
 * Solo lo expuesto aquí es "el puerto". `cliente-http.ts` y los helpers
 * internos de `puerto.ts` son detalles de implementación — no los importes
 * directo desde fuera de `integraciones/ml`.
 */
export {
  iniciarAutorizacion,
  intercambiarCodigoPorTokens,
  refrescarToken,
  obtenerConexionPorSeller,
} from "./puerto";

export type {
  ConexionSellerMl,
  EstadoSaludConexionMl,
  IniciarAutorizacionEntrada,
  IniciarAutorizacionResultado,
  IntercambiarCodigoEntrada,
  RazonFalloRefresco,
  RefrescarTokenEntrada,
  RefrescarTokenResultado,
} from "./tipos";
