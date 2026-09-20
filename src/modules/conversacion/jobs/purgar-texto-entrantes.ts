/**
 * Purga del texto de los mensajes entrantes de WhatsApp (retención 90 días).
 * =============================================================================
 * `integraciones.whatsapp_mensajes_entrantes` guarda lo que el seller ESCRIBE.
 * Ese texto lo redactó una persona y puede traer adentro un teléfono, una
 * dirección o el nombre de un comprador, así que no se conserva para siempre:
 * a los 90 días se borra el texto y **queda la métrica** (`texto_largo`,
 * `clasificacion`, `hubo_match`, `motivo_no_respondido`, `recibido_en`).
 * Ver `docs/arquitectura/conversacion-whatsapp.md` §10.
 *
 * ⚠️ **La función de base existía desde el día uno y NADIE la llamaba.** El
 * documento prometía la purga, el pgTAP la probaba, el `GRANT` estaba puesto —
 * y el texto se acumulaba igual. Es el patrón de la columna con lector y sin
 * escritor (`monto_conductor`), pero al revés y con una promesa de protección
 * de datos encima. Este job es el escritor que faltaba.
 *
 * El «cuándo» vive acá y no en la base a propósito: no hay `pg_cron` en este
 * proyecto y los tiempos de los trabajos se ven todos juntos en Inngest.
 */

import { inngest } from '@/lib/inngest/cliente';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';

/** Días que se conserva el texto. El default de la función SQL es el mismo. */
const DIAS_RETENCION = 90;

/** Filas por llamada. La función las toma con `for update skip locked`. */
const TOPE_POR_TANDA = 2000;

/**
 * Tope de tandas por corrida.
 *
 * ⚠️ La función se llama **en bucle hasta que devuelve 0**, pero con un techo:
 * un bucle sin techo dentro de un `step.run` que por alguna razón nunca baje a
 * cero deja el job corriendo hasta que Inngest lo mate, y eso se paga en
 * tiempo de función. Si un día se topa, la corrida siguiente sigue donde quedó
 * — la purga es idempotente por definición: lo ya purgado deja de calificar.
 */
const MAX_TANDAS = 50;

export const jobPurgarTextoEntrantesWhatsApp = inngest.createFunction(
  {
    id: 'conversacion/purgarTextoEntrantesWhatsApp',
    name: 'Conversación · Purgar texto de mensajes entrantes (retención)',
    // 03:50 de Santiago, detrás de las otras dos purgas (03:30 y 03:40) para
    // no solapar tres barridos sobre la misma base. A esa hora no hay nadie
    // consultando por WhatsApp.
    triggers: [{ cron: 'TZ=America/Santiago 50 3 * * *' }],
    retries: 2,
  },
  async ({ step, logger }) => {
    const resultado = await step.run('purgar-en-tandas', async () => {
      const supabase = crearClienteServiceRole();

      let purgados = 0;
      let tandas = 0;

      while (tandas < MAX_TANDAS) {
        tandas += 1;

        const { data, error } = await supabase.rpc('whatsapp_entrantes_purgar_texto', {
          p_dias: DIAS_RETENCION,
          p_tope: TOPE_POR_TANDA,
        });

        if (error) {
          // Se lanza para que Inngest reintente: una purga que no corre es una
          // retención que se incumple en silencio, que es justo lo que este
          // job viene a arreglar.
          throw new Error(`No se pudo purgar el texto entrante: ${error.message}`);
        }

        const enEstaTanda = typeof data === 'number' ? data : 0;
        purgados += enEstaTanda;

        if (enEstaTanda === 0) break;
      }

      return { purgados, tandas, topeAlcanzado: tandas >= MAX_TANDAS };
    });

    if (resultado.topeAlcanzado) {
      // No es un fallo: es la señal de que quedó cola. Si aparece seguido, el
      // volumen creció y hay que subir el tope o purgar más seguido.
      logger.warn('Purga de entrantes: se alcanzó el tope de tandas, queda cola', resultado);
    }

    return resultado;
  },
);
