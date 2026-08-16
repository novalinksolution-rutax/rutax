/**
 * Job 5 · ml/ejecutarBackfill
 * =====================================================================
 * Trigger: evento `ml/conexion.reconectada`
 * (publicado por `intercambiarCodigoPorTokens` en puerto.ts cuando el
 * intercambio OAuth es exitoso)
 *
 * Recupera los pedidos de ML del período en que el seller estuvo desconectado
 * y los inserta/actualiza en `operacion.pedidos` con `origen = 'backfill'`.
 *
 * ⚠️ **Este job ya NO es la única vía de entrada de un pedido Flex.** Toda la
 * mecánica de "leer el envío, filtrar Flex, mapear y persistir" se extrajo a
 * `../ingesta-pedidos.ts`, que comparten tres llamadores: este backfill, el
 * webhook (`procesar-shipment.ts`) y el cron continuo (`ingesta-pedidos-ml.ts`).
 * Aquí solo queda lo PROPIO del backfill: la ventana de la desconexión y el
 * registro del intento en `operacion.intentos_backfill`.
 *
 * Los símbolos de lectura de shipments se re-exportan al final del archivo por
 * compatibilidad con quien ya los importaba desde aquí. Son la MISMA
 * implementación, no una copia.
 *
 * Idempotencia (dos niveles):
 * 1. Unique constraint `(conexion_ml_id, desde, hasta)` en `intentos_backfill`
 *    garantiza que no se puede iniciar el mismo backfill dos veces.
 * 2. La ingesta compartida resuelve INSERT vs UPDATE por
 *    `(tenant_id, ml_shipment_id)` y absorbe duplicados si el job se reintenta.
 *
 * Límite de ventana: si `desconectada_desde` es null o > 7 días atrás, se
 * acota a 7 días y se deja constancia en el log.
 *
 * SEGURIDAD: tokens nunca en logs. Del shipment NUNCA se loguea un valor —
 * trae nombre y dirección del destinatario. El diagnóstico de forma solo
 * imprime `Object.keys` (nombres de campo) y en qué rama apareció cada dato.
 */

import { inngest } from "@/lib/inngest/cliente";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { descifrarSecreto } from "../../secretos";
import { peticionMl } from "../cliente-http";
import {
  extraerShipmentId,
  ingestarShipmentsMl,
  type ContextoIngestaMl,
  type EntradaShipmentIngesta,
  type OrderMl,
} from "../ingesta-pedidos";

const VENTANA_MAXIMA_DIAS = 7;
const PAGE_SIZE = 50;

/**
 * Corte duro de páginas de `/orders/search`. Sin él, un `results: []` con
 * `total > 0` (posible bajo límite de tasa) deja `offset` clavado y el paso
 * gira hasta el timeout de Inngest. El corte por `results` vacío ya rompe ese
 * bucle; esto es el cinturón por si ML devuelve una página no vacía en loop.
 * 200 páginas × 50 = 10.000 órdenes, muy por encima de una ventana de 7 días.
 */
export const MAX_PAGINAS_BACKFILL = 200;

interface EventoConexionReconectada {
  conexionId: string;
  sellerId: string;
  tenantId: string;
  desconectadaDesde: string | null;
}

interface FilaConexionBackfill {
  id: string;
  seller_id: string;
  tenant_id: string;
  ml_user_id: string | null;
  access_token_ref: string | null;
}

/**
 * Marca el intento como fallido con su mensaje. Escritura PLANA (fuera de
 * `step.run`) a propósito: se ejecuta en el camino de error sin alterar la
 * secuencia de pasos memoizados de Inngest entre reintentos.
 *
 * El mensaje se trunca y NUNCA incluye cuerpos de respuesta de ML ni datos del
 * destinatario — solo el texto del error (método, ruta, status).
 */
async function marcarIntentoFallido(intentoId: string, mensaje: string): Promise<void> {
  const supabase = crearClienteServiceRole();
  await supabase
    .schema("operacion")
    .from("intentos_backfill")
    .update({ estado: "fallido", error: mensaje.slice(0, 500) })
    .eq("id", intentoId);
}

