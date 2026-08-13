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
  obtenerConexionesPorSeller,
  obtenerResumenSaludMlPorTenant,
  renombrarConexion,
  obtenerEtiquetaEnvio,
  ErrorConexionMlRequiereRevinculacion,
  ErrorTopeCuentasMlAlcanzado,
  ErrorCuentaMlYaConectada,
} from "./puerto";

/**
 * Sincronización manual de una conexión. La UI llama a esto, no a `inngest.send`:
 * el nombre del evento y el orquestador son detalle de `integraciones`.
 */
export { solicitarSincronizacionMl } from "./sincronizacion";
export type { SolicitarSincronizacionMlEntrada } from "./sincronizacion";

export type {
  ConexionSellerMl,
  DesenlaceIntercambioMl,
  EstadoSaludConexionMl,
  IniciarAutorizacionEntrada,
  IniciarAutorizacionResultado,
  IntercambiarCodigoEntrada,
  IntercambiarCodigoResultado,
  ObtenerEtiquetaEnvioEntrada,
  ObtenerEtiquetaEnvioResultado,
  RazonFalloRefresco,
  RefrescarTokenEntrada,
  RefrescarTokenResultado,
  ResumenSaludMlTenant,
} from "./tipos";
