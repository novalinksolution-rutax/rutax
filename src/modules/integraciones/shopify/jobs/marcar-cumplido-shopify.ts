/**
 * Job · shopify/marcarCumplido
 * =============================================================================
 * Trigger: evento `operacion/pedido.estado-terminal`
 * (publicado por `operacion/pedidos.ts` — `actualizarEstadoPedido` — para todo
 * pedido que llega a un estado terminal, sin importar la fuente; ver el
 * comentario de `EventoPedidoEstadoTerminal` en `lib/inngest/eventos.ts`)
 *
 * QUÉ HACE: al entregar un pedido que vino de Shopify, crea el `Fulfillment`
 * en la tienda con la info de tracking de Rutax (número = `codigo_interno`,
 * URL = `/tracking/[token]` pública). Eso dispara la notificación NATIVA de
 * Shopify al comprador — Rutax no envía ningún correo propio para esto.
 *
 * NO-OP INMEDIATO (sin tocar BD ni red) salvo:
 *   - `fuente === 'shopify'` — cualquier otra fuente (ML, alta manual) no
 *     tiene nada que escribir de vuelta aquí.
 *   - `estadoNuevo` es de ENTREGA ('entregado' | 'entregado_manual'). Los
 *     demás estados terminales ('fallido' | 'devuelto' | 'cancelado') NO
 *     escriben nada en la tienda en esta v1 — qué significan allá (¿se
 *     re-abre la orden? ¿se cancela?) es una conversación aparte con el
 *     courier, no una decisión que este job deba inventar.
 *
 * MULTI-TIENDA (un seller puede tener varias tiendas Shopify conectadas al
 * mismo courier — schema 1:N, ver `identidad.conexiones_seller_shopify`): el
 * pedido NO guarda de qué conexión vino (ver `ingesta-pedidos.ts` — el INSERT
 * no persiste `shop_domain` ni `conexion_id`), así que este job prueba, EN
 * ORDEN, cada conexión activa del seller hasta encontrar la que reconoce el
 * `idExterno` del pedido (`order(id:)` devuelve `null` cuando el id no existe
 * en esa tienda). Es la MISMA ambigüedad, y la misma resolución, que ya
 * documenta el repaso de cancelaciones en `jobs/ingesta-pedidos-shopify.ts`
 * (`faseBRepasoCancelaciones`) — no es una limitación nueva de este archivo.
 *
 * SEGURIDAD: el Admin API token se descifra dentro del paso, se pasa por
 * parámetro y sale de scope; nunca a un log, a un error ni a un payload de
 * evento. La URL de tracking y el `codigo_interno` NO son secretos (viajan
 * impresos en la etiqueta y se comparten con el destinatario) — sí pueden ir
 * a bitácora.
 */

import { inngest } from "@/lib/inngest/cliente";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { resolverUrlBaseApp } from "@/modules/identidad/enlace-invitacion";
import type { EventoPedidoEstadoTerminal } from "@/lib/inngest/eventos";
import { obtenerAccessToken, obtenerConexionesPorSeller } from "../puerto";
import {
  crearCumplimientoConTracking,
  estaAbierta,
  obtenerFulfillmentOrdersPedido,
  ErrorCumplimientoShopifyRechazado,
  type FulfillmentOrderShopify,
} from "../cumplimiento";

/** Estados de entrega que SÍ disparan la escritura de vuelta. Los demás terminales son no-op en la v1. */
const ESTADOS_DE_ENTREGA: ReadonlySet<string> = new Set(["entregado", "entregado_manual"]);

interface PedidoParaCumplimiento {
  codigoInterno: string | null;
  trackingToken: string | null;
}

async function leerDatosDeTracking(
  pedidoId: string,
  tenantId: string,
): Promise<PedidoParaCumplimiento | null> {
  const supabase = crearClienteServiceRole();
  const { data, error } = await supabase
    .from("pedidos")
    .select("id, codigo_interno, tracking_token")
    .eq("id", pedidoId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) throw new Error(`Error al leer el pedido: ${error.message}`);
  if (!data) return null;

  return {
    codigoInterno: (data as { codigo_interno: string | null }).codigo_interno ?? null,
    trackingToken: (data as { tracking_token: string | null }).tracking_token ?? null,
  };
}

