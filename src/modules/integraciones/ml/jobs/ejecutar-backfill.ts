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
 * Idempotencia (dos niveles):
 * 1. Unique constraint `(conexion_ml_id, desde, hasta)` en `intentos_backfill`
 *    garantiza que no se puede iniciar el mismo backfill dos veces.
 * 2. Upsert sobre `(tenant_id, ml_shipment_id)` en `operacion.pedidos` absorbe
 *    duplicados si el job se reintenta.
 *
 * Límite de ventana: si `desconectada_desde` es null o > 7 días atrás, se
 * acota a 7 días y se deja constancia en el log.
 *
 * SEGURIDAD: tokens nunca en logs.
 *
 * API de ML para pedidos del seller:
 * GET /orders/search?seller={ml_user_id}&order.date_created.from={desde}&...
 * Los pedidos tienen envíos asociados — se accede a `shipments` via
 * `order.shipping.shipment_id` o el campo `shipping` del order.
 * Verificar el endpoint exacto contra documentación ML vigente antes de
 * producción — la paginación usa `offset` y `limit` (máx. 50 por página).
 */

import { inngest } from "@/lib/inngest/cliente";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { descifrarSecreto } from "../../secretos";
import { ML_API_BASE_URL } from "../cliente-http";
import { ahoraEnSantiago, horaAMinutos } from "@/lib/fecha-santiago";
import { resolverComunaCanonica } from "@/modules/integraciones/geocoding/normalizacion";
import { resolverZona } from "@/modules/operacion/zonas";
import { resolverVentanaCorte } from "@/modules/operacion/ventanas-corte";

const VENTANA_MAXIMA_DIAS = 7;
const PAGE_SIZE = 50;

/**
 * Tipo logístico de Mercado Libre que corresponde a Flex (el seller/courier
 * hace el last-mile). Es el ÚNICO que este SaaS ingiere: Full (`fulfillment`),
 * Colecta (`cross_docking`) y Agencia (`drop_off`/`xd_drop_off`) los despacha
 * ML, no hay conductor del courier — el motor entrega→dinero no aplica.
 * Fuente: campo `logistic_type` del shipment en la API de ML.
 */
export const LOGISTIC_TYPE_FLEX = "self_service";

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

/** Pedido de ML (campos mínimos para el backfill). */
interface OrderMl {
  id: number | string;
  shipping?: {
    shipment_id?: number | string | null;
  };
  order_items?: Array<{
    item?: { title?: string };
  }>;
  buyer?: {
    nickname?: string;
    phone?: { number?: string };
  };
  shipping_address?: {
    address_line?: string;
    city?: { name?: string };
  };
  date_created?: string;
  status?: string;
}

/**
 * Trae el `logistic_type` de un lote de shipments vía el endpoint batch de ML
 * (`GET /shipments?ids=`). Devuelve un mapa shipmentId → logistic_type para
 * filtrar a Flex antes de ingerir. Un shipment ausente/sin tipo queda como
 * `null` → se OMITE (no se asume Flex): preferimos no ingerir que mis-ingerir
 * un Full como Flex.
 */
