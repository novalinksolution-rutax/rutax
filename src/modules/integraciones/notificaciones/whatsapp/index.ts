/**
 * Superficie pública del adaptador de WhatsApp.
 * =============================================================================
 * El resto del producto importa DESDE ACÁ y no desde los archivos internos. Es
 * la misma regla que ML y Shopify: el cliente HTTP y los detalles de la Cloud
 * API son privados del adaptador, y el núcleo solo ve el puerto y el servicio.
 *
 * La forma normal de mandar un aviso NO es llamar a `enviarNotificacionWhatsApp`
 * directo: es publicar el evento `notificaciones/whatsapp.solicitado`, para que
 * el envío corra en un job con reintentos y no dentro del request. La función
 * se exporta igual porque el job la necesita y porque una ruta de diagnóstico
 * tiene razones legítimas para saltarse la cola.
 */

export type {
  PuertoWhatsApp,
  EnviarPlantillaArgs,
  ResultadoEnvioWhatsApp,
} from "./puerto-whatsapp";
export { obtenerPuertoWhatsApp, whatsappSandboxActivo, whatsappConfigurado } from "./fabrica-whatsapp";

export {
  enviarNotificacionWhatsApp,
  type SolicitudNotificacion,
  type ResultadoNotificacion,
  type DestinoNotificacion,
  type DetalleEnvio,
  type MotivoRechazo,
} from "./envio";

export {
  CATALOGO_PLANTILLAS,
  obtenerPlantilla,
  esClaveEventoConocida,
  clavesEventoConocidas,
  type ClaveEventoWhatsApp,
  type DefinicionPlantilla,
  type RolDestinatario,
} from "./catalogo-plantillas";

export {
  normalizarTelefonoE164,
  enmascararTelefono,
  MENSAJE_TELEFONO_INVALIDO,
  type ResultadoNormalizacion,
} from "./telefono";

export { verificarFirmaWebhookWhatsApp, resolverHandshakeWebhook } from "./firma-webhook";

export {
  normalizarEventosWebhookWhatsApp,
  estadoAvanza,
  esSolicitudDeBaja,
  RANGO_ESTADO,
  type EventosWebhookWhatsApp,
  type EstadoMensajeWhatsApp,
  type AcuseMensaje,
  type MensajeEntrante,
  type ActualizacionPlantilla,
} from "./webhook-eventos";
