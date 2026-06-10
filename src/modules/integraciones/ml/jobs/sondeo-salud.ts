/**
 * Job 2 · ml/sondeoSaludConexiones
 * =====================================================================
 * Cadencia: cada 15 minutos (cron "0 *\/15 * * * *").
 *
 * Para cada conexión de seller activa (estado != 'desvinculada'), realiza un
 * request liviano a ML con el access token del seller. Si falla:
 *
 * - `sana` → falla → marcar `atencion`
 * - `atencion` → falla de nuevo → escalar a `desvinculada` y publicar
 *   evento `notificacion/conexion-caida` para que el Job 7 notifique.
 *
 * Request de sondeo: `GET /users/me` (verificado contra documentación oficial
 * de ML — este endpoint requiere el access_token del usuario y es el más
 * ligero para confirmar que el token sigue válido sin consultar pedidos).
 *
 * SEGURIDAD: el access token se descifra momentáneamente para la petición HTTP
 * y nunca se incluye en logs, payloads de eventos ni objetos de error.
 */

import { inngest } from "@/lib/inngest/cliente";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { descifrarSecreto } from "../../secretos";
import { ML_API_BASE_URL } from "../cliente-http";
import type { EstadoSaludConexionMl } from "../tipos";

interface FilaConexionActiva {
  id: string;
  seller_id: string;
  tenant_id: string;
  estado_salud: EstadoSaludConexionMl;
  access_token_ref: string | null;
  // Dato del seller para la notificación (sin datos sensibles)
  nombre_seller?: string;
}

export const jobSondeoSaludConexiones = inngest.createFunction(
  {
    id: "ml/sondeoSaludConexiones",
    name: "ML · Sondeo de salud de conexiones",
    triggers: [{ cron: "*/15 * * * *" }],
    retries: 2,
  },
  async ({ step, logger }) => {
    const conexiones = await step.run("leer-conexiones-activas", async () => {
      const supabase = crearClienteServiceRole();

      // Obtener conexiones no desvinculadas + nombre del seller (join liviano)
      const { data, error } = await supabase
        .schema("identidad")
        .from("conexiones_seller_ml")
        .select(
          "id, seller_id, tenant_id, estado_salud, access_token_ref, " +
            "sellers:seller_id(razon_social)",
        )
        .neq("estado_salud", "desvinculada");

      if (error) {
        throw new Error(`No se pudieron leer las conexiones activas: ${error.message}`);
      }

      // Normalizar el join (Supabase devuelve el objeto anidado).
      // El cast pasa por `unknown` para satisfacer a TypeScript cuando el tipo
      // inferido del cliente Supabase no coincide exactamente con la interfaz local.
      type FilaConJoin = FilaConexionActiva & { sellers: { razon_social: string } | null };
      return (
        (data as unknown as FilaConJoin[])?.map((fila) => ({
          id: fila.id,
          seller_id: fila.seller_id,
          tenant_id: fila.tenant_id,
          estado_salud: fila.estado_salud,
          access_token_ref: fila.access_token_ref,
          nombre_seller: fila.sellers?.razon_social ?? "seller desconocido",
        })) ?? []
      );
    });

    logger.info(`Conexiones activas a sondear: ${conexiones.length}`);

    await Promise.allSettled(
      conexiones.map((conexion) =>
        step.run(`sondear:${conexion.id}`, async () => {
          const estadoActual = conexion.estado_salud;
          let tokenFunciona = false;

          try {
            if (!conexion.access_token_ref) {
              throw new Error("Sin access_token_ref registrado");
            }

            // Descifrar token solo para este request — sale de scope al terminar
            const descifrado = await descifrarSecreto(conexion.access_token_ref);
            if (typeof descifrado.valor !== "string") {
              throw new Error("access_token descifrado no es texto");
            }

            const respuesta = await fetch(`${ML_API_BASE_URL}/users/me`, {
              method: "GET",
              headers: {
                authorization: `Bearer ${descifrado.valor}`,
                accept: "application/json",
              },
            });

            // Solo consideramos exitoso si ML responde 200.
            // 401/403 indican token inválido/revocado.
            tokenFunciona = respuesta.ok;

            // El token en claro sale de scope aquí.
          } catch {
            // Error de red o descifrado — se trata como fallo del sondeo.
            tokenFunciona = false;
          }

          if (tokenFunciona) {
            // Si el sondeo es exitoso y el estado era 'atencion' o 'pendiente',
            // restaurar a 'sana'.
            if (estadoActual !== "sana") {
              const supabase = crearClienteServiceRole();
              await supabase
                .schema("identidad")
                .from("conexiones_seller_ml")
                .update({ estado_salud: "sana", ultimo_error: null })
                .eq("id", conexion.id);

              logger.info(`Conexión ${conexion.id} restaurada a 'sana'.`);
            }
            return { conexionId: conexion.id, resultado: "sana" };
          }

          // Fallo del sondeo — escalar según estado actual.
          const supabase = crearClienteServiceRole();

          if (estadoActual === "sana" || estadoActual === "pendiente") {
            // Primera señal de problema: marcar 'atencion'.
            await supabase
              .schema("identidad")
              .from("conexiones_seller_ml")
              .update({
                estado_salud: "atencion",
                ultimo_error: "Sondeo de salud: token inválido o sin respuesta de ML.",
              })
              .eq("id", conexion.id);

            logger.warn(
              `Conexión ${conexion.id} (seller ${conexion.seller_id}) marcada como 'atencion'.`,
            );
            return { conexionId: conexion.id, resultado: "atencion" };
          }

          if (estadoActual === "atencion") {
            // Segunda señal consecutiva: escalar a 'desvinculada'.
            const ahora = new Date().toISOString();

            await supabase
              .schema("identidad")
              .from("conexiones_seller_ml")
              .update({
                estado_salud: "desvinculada",
                ultimo_error:
                  "Sondeo de salud: segundo fallo consecutivo — requiere re-vinculación del seller.",
                desconectada_desde: ahora,
              })
              .eq("id", conexion.id)
              // Solo escalar si aún está en 'atencion' (evitar pisada concurrente)
              .eq("estado_salud", "atencion");

            logger.error(
              `Conexión ${conexion.id} escalada a 'desvinculada'. ` +
                "Publicando evento de notificación.",
            );

            // Publicar evento de notificación SIN incluir tokens ni secretos.
            await inngest.send({
              name: "notificacion/conexion-caida",
              data: {
                // Solo datos operativos, nunca tokens ni refs cifradas
                sellerId: conexion.seller_id,
                tenantId: conexion.tenant_id,
                nombreSeller: conexion.nombre_seller ?? "seller",
                conexionId: conexion.id,
              },
            });

            return { conexionId: conexion.id, resultado: "desvinculada" };
          }

          // Estado ya era 'desvinculada' pero pasó el filtro (edge case):
          // no hacemos nada.
          return { conexionId: conexion.id, resultado: "ya-desvinculada" };
        }),
      ),
    );

    logger.info("Sondeo de salud completado.");
    return { total: conexiones.length };
  },
);