interface ConexionResuelta {
  conexionId: string;
  shopDomain: string;
  accessToken: string;
  fulfillmentOrdersAbiertas: FulfillmentOrderShopify[];
}

/**
 * Prueba, EN ORDEN, cada conexión activa del seller hasta encontrar la que
 * reconoce `idExternoPedido`. Ver el comentario "MULTI-TIENDA" de cabecera.
 *
 * Los errores de descifrado de token (conexión con credencial ilegible) se
 * SALTAN — igual que hace `sincronizarConexionShopify` — porque no dicen nada
 * sobre si ESE es el pedido de esa tienda. Cualquier otro error (red, GraphQL)
 * SUBE tal cual: no hay forma honesta de distinguir "esta tienda no es la
 * dueña" de "esta tienda es la dueña y su API está fallando", así que se
 * prefiere reintentar el job entero (Inngest, con backoff) antes que decidir
 * en silencio que el pedido no tiene tienda.
 */
async function resolverConexionDelPedido(
  tenantId: string,
  sellerId: string,
  idExternoPedido: string,
): Promise<ConexionResuelta | null> {
  const conexiones = (await obtenerConexionesPorSeller(tenantId, sellerId)).filter(
    (c) => c.activa && c.estadoSalud !== "desvinculada",
  );

  for (const conexion of conexiones) {
    let accessToken: string;
    try {
      accessToken = await obtenerAccessToken(conexion.id, tenantId);
    } catch {
      continue;
    }

    const fulfillmentOrders = await obtenerFulfillmentOrdersPedido({
      shopDomain: conexion.shopDomain,
      accessToken,
      idExternoPedido,
    });

    if (fulfillmentOrders === null) continue; // el pedido no es de ESTA tienda

    return {
      conexionId: conexion.id,
      shopDomain: conexion.shopDomain,
      accessToken,
      fulfillmentOrdersAbiertas: fulfillmentOrders.filter(estaAbierta),
    };
  }

  return null;
}

