/**
 * Job de envío de notificaciones por WhatsApp.
 * =============================================================================
 * Consume `notificaciones/whatsapp.solicitado` y llama al servicio de envío.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ ES UN JOB Y NO UNA LLAMADA DENTRO DEL REQUEST
 * -----------------------------------------------------------------------------
 * Dos razones, y ninguna es de estilo:
 *
 *  1. **El backoff ya existe.** El diseño original pedía "reintentos con backoff
 *     exponencial" dentro del servicio. Eso significaría bloquear al coordinador
 *     varios segundos mientras cierra un retiro, y construir a mano algo que
 *     Inngest —el orquestador que este proyecto ya usa— hace solo. La regla del
 *     proyecto es explícita: los procesos pesados son jobs idempotentes con
 *     reintentos, no trabajo en el request del usuario.
 *
 *  2. **Un aviso no puede tumbar la operación que lo disparó.** Si el envío
 *     viviera en la Server Action que cierra la sesión de retiro, una caída de
 *     Meta haría fallar el cierre del retiro. Acá, como mucho, el job reintenta.
 *
 * -----------------------------------------------------------------------------
 * QUÉ SE REINTENTA
 * -----------------------------------------------------------------------------
 * Solo lo que el adaptador marcó `reintentable` (429, 5xx, red). Un rechazo
 * previo al envío —evento desconocido, variables que no calzan, sin
 * destinatarios— NO se reintenta: son estados que no cambian solos y reintentar
 * cuatro veces un error de configuración solo llena la telemetría de ruido.
 */

import { inngest } from "@/lib/inngest/cliente";
import type { EventoWhatsAppSolicitado } from "@/lib/inngest/eventos";
import { enviarNotificacionWhatsApp } from "../envio";

/** Rechazos previos al envío: reintentarlos no cambia nada. */
const RECHAZOS_SIN_REINTENTO = new Set([
  "evento_desconocido",
  "variables_no_calzan",
  "destino_incompleto",
  "sin_destinatarios",
]);

export const jobEnviarWhatsApp = inngest.createFunction(
  {
    id: "notificaciones/enviarWhatsApp",
    name: "Notificaciones · Enviar WhatsApp",
    // 3 reintentos con el backoff propio de Inngest. Suficiente para atravesar
    // un pico de límite de tasa de Meta sin insistir hasta el ridículo sobre un
    // número que simplemente no recibe.
    retries: 3,
    triggers: [{ event: "notificaciones/whatsapp.solicitado" }],
    // Tope de concurrencia: el número de Rutax es UNO para todos los couriers y
    // Meta limita mensajes por segundo sobre ese número. Sin este freno, un
    // cierre masivo de retiros dispararía decenas de envíos en paralelo y
    // Meta respondería 429 a casi todos.
    concurrency: { limit: 5 },
  },
  async ({ event, step, logger }) => {
    const { tenantId, claveEvento, referencia, destino, variables } =
      event.data as EventoWhatsAppSolicitado["data"];

    const resultado = await step.run("enviar", async () => {
      return enviarNotificacionWhatsApp({
        tenantId,
        claveEvento,
        referencia,
        destino,
        variables,
      });
    });

    if (resultado.rechazo && RECHAZOS_SIN_REINTENTO.has(resultado.rechazo)) {
      // No se lanza: es un estado legítimo, no un fallo transitorio. Queda en la
      // telemetría del run para que se pueda ver por qué no salió el aviso.
      logger.warn(
        `[whatsapp] no se envió "${claveEvento}" (${resultado.rechazo}): ${resultado.mensaje ?? ""}`,
      );
      return { enviado: false, motivo: resultado.rechazo, ...resumen(resultado) };
    }

    // Si algún destinatario falló con un error transitorio, se lanza para que
    // Inngest reintente. La llave de idempotencia hace que los que YA salieron
    // se salten en la segunda vuelta — por eso reintentar el lote entero es
    // seguro y no hace falta reintentar destinatario por destinatario.
    const hayReintentables = resultado.detalles.some(
      (detalle) => detalle.resultado === "fallido" && detalle.reintentable,
    );
    if (hayReintentables) {
      throw new Error(
        `Fallo transitorio enviando "${claveEvento}" a ${resultado.fallidos} destinatario(s).`,
      );
    }

    if (resultado.fallidos > 0) {
      logger.warn(
        `[whatsapp] "${claveEvento}": ${resultado.fallidos} destinatario(s) con fallo permanente.`,
      );
    }

    return { enviado: resultado.enviados > 0, ...resumen(resultado) };
  },
);

/**
 * Resumen del run, sin datos personales.
 *
 * ⚠️ INCLUYE EL MOTIVO DEL FALLO, y esa es la parte que importa. La primera
 * versión devolvía solo los conteos, así que en el panel de Inngest un envío
 * rechazado se veía como `{enviado: false, fallidos: 1}` y punto: había que ir
 * a buscar el porqué a la tabla `whatsapp_mensajes`. Mordió el mismo día que se
 * abrió el envío real — el run decía que algo falló y no decía qué.
 *
 * El texto viene saneado desde el adaptador (sin token ni teléfono), así que es
 * seguro dejarlo en la telemetría, que es justo donde alguien lo va a leer.
 */
function resumen(resultado: {
  enviados: number;
  duplicados: number;
  fallidos: number;
  detalles: Array<{ error?: string }>;
}) {
  const primerError = resultado.detalles.find((d) => d.error)?.error;
  return {
    enviados: resultado.enviados,
    duplicados: resultado.duplicados,
    fallidos: resultado.fallidos,
    ...(primerError ? { error: primerError } : {}),
  };
}
