/**
 * Cumplimiento (Fulfillment) de un pedido en Shopify — la escritura de vuelta
 * al ENTREGAR, dirección OPUESTA a `ingesta-pedidos.ts` (Rutax → Shopify en
 * vez de Shopify → Rutax). Vive en su propio archivo porque usa MUTACIONES, no
 * queries de lectura, y porque tiene una regla de manejo de errores que la
 * ingesta no necesita: `peticionShopify` NO inspecciona `userErrors` a
 * propósito (ver su docstring) — es resultado de negocio, no de transporte, y
 * es este módulo el que decide qué significa cada uno.
 *
 * ---------------------------------------------------------------------------
 * CONTRATO CON LA ADMIN API DE SHOPIFY (verificado 2026-08-16 contra la doc
 * oficial: shopify.dev/docs/api/admin-graphql/2026-01 — mutations/fulfillmentCreate,
 * objects/FulfillmentOrder, objects/Order, inputs/FulfillmentInput)
 * ---------------------------------------------------------------------------
 * 1. La mutación se llama `fulfillmentCreate` (NO `fulfillmentCreateV2`: ese
 *    nombre quedó deprecado y retirado en versiones anteriores a 2026-01— usar
 *    el viejo produce un error de esquema que solo aparece contra una tienda
 *    real, exactamente la trampa que advierte la tarea).
 * 2. `fulfillmentCreate(fulfillment: FulfillmentInput!)` devuelve
 *    `fulfillmentCreatePayload { fulfillment { id status } userErrors { field
 *    message } }`. `userErrors` es SIEMPRE un arreglo (vacío si no hubo
 *    problema) — nunca `null`.
 * 3. `FulfillmentInput.lineItemsByFulfillmentOrder` es la vía correcta para
 *    "merchant-managed fulfillment orders" (scope
 *    `write_merchant_managed_fulfillment_orders`, ya otorgado — ver
 *    `tipos.ts`): un arreglo de `{ fulfillmentOrderId }`; SIN
 *    `fulfillmentOrderLineItems` cumple TODOS los ítems restantes de esa
 *    fulfillment order, que es exactamente lo que quiere un pedido same-day
 *    sin despacho parcial.
 * 4. Para resolver las fulfillment orders de un pedido: `Order.fulfillmentOrders`
 *    (conexión). `FulfillmentOrder.status` incluye, entre otros, `OPEN` y
 *    `CLOSED`/`CANCELLED` — los dos últimos son los que NO admiten un
 *    `fulfillmentCreate` nuevo (la tarea lo llama "ya cerrada").
 * 5. `order(id: ID!)` devuelve `null` cuando el id no existe EN ESA TIENDA —
 *    mismo comportamiento que documenta `ingesta-pedidos.ts` para `nodes(ids:)`
 *    en el repaso de cancelaciones. Se usa esa misma señal aquí para que el
 *    llamador (`jobs/marcar-cumplido-shopify.ts`) pueda probar la SIGUIENTE
 *    conexión del seller ante un seller con varias tiendas.
 */

import { peticionShopify } from "./cliente-http";

// =============================================================================
// Resolver las fulfillment orders de un pedido
// =============================================================================

export const CONSULTA_FULFILLMENT_ORDERS_PEDIDO = `
  query RutaxFulfillmentOrdersDelPedido($orderId: ID!) {
    order(id: $orderId) {
      id
      fulfillmentOrders(first: 10) {
        nodes {
          id
          status
        }
      }
    }
  }
`;

export interface FulfillmentOrderShopify {
  id: string;
  status: string;
}

/** Estados de una `FulfillmentOrder` que ya NO admiten un `fulfillmentCreate` nuevo. */
const ESTADOS_FULFILLMENT_ORDER_CERRADOS = new Set(["CLOSED", "CANCELLED"]);

/** ¿Esta fulfillment order todavía admite un `fulfillmentCreate`? */
export function estaAbierta(fo: FulfillmentOrderShopify): boolean {
  return !ESTADOS_FULFILLMENT_ORDER_CERRADOS.has(fo.status);
}

interface RespuestaFulfillmentOrdersPedido {
  order: { id: string; fulfillmentOrders: { nodes: FulfillmentOrderShopify[] } } | null;
}

/**
 * Resuelve las fulfillment orders de UN pedido en UNA tienda.
 *
 * Devuelve `null` si el pedido NO existe en esa tienda — la señal que usa el
 * llamador para saber que hay que probar la siguiente conexión del seller (un
 * seller puede tener varias tiendas Shopify conectadas al mismo courier).
 * Devuelve un arreglo (posiblemente vacío) si el pedido SÍ existe ahí.
 */