export async function obtenerLogisticTypePorShipment(
  shipmentIds: string[],
  accessToken: string,
): Promise<Map<string, string | null>> {
  const mapa = new Map<string, string | null>();
  if (shipmentIds.length === 0) return mapa;

  const idsParam = shipmentIds.join(",");
  const respuesta = await fetch(
    `${ML_API_BASE_URL}/shipments?ids=${encodeURIComponent(idsParam)}`,
    { method: "GET", headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" } },
  );

  if (!respuesta.ok) {
    throw new Error(`ML respondió ${respuesta.status} para batch de shipments (backfill)`);
  }

  const shipments = (await respuesta.json()) as Array<{
    id: number | string;
    logistic_type?: string | null;
  }>;

  for (const s of shipments ?? []) {
    mapa.set(String(s.id), s.logistic_type ?? null);
  }
  return mapa;
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
      logger.error(`Conexión ${conexionId} sin ml_user_id o access_token_ref. Abortando backfill.`);
      const supabase = crearClienteServiceRole();
      await supabase
        .schema("operacion")
        .from("intentos_backfill")
        .update({ estado: "fallido", error: "Conexión sin datos necesarios para backfill." })
        .eq("id", intentoBackfill.intentoId);
      return { resultado: "fallido", razon: "conexion_incompleta" };
    }

    // Paso 3: paginar sobre los pedidos del seller en el período y hacer upsert.
    const totalPedidos = await step.run("paginar-y-upsert-pedidos", async () => {
      // Descifrar token
      const descifrado = await descifrarSecreto(conexion.access_token_ref!);
      if (typeof descifrado.valor !== "string") {
        throw new Error("access_token descifrado no es texto");
      }
      const accessToken = descifrado.valor;

      const supabase = crearClienteServiceRole();
      let offset = 0;
      let totalProcesados = 0;
      let totalOmitidosNoFlex = 0;
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
        const url = new URL(`${ML_API_BASE_URL}/orders/search`);
        url.searchParams.set("seller", conexion.ml_user_id!);
        url.searchParams.set("order.date_created.from", desdeIso);
        url.searchParams.set("order.date_created.to", hastaIso);
        url.searchParams.set("limit", String(PAGE_SIZE));
        url.searchParams.set("offset", String(offset));

        const respuesta = await fetch(url.toString(), {
          method: "GET",
          headers: {
            authorization: `Bearer ${accessToken}`,
            accept: "application/json",
          },
        });

        if (!respuesta.ok) {
          throw new Error(`ML respondió ${respuesta.status} durante backfill`);
        }

        const body = (await respuesta.json()) as {
          results: OrderMl[];
          paging: { total: number; offset: number; limit: number };
        };

        const orders: OrderMl[] = body.results ?? [];
        const paging = body.paging;

        // Resolver el logistic_type de los envíos de esta página en un solo
        // batch, para ingerir SOLO Flex (self_service) y descartar Full/Colecta/
        // Agencia, que ML despacha (no hay conductor del courier).
        const shipmentIdsPagina = orders
          .map((o) => (o.shipping?.shipment_id ? String(o.shipping.shipment_id) : null))
          .filter((id): id is string => id !== null);
        const mapaLogistic = await obtenerLogisticTypePorShipment(shipmentIdsPagina, accessToken);

        for (const order of orders) {
          const shipmentId = order.shipping?.shipment_id
            ? String(order.shipping.shipment_id)
            : null;

          if (!shipmentId) continue;

          // Filtro de alcance: solo Flex. Si el tipo no es self_service
          // (Full/Colecta/Agencia) o no se pudo resolver, se omite — nunca se
          // ingiere como Flex.
          if (mapaLogistic.get(shipmentId) !== LOGISTIC_TYPE_FLEX) {
            totalOmitidosNoFlex++;
            continue;
          }

          // Marca informativa de corte_riesgo (F7, ítem 1.2).
          // NUNCA bloquea ni rechaza — es solo un flag de aviso.
          // Si falla la resolución de ventana se inserta el pedido sin la marca.
          let corteRiesgoFlex = false;
          try {
            const comunaFlexNorm = resolverComunaCanonica(
              order.shipping_address?.city?.name ?? 'Santiago',
            );
            if (comunaFlexNorm) {
              const zonaIdFlex = await resolverZona(supabase, tenantId, comunaFlexNorm);
              const ventanaFlex = await resolverVentanaCorte(
                supabase,
                tenantId,
                sellerId,
                zonaIdFlex,
                'flex',
              );
              if (ventanaFlex) {
                const { hora } = ahoraEnSantiago();
                corteRiesgoFlex = horaAMinutos(hora) > horaAMinutos(ventanaFlex.horaCorte);
              }
            }
          } catch {
            // Cálculo de corte best-effort — no interrumpir la ingesta.
          }

          // Upsert en operacion.pedidos con origen = 'backfill'
          // ON CONFLICT (tenant_id, ml_shipment_id) → actualizar estado_ml si difiere.
          // Se retorna creado_en/actualizado_en para detectar si fue INSERT nuevo:
          // cuando ambos valores son idénticos el trigger los pone al mismo instante.
          const { data: filaPedido } = await supabase
            .schema("operacion")
            .from("pedidos")
            .upsert(
              {
                tenant_id: tenantId,
                seller_id: sellerId,
                // Origen de cuenta ML (estable): el backfill ya opera por conexión,
                // así que estampamos de qué cuenta proviene el pedido. Guardado no
                // nulo por el guard de arriba (conexión con ml_user_id).
                ml_user_id: conexion.ml_user_id!,
                tipo_pedido: "flex",
                origen: "backfill",
                ml_order_id: String(order.id),
                ml_shipment_id: shipmentId,
                estado: "pendiente_asignacion",
                estado_ml: order.status ?? null,
                ultima_sync_ml_en: new Date().toISOString(),
                destinatario_nombre:
                  order.order_items?.[0]?.item?.title ?? "Destinatario pendiente",
                destinatario_direccion:
                  order.shipping_address?.address_line ?? "Dirección pendiente",
                destinatario_comuna: order.shipping_address?.city?.name ?? "Santiago",
                corte_riesgo: corteRiesgoFlex,
              },
              {
                onConflict: "tenant_id,ml_shipment_id",
                ignoreDuplicates: false,
              },
            )
            .select("id, creado_en, actualizado_en, destinatario_direccion, destinatario_comuna")
            .maybeSingle();

          totalProcesados++;

          // Publicar evento de geocodificación SOLO para pedidos genuinamente nuevos
          // (INSERT, no UPDATE). Se detecta comparando creado_en con actualizado_en:
          // en un INSERT el trigger los pone al mismo instante; en un UPDATE difieren.
          // Es best-effort: un fallo de Inngest no debe romper el backfill — el pedido
          // quedó con geo_estado = 'pendiente' y el job barre por índice.
          if (filaPedido && filaPedido.creado_en === filaPedido.actualizado_en) {
            try {
              await inngest.send({
                name: 'operacion/pedido.ingestado',
                id: `pedido-ingestado-${filaPedido.id as string}`,
                data: {
                  pedidoId: filaPedido.id as string,
                  tenantId,
                  sellerId,
                  direccion: (filaPedido.destinatario_direccion as string | null) ?? 'Dirección pendiente',
                  comuna: (filaPedido.destinatario_comuna as string | null) ?? 'Santiago',
                  tipoPedido: 'flex' as const,
                },
              });
            } catch {
              // Evento best-effort. El pedido ya está en BD con geo_estado = 'pendiente'.
              // El job de geocoding lo procesará por barrido del índice idx_pedidos_geo_pendiente.
            }
          }
        }

        offset += orders.length;
        hayMas = offset < (paging?.total ?? 0);
      }

      if (totalOmitidosNoFlex > 0) {
        logger.info(
          `Backfill conexión ${conexionId}: ${totalOmitidosNoFlex} envíos omitidos ` +
            "por no ser Flex (self_service) — Full/Colecta/Agencia fuera de alcance.",
        );
      }

      // El accessToken sale de scope aquí.
      return totalProcesados;
    });

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
      ventanaRecortada: intentoBackfill.ventanaRecortada,
    };
  },
);
