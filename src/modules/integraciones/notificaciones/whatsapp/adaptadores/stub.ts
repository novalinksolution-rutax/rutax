/**
 * Adaptador STUB de WhatsApp — el que corre por defecto.
 * =============================================================================
 * No llama a Meta, no cobra nada y no puede degradar la calidad del número.
 * Es lo que se usa en desarrollo, en las pruebas y en cualquier ambiente donde
 * el gate real no esté explícitamente abierto.
 *
 * Registra en consola QUE se habría enviado y CUÁL plantilla, nunca el teléfono
 * ni las variables: en desarrollo esos datos son de gente real (los sellers del
 * courier del piloto) y un log de Vercel no es un lugar donde deban estar.
 *
 * Devuelve `enviado: false` a propósito. La alternativa —fingir éxito— haría
 * que la bitácora dijera "enviado" para mensajes que nunca existieron, y ese
 * dato después se lee para decidir si reenviar.
 *
 * REGLAS DE DEPENDENCIAS (adaptador = hoja del grafo): solo importa del puerto.
 */

import type {
  EnviarPlantillaArgs,
  PuertoWhatsApp,
  ResultadoEnvioWhatsApp,
} from "../puerto-whatsapp";

export class StubWhatsAppAdapter implements PuertoWhatsApp {
  async enviarPlantilla(args: EnviarPlantillaArgs): Promise<ResultadoEnvioWhatsApp> {
    console.info(
      `[whatsapp:stub] no se envió nada (modo sandbox). plantilla="${args.nombrePlantilla}" ` +
        `idioma="${args.idioma}" variables=${args.variables.length}`,
    );

    return {
      enviado: false,
      modo: "stub",
      // No es reintentable: el stub no falló, simplemente no envía. Marcarlo
      // reintentable haría que el job diera cuatro vueltas en cada corrida de
      // desarrollo.
      reintentable: false,
      errorDescripcion: "Modo sandbox: el mensaje no se envió a WhatsApp.",
    };
  }
}
