/**
 * Superficie pública del módulo `conversacion`.
 *
 * Nadie fuera de este módulo necesita importar nada de acá salvo el registro
 * de jobs de Inngest (`src/app/api/inngest/route.ts`, que importa el job
 * directo) — ver la cerca de §4 del documento de alcance:
 * `operacion`, `dinero` e `integraciones` NUNCA importan `conversacion`.
 */

export { resolverAlcanceDesdeContacto, type AlcanceSeller, type ResolucionAlcance } from "./alcance";
export { reconocerCodigosEnMensaje, primerCodigoReconocido, type CodigoReconocido, type ClasificacionCodigo } from "./parser";
export { determinarIntencion, type Intencion } from "./intenciones";
export { excedeTopeDeAbuso, detectaBarridoDeCodigos } from "./abuso";
export {
  armarRespuestaPedido,
  armarRespuestaRetiro,
  armarMenu,
  armarRespuestaSinContacto,
  armarRespuestaAmbigua,
} from "./respuestas";
export { leerConfigCanalConsulta, type ConfigCanalConsulta } from "./canal";
export {
  MOTIVOS_NO_RESPONDIDO,
  MOTIVOS_DE_CORTE_DEL_CANAL,
  type MotivoNoRespondido,
} from "./motivo-no-respondido";
export {
  obtenerConfigCanalConsulta,
  guardarConfigCanalConsulta,
  contadoresCanalConsultaPorCourier,
  contadoresCanalConsultaGlobales,
  obtenerPanelCanalConsulta,
  type ConfigCanalConsultaAdmin,
  type GuardarConfigCanalConsultaEntrada,
  type ResultadoGuardarConfigCanal,
  type ContadoresCanalConsultaPorCourier,
  type ContadoresCanalConsultaGlobales,
  type FilaCanalConsultaCourier,
  type PanelCanalConsulta,
} from "./canal-admin";
