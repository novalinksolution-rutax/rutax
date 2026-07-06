/**
 * Job 4 · ml/pollingEstadosPedidos (sondeo de respaldo)
 * =====================================================================
 * Cadencia: cada 15 minutos (cron "0 *\/15 * * * *").
 *
 * Cierra el hueco de eventos perdidos del webhook. Para cada CONEXIÓN con
 * pedidos activos ('asignado' | 'en_ruta') — agrupando por (seller_id,
 * ml_user_id), porque un seller puede tener varias cuentas ML (modelo 1:N) —,
 * consulta el estado actual en ML con EL token de ESA cuenta y publica el
 * evento `ml/shipment.actualizado` si el estado difiere. El Job 3 reutiliza el
 * mismo handler para procesar tanto webhooks como polling — garantiza
 * consistencia de paths.
 *
 * CONSULTA POR SHIPMENT INDIVIDUAL (no batch):
 * La documentación oficial de ML (docs/mercadolibre/05-mercado-envios-shipments.md)
 * NO confirma un endpoint batch `GET /shipments?ids=...` ni `?shipment_ids=...`
 * para el RECURSO de shipments (el único multi-id confirmado es
 * `GET /shipment_labels?shipment_ids=...`, que devuelve etiquetas, no estados).
 * El parámetro `?ids=` previo era una SUPOSICIÓN sin verificar; si fuese
 * incorrecto, ML respondería 400/4xx y el polling de respaldo —único backstop
 * ante webhooks perdidos— NO detectaría nada y fallaría en silencio.
 * Por eso se usa el endpoint VERIFICADO `GET /shipments/{id}` (con
 * `x-format-new: true`) por cada shipment activo. El volumen es acotado: solo
 * pedidos en estado 'asignado'|'en_ruta' del seller, una vez cada 15 min, con
 * backoff/Retry-After heredados de `peticionMl`.
 *
 * PENDIENTE (delegar a `mercadolibre-docs`): confirmar si existe un endpoint
 * batch oficial para estados de shipments y, de existir, el parámetro exacto;
 * si aparece, optimizar este job. Mientras no esté verificado, NO se usa batch.
 *
 * SEGURIDAD: tokens nunca en logs ni en payloads de Inngest.
 */

import { inngest } from "@/lib/inngest/cliente";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { descifrarSecreto } from "../../secretos";
import { peticionMl, ErrorHttpMl } from "../cliente-http";

interface PedidoActivo {
  id: string;
  tenant_id: string;
  seller_id: string;
  ml_shipment_id: string;
  estado: string;
  estado_ml: string | null;
  ml_user_id: string | null;
}

interface ConexionConToken {
  access_token_ref: string | null;
  estado_salud: string;
  ml_user_id: string | null;
}

/**
 * Clave de agrupación por conexión (modelo 1:N). Los pedidos legacy sin
 * `ml_user_id` estampado caen a un grupo especial que resuelve la conexión
 * representativa del seller (tras el backfill deberían estar poblados).
 */
const CUENTA_SIN_ESTAMPAR = "__sin_cuenta__";

function claveGrupo(sellerId: string, mlUserId: string | null): string {
  return `${sellerId}::${mlUserId ?? CUENTA_SIN_ESTAMPAR}`;
}

/** Respuesta de `GET /shipments/{id}` (campos que usamos para comparar estado). */
interface ShipmentMlDetalle {
  id: number | string;
  status: string;
  substatus?: string | null;
}

