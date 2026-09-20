/**
 * Envoltorio de `conversacion` sobre `parsearCodigoBulto` — §6.1 del documento
 * de alcance.
 * =============================================================================
 * `operacion/retiro/parser-codigo.ts` sigue siendo la ÚNICA autoridad de
 * formato: un segundo parser divergiría del que usa el conductor al escanear,
 * y un código válido en la app sería inválido por WhatsApp.
 *
 * PERO no se usa tal cual, por tres razones que documenta §6.1:
 *
 *  1. **El parser recibe UN código, no una frase.** Este archivo tokeniza el
 *     mensaje primero.
 *  2. **El parser por contrato nunca dice que no** (`formato: 'desconocido'`
 *     con éxito, a propósito: para que el conductor no pierda un escaneo). Si
 *     `conversacion` usara «¿parseó?» como «¿trae código?», el menú de
 *     botones de §8 no se ejecutaría jamás. Este envoltorio es el «no» que el
 *     parser no da: descarta `desconocido` entero.
 *  3. **`comoDesconocido` preserva el mensaje crudo como credencial.** Por
 *     este canal ese «crudo» es texto escrito por una persona, y NUNCA se
 *     persiste ni se repite — este envoltorio descarta `credencial` por
 *     completo, para los tres formatos, no solo para `desconocido`.
 *
 * ⚠️ `flex_manual` (la ristra de 6..64 dígitos) SE ACEPTA pero se clasifica
 * APARTE de `flex_qr`: por este canal es una sonda de existencia de pedidos, y
 * el tope de abuso (§9) no basta — un match fallido y uno exitoso no pesan
 * igual (§6.1). Ambos resuelven al MISMO identificador (`ml_shipment_id`): la
 * superficie de lectura de `operacion` no necesita saber cómo se tecleó.
 */

import { parsearCodigoBulto } from "../operacion/retiro/parser-codigo";
import type { IdentificadorPedido } from "../operacion/consultas/seller";

/**
 * Espejo del CHECK `clasificacion` de `whatsapp_mensajes_entrantes`, la parte
 * que aporta este envoltorio (las otras dos, `intencion_retiro` y
 * `sin_match`, las escribe el enrutador de intenciones y el job).
 */
export type ClasificacionCodigo = "codigo_interno" | "ml_shipment_id" | "flex_manual";

export interface CodigoReconocido {
  clasificacion: ClasificacionCodigo;
  identificador: IdentificadorPedido;
}

/**
 * Reconoce los códigos de bulto dentro de un mensaje de texto libre.
 *
 * Tokeniza por espacios en blanco y llama a `parsearCodigoBulto` TOKEN POR
 * TOKEN — el JSON del QR de Flex no trae espacios en su forma real
 * (`{"id":"...","sender_id":...}`), así que un mensaje que sea SOLO ese JSON
 * es un único token y se reconoce igual que un escaneo.
 *
 * Nunca lanza. Un mensaje sin ningún código reconocible devuelve `[]` — eso es
 * justamente lo que el enrutador de intenciones (§8) necesita para caer al
 * siguiente paso (intención de retiro, y si tampoco calza, el menú).
 */
export function reconocerCodigosEnMensaje(texto: string): CodigoReconocido[] {
  const tokens = texto.trim().split(/\s+/).filter((t) => t.length > 0);
  const reconocidos: CodigoReconocido[] = [];

  for (const token of tokens) {
    const parseado = parsearCodigoBulto(token);

    // El «no» que el parser no da: acá se descarta, y con él se descarta
    // TAMBIÉN cualquier credencial que hubiera traído — nunca se lee
    // `parseado.credencial` en este archivo.
    if (parseado.formato === "desconocido") continue;

    if (parseado.formato === "rutax_interno") {
      reconocidos.push({
        clasificacion: "codigo_interno",
        identificador: { tipo: "codigo_interno", valor: parseado.codigoNormalizado },
      });
      continue;
    }

    // flex_qr | flex_manual → mismo identificador (ml_shipment_id), distinta
    // clasificación para el conteo de sondeo de §6.1.
    if (parseado.mlShipmentId) {
      reconocidos.push({
        clasificacion: parseado.formato === "flex_qr" ? "ml_shipment_id" : "flex_manual",
        identificador: { tipo: "ml_shipment_id", valor: parseado.mlShipmentId },
      });
    }
  }

  return reconocidos;
}

