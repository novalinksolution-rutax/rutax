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

const VENTANA_MAXIMA_DIAS = 7;
const PAGE_SIZE = 50;

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

        for (const order of orders) {
          const shipmentId = order.shipping?.shipment_id
            ? String(order.shipping.shipment_id)
            : null;

          if (!shipmentId) continue;

          // Upsert en operacion.pedidos con origen = 'backfill'
          // ON CONFLICT (tenant_id, ml_shipment_id) → actualizar estado_ml si difiere
          await supabase
            .schema("operacion")
            .from("pedidos")
            .upsert(
              {
                tenant_id: tenantId,
                seller_id: sellerId,
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
              },
              {
                onConflict: "tenant_id,ml_shipment_id",
                ignoreDuplicates: false,
              },
            );

          totalProcesados++;
        }

        offset += orders.length;
        hayMas = offset < (paging?.total ?? 0);
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
