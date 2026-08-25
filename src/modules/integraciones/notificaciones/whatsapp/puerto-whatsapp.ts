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

/** Contrato que todo adaptador concreto de WhatsApp debe cumplir. */
export interface PuertoWhatsApp {
  enviarPlantilla(args: EnviarPlantillaArgs): Promise<ResultadoEnvioWhatsApp>;
}
