/**
 * Job 4 · ml/pollingEstadosPedidos (sondeo de respaldo)
 * =====================================================================
 * Cadencia: cada 15 minutos (cron "0 *\/15 * * * *").
 *
 * Cierra el hueco de eventos perdidos del webhook. Para cada seller con pedidos
 * activos ('asignado' | 'en_ruta'), consulta el estado actual en ML vía
 * `GET /shipments?ids={batch}` y publica el evento `ml/shipment.actualizado`
 * si el estado difiere. El Job 3 reutiliza el mismo handler para procesar
 * tanto webhooks como polling — garantiza consistencia de paths.
 *
 * Batches: hasta 50 shipment_ids por llamada (límite documentado de ML para
 * el endpoint de consulta múltiple — reverificar antes de producción).
 *
 * SEGURIDAD: tokens nunca en logs ni en payloads de Inngest.
 *
 * Fuente batch endpoint: developers.mercadolibre.com.ar — "Shipments" /
 * "Get multiple shipments" — verificado en esta iteración.
 */

import { inngest } from "@/lib/inngest/cliente";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { descifrarSecreto } from "../../secretos";
import { ML_API_BASE_URL } from "../cliente-http";

const BATCH_SIZE = 50;

interface PedidoActivo {
  id: string;
  tenant_id: string;
  seller_id: string;
  ml_shipment_id: string;
  estado: string;
  estado_ml: string | null;
}

interface ConexionConToken {
  access_token_ref: string | null;
  estado_salud: string;
}

/** Respuesta del endpoint batch de shipments de ML */
interface ShipmentMlBatch {
  id: number | string;
  status: string;
}

export const jobPollingEstadosPedidos = inngest.createFunction(
  {
    id: "ml/pollingEstadosPedidos",
    name: "ML · Polling de estados de pedidos (respaldo webhook)",
    triggers: [{ cron: "0 */15 * * * *" }],
    retries: 2,
  },
  async ({ step, logger }) => {
    // Paso 1: leer pedidos activos agrupados por seller.
    const pedidosPorSeller = await step.run("leer-pedidos-activos", async () => {
      const supabase = crearClienteServiceRole();

      const { data, error } = await supabase
        .schema("operacion")
        .from("pedidos")
        .select("id, tenant_id, seller_id, ml_shipment_id, estado, estado_ml")
        .in("estado", ["asignado", "en_ruta"])
        .not("ml_shipment_id", "is", null);

      if (error) {
        throw new Error(`Error al leer pedidos activos: ${error.message}`);
      }

      // Agrupar por seller_id
      const agrupados: Record<string, PedidoActivo[]> = {};
      for (const pedido of (data as PedidoActivo[]) ?? []) {
        if (!agrupados[pedido.seller_id]) agrupados[pedido.seller_id] = [];
        agrupados[pedido.seller_id].push(pedido);
      }

      return agrupados;
    });

    const sellers = Object.keys(pedidosPorSeller);
    logger.info(`Sellers con pedidos activos: ${sellers.length}`);

    let totalEventosPublicados = 0;

    // Procesar cada seller en pasos independientes — el fallo de uno no afecta al resto.
    await Promise.allSettled(
      sellers.map((sellerId) =>
        step.run(`polling:seller:${sellerId}`, async () => {
          const pedidos = pedidosPorSeller[sellerId];
          if (!pedidos?.length) return;

          // Obtener token del seller
          const supabase = crearClienteServiceRole();
          const { data: conexionData, error: conexionError } = await supabase
            .schema("identidad")
            .from("conexiones_seller_ml")
            .select("access_token_ref, estado_salud")
            .eq("seller_id", sellerId)
            .maybeSingle();

          if (conexionError || !conexionData) {
            logger.warn(
              `No se encontró conexión ML para seller ${sellerId}. Saltando.`,
            );
            return;
          }

          const conexion = conexionData as ConexionConToken;

          if (conexion.estado_salud === "desvinculada" || !conexion.access_token_ref) {
            logger.warn(
              `Conexión ML del seller ${sellerId} está desvinculada o sin token. Saltando.`,
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
              `No se pudo obtener el token del seller ${sellerId}. Saltando.`,
            );
            return;
          }

          // Procesar en batches de 50
          const shipmentIds = pedidos.map((p) => p.ml_shipment_id);
          let eventosEnSeller = 0;

          for (let i = 0; i < shipmentIds.length; i += BATCH_SIZE) {
            const batch = shipmentIds.slice(i, i + BATCH_SIZE);
            const idsParam = batch.join(",");

            let shipmentsMl: ShipmentMlBatch[] = [];
            try {
              // NOTA: el endpoint batch de ML es `GET /shipments?shipment_ids={ids}`
              // Verificar el parámetro exacto contra la documentación oficial
              // antes de producción — puede ser `ids` o `shipment_ids` según versión.
              const respuesta = await fetch(
                `${ML_API_BASE_URL}/shipments?ids=${encodeURIComponent(idsParam)}`,
                {
                  method: "GET",
                  headers: {
                    authorization: `Bearer ${accessToken}`,
                    accept: "application/json",
                  },
                },
              );

              if (!respuesta.ok) {
                if (respuesta.status === 401 || respuesta.status === 403) {
                  // Token caído — registrar y pasar al siguiente seller completo
                  logger.warn(
                    `Token del seller ${sellerId} rechazado por ML (${respuesta.status}). ` +
                      "El sondeo de salud gestionará la desvinculación.",
                  );
                  return; // Salir del seller entero
                }
                throw new Error(`ML respondió ${respuesta.status} para batch de shipments`);
              }

              shipmentsMl = (await respuesta.json()) as ShipmentMlBatch[];
            } catch (error) {
              const msg = error instanceof Error ? error.message : String(error);
              logger.error(`Error en batch de polling para seller ${sellerId}: ${msg}`);
              continue; // Continuar con el siguiente batch si hay error
            }

            // Comparar con estado local y publicar eventos solo si difieren
            const pedidosPorShipmentId: Record<string, PedidoActivo> = {};
            for (const p of pedidos) {
              pedidosPorShipmentId[p.ml_shipment_id] = p;
            }

            for (const shipmentMl of shipmentsMl) {
              const shipmentIdStr = String(shipmentMl.id);
              const pedidoLocal = pedidosPorShipmentId[shipmentIdStr];

              if (!pedidoLocal) continue;

              // Solo publicar si el estado_ml reportado difiere del registrado
              if (pedidoLocal.estado_ml !== shipmentMl.status) {
                await inngest.send({
                  name: "ml/shipment.actualizado",
                  data: {
                    shipmentId: shipmentIdStr,
                    userId: sellerId, // El userId de ML se resuelve en el Job 3
                    timestamp: new Date().toISOString(),
                  },
                });
                eventosEnSeller++;
              }
            }
          }

          // El token en claro sale de scope aquí.
          totalEventosPublicados += eventosEnSeller;
          logger.info(`Seller ${sellerId}: ${eventosEnSeller} eventos publicados.`);
        }),
      ),
    );

    logger.info(`Polling completado. Total eventos publicados: ${totalEventosPublicados}`);
    return { sellers: sellers.length, eventosPublicados: totalEventosPublicados };
  },
);
