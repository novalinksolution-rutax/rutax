/**
 * Cliente Inngest compartido por todos los jobs del sistema.
 *
 * USO: importar `inngest` (instancia) en cada función de Inngest.
 * Nunca instanciar `new Inngest()` fuera de este módulo — una sola instancia
 * garantiza que todos los jobs se registran bajo el mismo app ID.
 *
 * Variables de entorno (ver .env.example):
 * - INNGEST_EVENT_KEY   — clave para publicar eventos (server-side).
 * - INNGEST_SIGNING_KEY — firma de las peticiones del servidor de Inngest
 *   al endpoint `/api/inngest`. Inngest la valida automáticamente cuando
 *   está presente; en desarrollo local (Inngest Dev Server) puede omitirse.
 *
 * NUNCA loguear el valor de estas variables.
 */
import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "saas-courier",
  // El event key se lee de la variable de entorno automáticamente por el SDK
  // cuando se llama a inngest.send(). No se hardcodea aquí.
});
