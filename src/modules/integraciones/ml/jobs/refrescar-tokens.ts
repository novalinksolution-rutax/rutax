/**
 * Job 1 · ml/refrescarTokens
 * =====================================================================
 * Cadencia: cada 30 minutos (cron "0 *\/30 * * * *").
 *
 * Refresca los access tokens de conexiones ML que estén próximos a vencer
 * o que ya requieran atención. Delega toda la lógica de refresco al puerto
 * ML ya construido (`refrescarToken`) — este job solo itera y reacciona.
 *
 * Contratos de resiliencia:
 * - El fallo de UNA conexión no propaga al loop completo.
 * - `requiere_revinculacion` → actualiza estado_salud a 'desvinculada' en BD.
 *   No lanza — el job continúa con las demás conexiones.
 * - Error transitorio (red, 429, 5xx) → NO se captura aquí. Inngest lo detecta
 *   como fallo del paso y reintenta con backoff automático. Eso es correcto:
 *   queremos que el job entero (o el paso del seller que falló) se reintente,
 *   no que silenciemos el error.
 *
 * Idempotencia: `refrescarToken` ya es idempotente por diseño (lee la fila más
 * reciente antes de llamar a ML). Dos ejecuciones concurrentes del cron son
 * seguras.
 *
 * NOTA DE SEGURIDAD: ningún token ni credencial aparece en logs ni en el
 * payload de eventos de Inngest.
 */

import { inngest } from "@/lib/inngest/cliente";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { refrescarToken } from "../puerto";

interface FilaConexion {
  id: string;
  seller_id: string;
  tenant_id: string;
  estado_salud: string;
}

export const jobRefrescarTokens = inngest.createFunction(
  {
    id: "ml/refrescarTokens",
    name: "ML · Refrescar tokens de sellers",
    triggers: [{ cron: "0 */30 * * * *" }],
    // Reintentos ante error transitorio — Inngest los aplica automáticamente.
    retries: 3,
  },
  async ({ step, logger }) => {
    // Paso 1: leer las conexiones candidatas (próximas a vencer o en atención).
    const conexiones = await step.run("leer-conexiones-candidatas", async () => {
      const supabase = crearClienteServiceRole();

      // Candidatas: token expira en < 2 horas O estado requiere revisión activa.
      // La condición `estado_salud IN ('atencion', 'sana')` asegura que también
      // verificamos conexiones cuyo token aún no expiró pero cuyo último sondeo
      // ya reportó señales de alerta.
      const { data, error } = await supabase
        .schema("identidad")
        .from("conexiones_seller_ml")
        .select("id, seller_id, tenant_id, estado_salud")
        .or(
          "token_expira_en.lt.now() + interval '2 hours'," +
            "estado_salud.in.(atencion,sana)",
        );

      if (error) {
        throw new Error(`No se pudieron leer las conexiones ML: ${error.message}`);
      }

      return (data as FilaConexion[]) ?? [];
    });

    logger.info(`Conexiones candidatas a refrescar: ${conexiones.length}`);

    // Paso 2: refrescar cada conexión en pasos independientes.
    // Inngest ejecuta cada `step.run` de forma atómica y reintentable. Si una
    // conexión falla, solo ese paso se reintenta — el loop de las demás no se ve
    // afectado porque el manejo de errores está DENTRO del paso individual.
    const resultados = await Promise.allSettled(
      conexiones.map((conexion) =>
        step.run(`refrescar:${conexion.id}`, async () => {
          try {
            const resultado = await refrescarToken({ conexionId: conexion.id });

            if (resultado.resultado === "requiere_revinculacion") {
              // La desvinculación ya fue persistida por `refrescarToken` —
              // este job solo confirma el resultado en el log de Inngest.
              // No lanzamos: el loop continúa con las demás conexiones.
              logger.warn(
                `Conexión ${conexion.id} (seller ${conexion.seller_id}) requiere re-vinculación. ` +
                  "Estado actualizado a 'desvinculada'.",
              );
              return { estado: "requiere_revinculacion", conexionId: conexion.id };
            }

            return { estado: "refrescado", conexionId: conexion.id };
          } catch (error) {
            // Error transitorio (red, 429, 5xx): no capturamos — propagamos
            // para que Inngest reintente este paso con backoff. Es el
            // comportamiento correcto para fallos de infraestructura.
            // IMPORTANTE: nunca incluir el error completo en el log si pudiera
            // contener fragmentos del token — solo el mensaje.
            const mensaje = error instanceof Error ? error.message : String(error);
            // Si el mensaje no contiene "token" ni "secret" (sanidad básica):
            if (
              !mensaje.toLowerCase().includes("token") &&
              !mensaje.toLowerCase().includes("secret")
            ) {
              logger.error(`Error al refrescar conexión ${conexion.id}: ${mensaje}`);
            } else {
              logger.error(
                `Error al refrescar conexión ${conexion.id}. Revisar logs de Supabase para detalles.`,
              );
            }
            throw error; // Propagar para reintento de Inngest
          }
        }),
      ),
    );

    const exitosos = resultados.filter((r) => r.status === "fulfilled").length;
    const fallidos = resultados.filter((r) => r.status === "rejected").length;

    logger.info(
      `Refresco completado: ${exitosos} exitosos, ${fallidos} con error transitorio (Inngest reintentará).`,
    );

    return { exitosos, fallidos, total: conexiones.length };
  },
);
