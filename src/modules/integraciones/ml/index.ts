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
  obtenerEtiquetaEnvio,
  ErrorConexionMlRequiereRevinculacion,
} from "./puerto";

export type {
  ConexionSellerMl,
  EstadoSaludConexionMl,
  IniciarAutorizacionEntrada,
  IniciarAutorizacionResultado,
  IntercambiarCodigoEntrada,
  ObtenerEtiquetaEnvioEntrada,
  ObtenerEtiquetaEnvioResultado,
  RazonFalloRefresco,
  RefrescarTokenEntrada,
  RefrescarTokenResultado,
} from "./tipos";
