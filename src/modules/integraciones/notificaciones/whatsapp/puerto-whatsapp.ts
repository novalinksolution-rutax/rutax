/**
 * Puerto de WHATSAPP — la única puerta por la que el sistema manda un WhatsApp.
 * =============================================================================
 * Molde: `integraciones/notificaciones/email/puerto-email.ts` (interfaz + fábrica
 * con gate sandbox/real) y `integraciones/push/puerto.ts` (un aviso nunca tumba
 * la operación que lo disparó).
 *
 * -----------------------------------------------------------------------------
 * EL EMISOR ES SIEMPRE RUTAX (1:N)
 * -----------------------------------------------------------------------------
 * Un solo número oficial para todos los couriers. La credencial es de
 * PLATAFORMA (variables de entorno), no por tenant: no hay OAuth, no hay
 * conexión que el courier administre, no hay token cifrado en base. Por eso
 * `enviarPlantilla` no recibe `tenantId` — el remitente no depende de él.
 *
 * ⚠️ Si algún día se pasa a un número por courier, el cambio entra por
 * `fabrica-whatsapp.ts` (que resolvería la credencial según el tenant), NO por
 * este contrato ni por los llamadores. Está separado a propósito.
 *
 * -----------------------------------------------------------------------------
 * GARANTÍAS DEL CONTRATO
 * -----------------------------------------------------------------------------
 *  - **Sandbox por defecto**: salvo `WHATSAPP_SANDBOX_MODE=false` Y las tres
 *    variables de la Cloud API presentes, NINGÚN adaptador envía de verdad. Acá
 *    importa más que en email: cada conversación de WhatsApp SE COBRA a la
 *    tarjeta que Rutax tiene registrada en Meta, y un bucle en desarrollo se
 *    paga en pesos.
 *  - **Nunca lanza**: `enviarPlantilla` SIEMPRE devuelve un
 *    `ResultadoEnvioWhatsApp`. Un aviso que no salió no puede deshacer el
 *    retiro que ya se cerró.
 *  - **`reintentable` lo decide el adaptador, no el llamador**: solo él sabe
 *    distinguir un 429 de un "esta plantilla no existe". El job usa esa marca
 *    para reintentar o rendirse; sin ella terminaría reintentando cuatro veces
 *    un error de configuración.
 *  - **Secretos fuera de todo**: el token de la Cloud API NUNCA se loguea, ni
 *    aparece en errores ni en el resultado. El TELÉFONO tampoco — es dato
 *    personal y `errorDescripcion` termina en la bitácora.
 */

export interface EnviarPlantillaArgs {
  /** E.164 SIN el `+`, ya normalizado (`normalizarTelefonoE164`). */
  telefonoE164: string;
  /** Nombre de la plantilla tal como está aprobada en Meta. */
  nombrePlantilla: string;
  /** Código de idioma de la plantilla (`es`, `en_US`…). */
  idioma: string;
  /**
   * Variables del cuerpo, EN ORDEN: la primera es `{{1}}`. Lista vacía para una
   * plantilla sin variables (`hello_world`).
   */
  variables: string[];
  /**
   * ¿Es una plantilla de categoría **authentication** (código de un solo uso)?
   *
   * Cuando es `true`, el adaptador arma —además del componente `body`— el
   * componente de **botón** (`sub_type: "url"`, `index: "0"`) que la Cloud API
   * EXIGE para el botón «Copiar código», con el MISMO código que va en el cuerpo
   * (`variables[0]`). Es un requisito de Meta para las plantillas de auth: sin el
   * botón, el envío se rechaza con 400.
   *
   * Se toma de la definición del catálogo (`DefinicionPlantilla.esAutenticacion`),
   * no lo inventa el llamador.
   */
  esPlantillaAutenticacion?: boolean;
}

export interface ResultadoEnvioWhatsApp {
  /** `true` solo si Meta aceptó el mensaje. En modo stub, siempre `false`. */
  enviado: boolean;
  modo: "stub" | "real";
  /** El `wamid.***` que asigna Meta. Es la llave del acuse en el webhook. */
  metaMessageId?: string;
  /** Descripción SANEADA del fallo (sin token ni teléfono). */
  errorDescripcion?: string;
  /**
   * ¿Vale la pena volver a intentar? `true` para 429/5xx/red; `false` para
   * plantilla inexistente, número inválido o token sin permisos — reintentar
   * eso solo quema cuota y, si el mensaje sí salió, lo duplica.
   */
  reintentable: boolean;
}

export interface EnviarTextoArgs {
  /** E.164 SIN el `+`, ya normalizado. */
  telefonoE164: string;
  /** El cuerpo del mensaje. Meta exige texto libre dentro de la ventana de servicio de 24 h. */
  texto: string;
}

/** Contrato que todo adaptador concreto de WhatsApp debe cumplir. */
export interface PuertoWhatsApp {
  enviarPlantilla(args: EnviarPlantillaArgs): Promise<ResultadoEnvioWhatsApp>;
  /**
   * Manda un mensaje de TEXTO LIBRE (`type: "text"`), no una plantilla.
   *
   * Solo es válido dentro de la ventana de servicio de 24 h que abre un
   * mensaje entrante — que es exactamente el caso de uso de `conversacion`
   * (§1: "un mensaje entrante abre la ventana de servicio de 24 h, y dentro de
   * esa ventana las respuestas no se cobran. No hay plantilla nueva que
   * aprobar en Meta"). Fuera de esa ventana, Meta rechaza el envío — es el
   * mismo comportamiento que tendría cualquier respuesta humana desde la app
   * de WhatsApp Business.
   */
  enviarTexto(args: EnviarTextoArgs): Promise<ResultadoEnvioWhatsApp>;
}
