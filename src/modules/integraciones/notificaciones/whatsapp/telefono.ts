/**
 * Teléfonos para la Cloud API de WhatsApp.
 * =============================================================================
 * El mecanismo de normalización **ya no vive acá**: subió a `@/lib/telefono-cl`
 * cuando apareció el segundo campo de teléfono del producto (el del conductor,
 * que es de `identidad`). Dejarlo en este adaptador obligaba a `identidad` a
 * importar de `integraciones`, o a duplicar la función — dos normalizaciones que
 * se separan con el tiempo y el mismo número guardado de dos formas distintas.
 *
 * Lo que se queda acá es lo que sí es de WhatsApp: **los textos de error**. La
 * Cloud API quiere el número en `to` sin el `+` y sin separadores
 * (`56947095571`), y un número mal formado no falla ruidoso — Meta responde 200
 * y el mensaje no llega nunca. Por eso el mensaje nombra a WhatsApp: quien lo
 * lee está dando de alta un destinatario de avisos.
 *
 * Se re-exporta la superficie que ya consumía este módulo para no tocar a sus
 * llamadores.
 */

export {
  normalizarTelefonoE164,
  enmascararTelefono,
  type MotivoTelefonoInvalido,
  type ResultadoNormalizacion,
} from "@/lib/telefono-cl";

import type { MotivoTelefonoInvalido } from "@/lib/telefono-cl";

/** Texto en castellano para mostrarle a quien dio de alta el contacto. */
export const MENSAJE_TELEFONO_INVALIDO: Record<MotivoTelefonoInvalido, string> = {
  vacio: "Escribe un número de teléfono.",
  sin_digitos: "El teléfono no tiene ningún número.",
  demasiado_corto: "El teléfono tiene menos dígitos de los que corresponde.",
  demasiado_largo: "El teléfono tiene más dígitos de los que corresponde.",
  formato: "Revisa el teléfono: no tiene un formato que WhatsApp reconozca.",
};
