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

/**
 * Cuánto antes del vencimiento se considera candidata a una conexión.
 *
 * Dimensionado contra los dos números que mandan:
 * - TTL del access_token de ML: 6 h (`expires_in: 21600`, verificado en
 *   `cliente-http.ts`).
 * - Cadencia de este cron: cada 30 min.
 *
 * Con 2 h de margen, una conexión entra en la lista de candidatas ~4 h después
 * del último refresco y tiene ~4 corridas del cron (más los reintentos de
 * Inngest) para refrescarse antes de que el token expire. El margen tiene que
 * ser, como mínimo, varias veces la cadencia del cron: si fuera menor a 30 min
 * habría ventana muerta en la que toda llamada a ML responde 401, y entonces
 * `sondeo-salud` (cada 15 min) marcaría la conexión `atencion` y, al segundo
 * fallo, `desvinculada` — un seller desvinculado queda fuera del polling y de
 * `procesar-shipment`, o sea cero pedidos suyos ese día.
 * No conviene subirlo mucho más: el `refresh_token` de ML es de un solo uso y
 * refrescar antes de tiempo lo rota sin necesidad.
 */
const MARGEN_REFRESCO_MS = 2 * 60 * 60 * 1000;

/**
 * Construye el filtro PostgREST de conexiones candidatas.
 *
 * ⚠️ El instante límite se calcula en TypeScript y viaja como **literal ISO**.
 * PostgREST no evalúa SQL dentro de un filtro: `token_expira_en.lt.now() +
 * interval '2 hours'` NO da error dentro de `.or(...)` —lo descarta en
 * silencio— y termina comparando contra `now()` a secas, es decir refrescando
 * solo tokens YA vencidos. Verificado empíricamente: el mismo filtro fuera de
 * `.or()` devuelve 22007 (`invalid input syntax for type timestamp with time
 * zone`), y con `interval '-200 days'` devuelve igual todas las filas.
 * No volver a meter `now()`, `interval` ni ninguna función SQL en este string.
 *
 * Exportada para que el test ejerza ESTE código y no una copia espejo.
 */
export function construirFiltroConexionesCandidatas(ahora: Date = new Date()): string {
  const limiteIso = new Date(ahora.getTime() + MARGEN_REFRESCO_MS).toISOString();
  return `token_expira_en.lt.${limiteIso},estado_salud.eq.atencion`;
}

export const jobRefrescarTokens = inngest.createFunction(
  {
    id: "ml/refrescarTokens",
    name: "ML · Refrescar tokens de sellers",
    triggers: [{ cron: "*/30 * * * *" }],
    // Reintentos ante error transitorio — Inngest los aplica automáticamente.
    retries: 3,
  },
  async ({ step, logger }) => {
    // Paso 1: leer las conexiones candidatas (próximas a vencer o en atención).
    const conexiones = await step.run("leer-conexiones-candidatas", async () => {
      const supabase = crearClienteServiceRole();

      // Candidatas: token próximo a vencer (dentro del margen) O conexión
      // marcada para revisión activa ('atencion'). NO incluir 'sana': hacerlo
      // refrescaba TODAS las conexiones sanas en cada corrida (cada 30 min),
      // rotando sin necesidad el `refresh_token` de un solo uso de ML — churn y
      // ventana de carrera de doble-uso. Una conexión 'sana' cuyo token esté por
      // vencer ya queda cubierta por la primera condición (token_expira_en).
      const { data, error } = await supabase
        .schema("identidad")
        .from("conexiones_seller_ml")
        .select("id, seller_id, tenant_id, estado_salud")
        .or(construirFiltroConexionesCandidatas());

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