export async function obtenerFulfillmentOrdersPedido(entrada: {
  shopDomain: string;
  accessToken: string;
  idExternoPedido: string;
}): Promise<FulfillmentOrderShopify[] | null> {
  const data = await peticionShopify<RespuestaFulfillmentOrdersPedido>({
    shopDomain: entrada.shopDomain,
    accessToken: entrada.accessToken,
    consulta: CONSULTA_FULFILLMENT_ORDERS_PEDIDO,
    variables: { orderId: entrada.idExternoPedido },
  });

  if (!data.order) return null;
  return data.order.fulfillmentOrders?.nodes ?? [];
}

// =============================================================================
// Crear el cumplimiento con la info de tracking de Rutax
// =============================================================================

export const MUTACION_FULFILLMENT_CREATE = `
  mutation RutaxFulfillmentCreate($fulfillment: FulfillmentInput!) {
    fulfillmentCreate(fulfillment: $fulfillment) {
      fulfillment {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export interface DatosTrackingCumplimiento {
  /** `codigo_interno` del pedido (`RX-XXXX-XXXX`) — el número de seguimiento que ve el comprador. */
  numero: string;
  /** URL pública `/tracking/[token]` de Rutax. */
  url: string;
  compania: string;
}

interface UserErrorShopify {
  field?: string[] | null;
  message: string;
}

interface RespuestaFulfillmentCreate {
  fulfillmentCreate: {
    fulfillment: { id: string; status: string } | null;
    userErrors: UserErrorShopify[];
  };
}

/**
 * La mutación LLEGÓ a Shopify (HTTP 200, sin `errors` de transporte) pero fue
 * RECHAZADA por una regla de negocio (`userErrors`) — p. ej. la fulfillment
 * order cambió de estado entre que se leyó y se intentó cumplir, o el pedido
 * ya fue cumplido por otra vía (el propio merchant, la app de Shopify POS).
 *
 * DEFINITIVO, no transitorio: reintentar la MISMA mutación contra el MISMO
 * estado de Shopify produce el mismo rechazo. El llamador decide si insiste
 * (p. ej. releyendo el estado de la fulfillment order) o se rinde — nunca lo
 * cuenta como éxito.
 */
export class ErrorCumplimientoShopifyRechazado extends Error {
  readonly userErrors: UserErrorShopify[];
  constructor(userErrors: UserErrorShopify[]) {
    super(
      `Shopify rechazó el cumplimiento (userErrors): ${userErrors.map((e) => e.message).join("; ") || "sin detalle"}`,
    );
    this.name = "ErrorCumplimientoShopifyRechazado";
    this.userErrors = userErrors;
  }
}

/**
 * Crea el `Fulfillment` de una o más fulfillment orders del MISMO pedido, con
 * la información de tracking de Rutax. `notifyCustomer: true` es lo que
 * dispara la notificación nativa de Shopify al comprador — el efecto que este
 * job existe para producir.
 *
 * Sin `fulfillmentOrderLineItems` por fulfillment order: cumple TODOS los
 * ítems restantes de cada una — correcto para un pedido same-day sin despacho
 * parcial (la ingesta ya excluye `partially_fulfilled`, ver
 * `ingesta-pedidos.ts` §`construirFiltroOrdenes`).
 *
 * Lanza `ErrorCumplimientoShopifyRechazado` si `userErrors` viene con algo —
 * NUNCA se interpreta como éxito. Cualquier otro error (transporte, GraphQL de
 * sintaxis) sube tal cual desde `peticionShopify`.
 */
export async function crearCumplimientoConTracking(entrada: {
  shopDomain: string;
  accessToken: string;
  fulfillmentOrderIds: readonly string[];
  tracking: DatosTrackingCumplimiento;
}): Promise<{ fulfillmentId: string }> {
  const data = await peticionShopify<RespuestaFulfillmentCreate>({
    shopDomain: entrada.shopDomain,
    accessToken: entrada.accessToken,
    consulta: MUTACION_FULFILLMENT_CREATE,
    variables: {
      fulfillment: {
        lineItemsByFulfillmentOrder: entrada.fulfillmentOrderIds.map((fulfillmentOrderId) => ({
          fulfillmentOrderId,
        })),
        notifyCustomer: true,
        trackingInfo: {
          number: entrada.tracking.numero,
          url: entrada.tracking.url,
          company: entrada.tracking.compania,
        },
      },
    },
  });

  const { fulfillment, userErrors } = data.fulfillmentCreate;

  if (userErrors && userErrors.length > 0) {
    throw new ErrorCumplimientoShopifyRechazado(userErrors);
  }

  if (!fulfillment?.id) {
    throw new Error(
      "Shopify no devolvió `fulfillment` ni `userErrors` en fulfillmentCreate — respuesta inesperada.",
    );
  }

  return { fulfillmentId: fulfillment.id };
}