export const jobEjecutarBackfill = inngest.createFunction(
  {
    id: "ml/ejecutarBackfill",
    name: "ML · Backfill de pedidos tras reconexión",
    triggers: [{ event: "ml/conexion.reconectada" }],
    retries: 3,
  },
  async ({ event, step, logger }) => {
    const payload = event.data as EventoConexionReconectada;
    const { conexionId, sellerId, tenantId } = payload;

    // Paso 1: calcular ventana de tiempo y crear/reutilizar el intento de backfill.
    const intentoBackfill = await step.run("crear-o-reutilizar-intento", async () => {
      const ahora = new Date();
      const ventanaMaxima = new Date(ahora.getTime() - VENTANA_MAXIMA_DIAS * 24 * 60 * 60 * 1000);

      let desconectadaDesde: Date;
      let ventanaRecortada = false;

      if (!payload.desconectadaDesde) {
        // Primera vinculación o dato ausente: acotar a 7 días.
        desconectadaDesde = ventanaMaxima;
        ventanaRecortada = true;
        logger.info(
          `Conexión ${conexionId}: desconectada_desde es null. ` +
            `Acotando backfill a ${VENTANA_MAXIMA_DIAS} días.`,
        );
      } else {
        const fechaDesconexion = new Date(payload.desconectadaDesde);
        if (fechaDesconexion < ventanaMaxima) {
          desconectadaDesde = ventanaMaxima;
          ventanaRecortada = true;
          logger.info(
            `Conexión ${conexionId}: desconectada_desde (${payload.desconectadaDesde}) ` +
              `excede ${VENTANA_MAXIMA_DIAS} días. Acotando.`,
          );
        } else {
          desconectadaDesde = fechaDesconexion;
        }
      }

      const supabase = crearClienteServiceRole();

      // Idempotencia: insertar ignorando conflicto de unique constraint.
      const { data: intentoData, error: insertError } = await supabase
        .schema("operacion")
        .from("intentos_backfill")
        .upsert(
          {
            tenant_id: tenantId,
            conexion_ml_id: conexionId,
            seller_id: sellerId,
            desde: desconectadaDesde.toISOString(),
            hasta: ahora.toISOString(),
            estado: "en_progreso",
          },
          {
            onConflict: "conexion_ml_id,desde,hasta",
            ignoreDuplicates: false, // Actualizar si ya existe
          },
        )
        .select("id, desde, hasta, estado")
        .single();

      if (insertError) {
        throw new Error(`Error al crear intento de backfill: ${insertError.message}`);
      }

      return {
        intentoId: intentoData.id as string,
        desde: new Date(intentoData.desde as string),
        hasta: new Date(intentoData.hasta as string),
        ventanaRecortada,
        // Si ya estaba completado, indicarlo para hacer no-op
        yaCompletado: intentoData.estado === "completado",
      };
    });

    // Idempotencia: si ya estaba completado (reintento tras éxito), salir.
    if (intentoBackfill.yaCompletado) {
      logger.info(
        `Backfill ${intentoBackfill.intentoId} ya está completado. No-op idempotente.`,
      );
      return { resultado: "ya_completado", intentoId: intentoBackfill.intentoId };
    }

    // A partir de aquí el intento EXISTE, así que cualquier muerte tiene que
    // quedar escrita en él. Sin este envoltorio, el único camino que escribía
    // `fallido` era el guard de conexión incompleta: los tres intentos que
    // murieron en producción quedaron en `en_progreso` para siempre.
    //
    // Inngest lanza el error del paso dentro del cuerpo de la función cuando el
    // paso agota sus reintentos, así que este catch corre también en el último
    // intento — que es justo el caso que interesa. Si un reintento posterior sí
    // llega al final, `marcar-completado` sobrescribe el `fallido`.
    try {
      // Paso 2: obtener la conexión con el ml_user_id y access_token.
      const conexion = await step.run("obtener-conexion", async () => {
        const supabase = crearClienteServiceRole();
        const { data, error } = await supabase
          .schema("identidad")
          .from("conexiones_seller_ml")
          .select("id, seller_id, tenant_id, ml_user_id, access_token_ref")
          .eq("id", conexionId)
          .single();

        if (error || !data) {
          throw new Error(`No se encontró la conexión ${conexionId}: ${error?.message}`);
        }

        return data as FilaConexionBackfill;
      });

      if (!conexion.ml_user_id || !conexion.access_token_ref) {
        logger.error(
          `Conexión ${conexionId} sin ml_user_id o access_token_ref. Abortando backfill.`,
        );
        await marcarIntentoFallido(
          intentoBackfill.intentoId,
          "Conexión sin datos necesarios para backfill.",
        );
        return { resultado: "fallido", razon: "conexion_incompleta" };
      }

      // Paso 3: paginar sobre los pedidos del seller en el período e ingerir.
      const resumen = await step.run("paginar-y-upsert-pedidos", async () => {
        // Descifrar token
        const descifrado = await descifrarSecreto(conexion.access_token_ref!);
        if (typeof descifrado.valor !== "string") {
          throw new Error("access_token descifrado no es texto");
        }
        const accessToken = descifrado.valor;

        const supabase = crearClienteServiceRole();
        const ctx: ContextoIngestaMl = {
          tenantId,
          sellerId,
          mlUserId: conexion.ml_user_id!,
          origen: "backfill",
        };

        let offset = 0;
        let paginas = 0;
        let totalProcesados = 0;
        let totalOmitidosNoFlex = 0;
        let totalSinEnvio = 0;
        let totalShipmentsIlegibles = 0;
        let totalErroresUpsert = 0;
        let primerErrorUpsert: string | null = null;
        let diagnosticoRegistrado = false;
        let hayMas = true;

        // Inngest serializa el retorno de step.run a JSON — las fechas quedan
        // como strings ISO. Usamos directamente el string ya que viene de un
        // toISOString() en el paso anterior.
        const desdeIso = typeof intentoBackfill.desde === "string"
          ? intentoBackfill.desde
          : (intentoBackfill.desde as Date).toISOString();
        const hastaIso = typeof intentoBackfill.hasta === "string"
          ? intentoBackfill.hasta
          : (intentoBackfill.hasta as Date).toISOString();

        while (hayMas) {
          if (paginas >= MAX_PAGINAS_BACKFILL) {
            logger.warn(
              `Backfill conexión ${conexionId}: corte por tope de ${MAX_PAGINAS_BACKFILL} ` +
                "páginas. Quedaron órdenes sin recorrer en esta ventana.",
            );
            break;
          }
          paginas += 1;

          const parametros = new URLSearchParams({
            seller: conexion.ml_user_id!,
            "order.date_created.from": desdeIso,
            "order.date_created.to": hastaIso,
            limit: String(PAGE_SIZE),
            offset: String(offset),
          });

          // `peticionMl` en vez de `fetch` crudo: backoff ante 429/5xx y respeto
          // de `Retry-After`. Sin `x-format-new` — ver ENCABEZADO_FORMATO_NUEVO_ML.
          const body = await peticionMl<{
            results?: OrderMl[];
            paging?: { total?: number; offset?: number; limit?: number };
          }>({
            metodo: "GET",
            ruta: `/orders/search?${parametros.toString()}`,
            accessToken,
          });

          const orders: OrderMl[] = body.results ?? [];
          const total = body.paging?.total ?? 0;

          // Corte de seguridad: una página vacía con `total > 0` (posible bajo
          // límite de tasa) dejaba `offset` clavado y el paso giraba hasta el
          // timeout. Si ML no devuelve nada, se termina.
          if (orders.length === 0) {
            if (total > offset) {
              logger.warn(
                `Backfill conexión ${conexionId}: ML devolvió una página vacía con ` +
                  `total=${total} en offset=${offset}. Se corta el recorrido para no ` +
                  "girar en vacío; la próxima corrida lo retoma.",
              );
            }
            break;
          }

          // El detalle del envío se consulta de a uno (`GET /shipments/{id}`):
          // trae el logistic_type para filtrar a Flex, el domicilio real del
          // destinatario (con `x-format-new` la orden ya no lo trae), el estado
          // del ENVÍO y el compromiso de entrega. De paso, la coordenada cuando
          // ML la tiene: geocoding gratis, sin proveedor de pago.
          const entradas: EntradaShipmentIngesta[] = [];
          for (const order of orders) {
            const shipmentId = extraerShipmentId(order);
            // Envío aún no creado por ML (`shipping.id === null`): caso esperado,
            // no error. Se omite en esta pasada — la ventana del backfill vuelve
            // a cubrir la orden en la próxima corrida, y el pedido no se pierde.
            if (!shipmentId) {
              totalSinEnvio++;
              continue;
            }
            entradas.push({
              shipmentId,
              mlOrderId: String(order.id),
              ordenCreadaIso: order.date_created ?? null,
              direccionRespaldo: order.shipping_address?.address_line ?? null,
              comunaRespaldo: order.shipping_address?.city?.name ?? null,
            });
          }

          const ingesta = await ingestarShipmentsMl(supabase, entradas, ctx, accessToken, {
            logger,
          });

          totalProcesados += ingesta.procesados;
          totalOmitidosNoFlex += ingesta.omitidosNoFlex;
          totalShipmentsIlegibles += ingesta.ilegibles + ingesta.noEncontrados.length;
          totalErroresUpsert += ingesta.erroresPersistencia;
          primerErrorUpsert ??= ingesta.primerErrorPersistencia;

          if (!diagnosticoRegistrado && ingesta.diagnostico) {
            diagnosticoRegistrado = true;
            const d = ingesta.diagnostico;
            // SOLO nombres de campo y ubicaciones. Ni un valor del shipment.
            logger.info(
              `Backfill conexión ${conexionId}: forma del shipment — ` +
                `claves=[${d.claves.join(",")}] ` +
                `plazos=[${d.clavesPlazos.join(",")}] ` +
                `logistic_type=${d.ubicacionLogisticType} ` +
                `direccion=${d.ubicacionDireccion} ` +
                `fecha_hecho=${d.campoFechaEntrega ?? "ausente"}`,
            );
          }

          if (ingesta.ilegibles + ingesta.noEncontrados.length > 0) {
            logger.warn(
              `Backfill conexión ${conexionId}: ` +
                `${ingesta.ilegibles + ingesta.noEncontrados.length} envíos no se ` +
                "pudieron leer en esta página. Se omiten sin interrumpir; la próxima " +
                "pasada los reintenta. Un 404 NO se interpreta como cancelación.",
            );
          }

          offset += orders.length;
          hayMas = offset < total;
        }

        if (totalOmitidosNoFlex > 0) {
          logger.info(
            `Backfill conexión ${conexionId}: ${totalOmitidosNoFlex} envíos omitidos ` +
              "por no ser Flex (self_service) — Full/Colecta/Agencia fuera de alcance.",
          );
        }

        if (totalSinEnvio > 0) {
          logger.info(
            `Backfill conexión ${conexionId}: ${totalSinEnvio} órdenes sin envío creado ` +
              "todavía (shipping.id null). Caso esperado — se recogen en la próxima pasada.",
          );
        }

        // Un upsert que falla es un pedido que NO entró. Se propaga para que el
        // intento quede `fallido` con su mensaje en vez de mentir «completado».
        if (totalErroresUpsert > 0) {
          throw new Error(
            `Backfill conexión ${conexionId}: ${totalErroresUpsert} pedidos no se ` +
              `pudieron guardar (${totalProcesados} sí). Primer error: ${primerErrorUpsert}`,
          );
        }

        // El accessToken sale de scope aquí.
        return { totalProcesados, totalOmitidosNoFlex, totalSinEnvio, totalShipmentsIlegibles };
      });

      const totalPedidos = resumen.totalProcesados;

      // Paso 4: marcar el intento como completado.
      await step.run("marcar-completado", async () => {
        const supabase = crearClienteServiceRole();
        await supabase
          .schema("operacion")
          .from("intentos_backfill")
          .update({
            estado: "completado",
            pedidos_recuperados: totalPedidos,
            completado_en: new Date().toISOString(),
          })
          .eq("id", intentoBackfill.intentoId);
      });

      logger.info(
        `Backfill completado para conexión ${conexionId}. ` +
          `Pedidos recuperados: ${totalPedidos}. ` +
          (intentoBackfill.ventanaRecortada ? "Ventana recortada a 7 días." : ""),
      );

      return {
        resultado: "completado",
        intentoId: intentoBackfill.intentoId,
        pedidosRecuperados: totalPedidos,
        omitidosNoFlex: resumen.totalOmitidosNoFlex,
        sinEnvio: resumen.totalSinEnvio,
        shipmentsIlegibles: resumen.totalShipmentsIlegibles,
        ventanaRecortada: intentoBackfill.ventanaRecortada,
      };
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);
      logger.error(`Backfill conexión ${conexionId} falló: ${mensaje}`);
      await marcarIntentoFallido(intentoBackfill.intentoId, mensaje);
      throw error;
    }
  },
);

