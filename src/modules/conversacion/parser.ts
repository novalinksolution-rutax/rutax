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

/**
 * Desde cuántos dígitos una ristra numérica se busca como id de ORDEN y no de
 * envío.
 *
 * Medido contra producción (2026-09-20): los `ml_order_id` guardados tienen
 * **16** dígitos (`2000015104287145`) y los `ml_shipment_id` **11**
 * (`44760788901`). El 13 deja margen a los dos lados sin que se pisen.
 */
const LARGO_MIN_ID_ORDEN = 13;

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

  for (const tokenCrudo of tokens) {
    // ⚠️ El panel de Ventas de Mercado Libre muestra el id de la orden con
    // almohadilla (`#2000015104287145`), y el seller copia justo eso. Se quita
    // SOLO la almohadilla inicial: limpiar más rompería el JSON del QR de
    // Flex, que empieza con `{` y es un token válido.
    const token = tokenCrudo.replace(/^#+/, "");
    if (token.length === 0) continue;

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
      // ⚠️ El seller NO ve el id del envío en ningún lado: en su panel de
      // Ventas de Mercado Libre lo que aparece es el id de la ORDEN
      // (`#2000015104287145`). Los dos son ristras de dígitos, así que hay que
      // distinguirlos por largo: la orden tiene 16 y el envío 11.
      // Sin esto, el seller pega lo único que puede copiar y recibe
      // «no encontramos» — que además es indistinguible de «no es tuyo», así
      // que concluye que el bot está roto.
      const esIdDeOrden = parseado.mlShipmentId.length >= LARGO_MIN_ID_ORDEN;
      reconocidos.push({
        // La clasificación NO cambia: sigue siendo una ristra numérica escrita
        // a mano, que es lo que el detector de sondeo de §6.1 cuenta. Lo que
        // cambia es contra qué columna se busca.
        clasificacion: parseado.formato === "flex_qr" ? "ml_shipment_id" : "flex_manual",
        identificador: esIdDeOrden
          ? { tipo: "ml_order_id", valor: parseado.mlShipmentId }
          : { tipo: "ml_shipment_id", valor: parseado.mlShipmentId },
      });
    }
  }

  return reconocidos;
}