export const jobMarcarCumplidoShopify = inngest.createFunction(
  {
    id: "shopify/marcarCumplido",
    name: "Shopify · Marcar cumplimiento al entregar",
    triggers: [{ event: "operacion/pedido.estado-terminal" }],
    retries: 4,
  },
  async ({ event, step, logger }) => {
    const datos = event.data as EventoPedidoEstadoTerminal["data"];

    // --- No-op inmediato, sin tocar BD ni red ---------------------------------
    if (datos.fuente !== "shopify") {
      return { pedidoId: datos.pedidoId, resultado: "no_op_fuente_distinta" as const };
    }
    if (!ESTADOS_DE_ENTREGA.has(datos.estadoNuevo)) {
      return { pedidoId: datos.pedidoId, resultado: "no_op_estado_no_es_entrega" as const };
    }
    if (!datos.idExterno) {
      // Defensivo: todo pedido `fuente = 'shopify'` nace con `id_externo`
      // (ver `insertarPedidoShopify`). Si llegara sin él, no hay con qué
      // consultar la tienda — se registra y se termina sin reintento.
      logger.warn(
        `shopify/marcarCumplido: pedido ${datos.pedidoId} es fuente=shopify pero no trae idExterno — no se puede cumplir.`,
      );
      return { pedidoId: datos.pedidoId, resultado: "sin_id_externo" as const };
    }

    // --- Paso 1: datos propios del pedido (no viajan en el evento) -----------
    const pedido = await step.run("leer-pedido", () =>
      leerDatosDeTracking(datos.pedidoId, datos.tenantId),
    );

    if (!pedido) {
      logger.warn(
        `shopify/marcarCumplido: pedido ${datos.pedidoId} no existe en el tenant ${datos.tenantId} — nada que cumplir.`,
      );
      return { pedidoId: datos.pedidoId, resultado: "pedido_no_encontrado" as const };
    }
    if (!pedido.codigoInterno || !pedido.trackingToken) {
      logger.warn(
        `shopify/marcarCumplido: pedido ${datos.pedidoId} no tiene codigo_interno/tracking_token — no se puede armar el tracking.`,
      );
      return { pedidoId: datos.pedidoId, resultado: "sin_datos_de_tracking" as const };
    }

    const urlBase = resolverUrlBaseApp();
    if (!urlBase) {
      logger.warn(
        "shopify/marcarCumplido: no hay URL pública configurada (APP_PUBLIC_URL/APP_BASE_URL/NEXT_PUBLIC_APP_URL/VERCEL_URL) — no se puede armar la URL de tracking.",
      );
      return { pedidoId: datos.pedidoId, resultado: "sin_url_publica" as const };
    }
    const urlTracking = `${urlBase}/tracking/${pedido.trackingToken}`;

    // --- Paso 2: resolver la tienda dueña de este pedido + sus fulfillment orders ---
    const resolucion = await step.run("resolver-conexion", () =>
      resolverConexionDelPedido(datos.tenantId, datos.sellerId, datos.idExterno as string),
    );

    if (!resolucion) {
      logger.warn(
        `shopify/marcarCumplido: ninguna conexión activa del seller ${datos.sellerId} reconoció el pedido ` +
          `${datos.idExterno} — no se pudo resolver la tienda.`,
      );
      return { pedidoId: datos.pedidoId, resultado: "conexion_no_resuelta" as const };
    }

    // --- Comprobación: la fulfillment order no debe estar ya cerrada ---------
    // El pedido pudo cambiar en la tienda entre la entrega y la corrida del
    // job (otro canal lo cumplió, el merchant lo hizo a mano). Ninguna
    // fulfillment order abierta = nada que hacer, y NO es un error.
    if (resolucion.fulfillmentOrdersAbiertas.length === 0) {
      logger.info(
        `shopify/marcarCumplido: pedido ${datos.pedidoId} — todas sus fulfillment orders en ` +
          `${resolucion.shopDomain} ya estaban cerradas. No-op.`,
      );
      return { pedidoId: datos.pedidoId, resultado: "ya_cumplido_en_shopify" as const };
    }

    const fulfillmentOrderIds = resolucion.fulfillmentOrdersAbiertas.map((fo) => fo.id);

    // --- Paso 3: bitácora ANTES del efecto externo (CLAUDE.md), luego la mutación ---
    // No es una acción FINANCIERA, pero SÍ un efecto externo visible para el
    // comprador final (dispara su notificación de envío) — se audita igual.
    try {
      await step.run(`shopify-cumplido-${datos.pedidoId}`, async () => {
        const supabase = crearClienteServiceRole();
        await registrarEnBitacora(supabase, {
          tenantId: datos.tenantId,
          actorUsuarioId: null,
          actorTipo: "sistema",
          accion: "pedido.cumplimiento_notificado_shopify",
          entidadTipo: "pedido",
          entidadId: datos.pedidoId,
          detalle: {
            shop_domain: resolucion.shopDomain,
            id_externo: datos.idExterno,
            fulfillment_order_ids: fulfillmentOrderIds,
            codigo_interno: pedido.codigoInterno,
            url_tracking: urlTracking,
            estado_nuevo: datos.estadoNuevo,
          },
        });

        await crearCumplimientoConTracking({
          shopDomain: resolucion.shopDomain,
          accessToken: resolucion.accessToken,
          fulfillmentOrderIds,
          tracking: {
            numero: pedido.codigoInterno as string,
            url: urlTracking,
            compania: "Rutax",
          },
        });
      });
    } catch (error) {
      if (error instanceof ErrorCumplimientoShopifyRechazado) {
        // DEFINITIVO (ver el comentario de la clase): no se reintenta ni se
        // cuenta como éxito. Queda auditado (la bitácora de arriba ya se
        // escribió) y visible en el log del job para revisión humana.
        logger.warn(
          `shopify/marcarCumplido: Shopify rechazó el cumplimiento del pedido ${datos.pedidoId}: ${error.message}`,
        );
        return {
          pedidoId: datos.pedidoId,
          resultado: "rechazado_por_shopify" as const,
          userErrors: error.userErrors,
        };
      }
      // Cualquier otro error (red, GraphQL de sintaxis, límite de tasa
      // agotado) sube tal cual — dispara el reintento de Inngest.
      throw error;
    }

    logger.info(
      `shopify/marcarCumplido: pedido ${datos.pedidoId} cumplido en ${resolucion.shopDomain} ` +
        `(${fulfillmentOrderIds.length} fulfillment order(s)).`,
    );

    return { pedidoId: datos.pedidoId, resultado: "cumplido" as const, shopDomain: resolucion.shopDomain };
  },
);