// ---------------------------------------------------------------------------
// Re-exportes de compatibilidad.
//
// La lectura de shipments vive ahora en `../ingesta-pedidos.ts` (una sola
// implementación, tres llamadores). Se re-exporta desde aquí para no romper a
// quien ya importaba estos símbolos de este archivo — incluida su batería de
// pruebas de regresión, que sigue ejerciendo EL MISMO código.
// ---------------------------------------------------------------------------
export {
  calleDeDireccion,
  CONCURRENCIA_SHIPMENTS,
  coordenadasDeReceiver,
  derivarFechaCompromiso,
  ENCABEZADO_FORMATO_NUEVO_ML,
  extraerShipmentId,
  interpretarShipment,
  leerDireccionShipment,
  leerFechaEntregaMl,
  leerLogisticType,
  leerOrderIdDeShipment,
  LOGISTIC_TYPE_FLEX,
  mapearConConcurrencia,
  obtenerDatosPorShipment,
  obtenerLogisticTypePorShipment,
  obtenerShipment,
} from "../ingesta-pedidos";

export type {
  DatosShipmentMl,
  DiagnosticoShipmentMl,
  DireccionShipmentMl,
  FalloShipment,
  OrderMl,
  PlazosShipmentMl,
  ResultadoLoteShipments,
  ShipmentMl,
} from "../ingesta-pedidos";
