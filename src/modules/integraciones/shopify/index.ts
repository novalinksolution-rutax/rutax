/**
 * Superficie pública del adaptador de Shopify.
 *
 * **Solo esto es el puerto.** `cliente-http.ts` es privado del módulo: nadie
 * fuera de `integraciones/shopify` construye peticiones a Shopify a mano, igual
 * que nadie fuera de `integraciones/ml` usa `peticionMl` (ver `../README.md`).
 * `normalizarShopDomain` sí se exporta porque el formulario del portal tiene que
 * poder normalizar lo que pega el seller antes de mandarlo.
 */

export {
  conectarTienda,
  reconectarTienda,
  desconectarTienda,
  obtenerConexionesPorSeller,
  obtenerAccessToken,
  validarCredencial,
  marcarSalud,
  ErrorCredencialShopifyInvalida,
  ErrorScopesShopifyFaltantes,
  ErrorTiendaShopifyYaConectada,
  type ConectarTiendaEntrada,
  type CredencialValidada,
} from "./puerto";

export { normalizarShopDomain, ErrorShopDomainInvalido } from "./cliente-http";

/**
 * El botón «Sincronizar ahora». La UI llama a esto, nunca a `inngest.send`: el
 * nombre del evento y el orquestador son detalle del adaptador.
 */
export {
  solicitarSincronizacionShopify,
  type SolicitarSincronizacionShopifyEntrada,
} from "./sincronizacion";

export {
  SCOPES_REQUERIDOS,
  type ConexionShopify,
  type EstadoSaludShopify,
  type ResumenIngestaShopify,
} from "./tipos";
