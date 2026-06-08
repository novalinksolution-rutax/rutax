/**
 * Endpoint de Inngest — Next.js route handler.
 *
 * Sirve como puente entre el servidor de Inngest (cloud o Dev Server local)
 * y las funciones del sistema. Inngest llama a este endpoint para:
 * - Descubrir las funciones registradas (GET — introspección).
 * - Disparar ejecuciones (POST).
 * - Verificar liveness (PUT).
 *
 * Para añadir una nueva función de Inngest al sistema: importarla aquí y
 * agregarla al array `funciones`. Ese es el único cambio necesario — el
 * cliente Inngest y la ruta no necesitan saber nada más.
 *
 * Variables de entorno requeridas (ver .env.example):
 * - INNGEST_EVENT_KEY   — para publicar eventos desde el servidor.
 * - INNGEST_SIGNING_KEY — para validar que las peticiones vienen de Inngest.
 *   En desarrollo local con el Dev Server puede omitirse.
 *
 * NUNCA loguear el valor de estas variables.
 */

import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/cliente";

// Jobs de Mercado Libre
import { jobRefrescarTokens } from "@/modules/integraciones/ml/jobs/refrescar-tokens";
import { jobSondeoSaludConexiones } from "@/modules/integraciones/ml/jobs/sondeo-salud";
import { jobProcesarShipmentActualizado } from "@/modules/integraciones/ml/jobs/procesar-shipment";
import { jobPollingEstadosPedidos } from "@/modules/integraciones/ml/jobs/polling-estados";
import { jobEjecutarBackfill } from "@/modules/integraciones/ml/jobs/ejecutar-backfill";

// Jobs de notificaciones
import { jobNotificacionConexionCaida } from "@/modules/integraciones/notificaciones/conexion-caida";

/**
 * Array de todas las funciones de Inngest del sistema.
 * Se pasa completo al `serve()` para que el servidor de Inngest las conozca.
 */
const funciones = [
  jobRefrescarTokens,
  jobSondeoSaludConexiones,
  jobProcesarShipmentActualizado,
  jobPollingEstadosPedidos,
  jobEjecutarBackfill,
  jobNotificacionConexionCaida,
];

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: funciones,
});