export const jobPollingEstadosPedidos = inngest.createFunction(
  {
    id: "ml/pollingEstadosPedidos",
    name: "ML · Polling de estados de pedidos (respaldo webhook)",
    triggers: [{ cron: "*/15 * * * *" }],
    retries: 2,
  },
  async ({ step, logger }) => {
    // Paso 1: leer pedidos activos agrupados por CONEXIÓN (seller_id + cuenta
    // ml_user_id). Modelo 1:N — un seller puede tener varias cuentas ML y cada
    // una se pollea con SU token.
    const pedidosPorConexion = await step.run("leer-pedidos-activos", async () => {
      const supabase = crearClienteServiceRole();

      const { data, error } = await supabase
        .schema("operacion")
        .from("pedidos")
        .select("id, tenant_id, seller_id, ml_shipment_id, estado, estado_ml, ml_user_id")
        .in("estado", ["asignado", "en_ruta"])
        .not("ml_shipment_id", "is", null);

      if (error) {
        throw new Error(`Error al leer pedidos activos: ${error.message}`);
      }

      // Agrupar por (seller_id, ml_user_id) — clave estable de la cuenta origen.
      const agrupados: Record<string, PedidoActivo[]> = {};
      for (const pedido of (data as PedidoActivo[]) ?? []) {
        const clave = claveGrupo(pedido.seller_id, pedido.ml_user_id);
        if (!agrupados[clave]) agrupados[clave] = [];
        agrupados[clave].push(pedido);
      }

      return agrupados;
    });

    const grupos = Object.keys(pedidosPorConexion);
    logger.info(`Conexiones con pedidos activos: ${grupos.length}`);

    let totalEventosPublicados = 0;

    // Procesar cada conexión en pasos independientes — el fallo de una no afecta
    // al resto (aislamiento por cuenta, no por seller).
    await Promise.allSettled(
      grupos.map((clave) =>
        step.run(`polling:conexion:${clave}`, async () => {
          const pedidos = pedidosPorConexion[clave];
          if (!pedidos?.length) return;

          const sellerId = pedidos[0].seller_id;
          // La cuenta de origen de este grupo (misma para todos sus pedidos).
          // `null` = pedidos legacy sin estampar → conexión representativa.
          const mlUserIdPedido = pedidos[0].ml_user_id;

          // Obtener el token de la conexión de ESTA cuenta.
          const supabase = crearClienteServiceRole();
          let consulta = supabase
            .schema("identidad")
            .from("conexiones_seller_ml")
            .select("access_token_ref, estado_salud, ml_user_id")
            .eq("seller_id", sellerId);
          if (mlUserIdPedido) {
            consulta = consulta.eq("ml_user_id", mlUserIdPedido);
          }
          const { data: conexionData, error: conexionError } = await consulta
            .limit(1)
            .maybeSingle();

          if (conexionError || !conexionData) {
            logger.warn(
              `No se encontró conexión ML para seller ${sellerId} ` +
                `(cuenta ${mlUserIdPedido ?? "sin estampar"}). Saltando.`,
            );
            return;
          }

          const conexion = conexionData as ConexionConToken;

          if (conexion.estado_salud === "desvinculada" || !conexion.access_token_ref) {
            logger.warn(
              `Conexión ML del seller ${sellerId} (cuenta ${mlUserIdPedido ?? "sin estampar"}) ` +
                "está desvinculada o sin token. Saltando.",
            );
            return;
          }

          let accessToken: string;
          try {
            const descifrado = await descifrarSecreto(conexion.access_token_ref);
            if (typeof descifrado.valor !== "string") {
              throw new Error("Token descifrado no es texto");
            }
            accessToken = descifrado.valor;
          } catch {
            logger.warn(
              `No se pudo obtener el token del seller ${sellerId} ` +
                `(cuenta ${mlUserIdPedido ?? "sin estampar"}). Saltando.`,
            );
            return;
          }

          // userId de ML para desambiguar colisiones de shipment_id en el Job 3.
          // Preferir el ml_user_id de la conexión resuelta; si falta (caso
          // degradado), el del pedido; y en último término el sellerId.
          const mlUserId = conexion.ml_user_id ?? mlUserIdPedido ?? sellerId;

          // Consultar cada shipment activo individualmente (endpoint verificado
          // GET /shipments/{id}). Publicar evento solo si el estado_ml difiere.
          let eventosEnConexion = 0;

          for (const pedidoLocal of pedidos) {
            const shipmentIdStr = String(pedidoLocal.ml_shipment_id);

            let shipmentMl: ShipmentMlDetalle;
            try {
              shipmentMl = await peticionMl<ShipmentMlDetalle>({
                metodo: "GET",
                ruta: `/shipments/${shipmentIdStr}`,
                accessToken,
                encabezadosExtra: { "x-format-new": "true" },
              });
            } catch (error) {
              if (error instanceof ErrorHttpMl) {
                // Token caído (401/403) → abortar el seller entero; el sondeo de
                // salud gestionará la desvinculación.
                if (error.status === 401 || error.status === 403) {
                  logger.warn(
                    `Token del seller ${sellerId} rechazado por ML (${error.status}). ` +
                      "El sondeo de salud gestionará la desvinculación.",
                  );
                  return;
                }
                // 404 → el shipment no existe en ML; saltar este pedido.
                if (error.status === 404) continue;
              }
              // Otros errores (ya con backoff agotado): registrar SIN exponer
              // token y continuar con el siguiente shipment — no perder el resto.
              const msg = error instanceof Error ? error.message : String(error);
              logger.error(
                `Error al consultar shipment ${shipmentIdStr} del seller ${sellerId}: ${msg}`,
              );
              continue;
            }

            // Solo publicar si el estado_ml reportado difiere del registrado.
            // El Job 3 vuelve a leer el recurso (fuente de verdad) y aplica la
            // transición con optimistic locking → idempotente ante duplicados.
            if (pedidoLocal.estado_ml !== shipmentMl.status) {
              await inngest.send({
                name: "ml/shipment.actualizado",
                data: {
                  shipmentId: shipmentIdStr,
                  userId: String(mlUserId),
                  timestamp: new Date().toISOString(),
                },
              });
              eventosEnConexion++;
            }
          }

          // El token en claro sale de scope aquí.
          totalEventosPublicados += eventosEnConexion;
          logger.info(
            `Seller ${sellerId} (cuenta ${mlUserId}): ${eventosEnConexion} eventos publicados.`,
          );
        }),
      ),
    );

    logger.info(`Polling completado. Total eventos publicados: ${totalEventosPublicados}`);
    return { conexiones: grupos.length, eventosPublicados: totalEventosPublicados };
  },
);
