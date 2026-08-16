/**
 * Cumplimiento (Fulfillment) de un pedido en Shopify — la escritura de vuelta
 * al entregar.
 *
 * Cubre lo que `cliente-http.ts` deja a propósito sin resolver: los
 * `userErrors` de la mutación NO son inspeccionados por `peticionShopify` (son
 * resultado de negocio, no de transporte) — es este módulo el que decide, y
 * estas pruebas verifican que una mutación con `userErrors` JAMÁS se cuenta
 * como éxito.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  obtenerFulfillmentOrdersPedido,
  crearCumplimientoConTracking,
  estaAbierta,
  ErrorCumplimientoShopifyRechazado,
  type FulfillmentOrderShopify,
} from "./cumplimiento";

const TIENDA = "mi-tienda.myshopify.com";
const TOKEN = "shpat_falso";

function respuesta(cuerpo: unknown, init: { status?: number } = {}) {
  return new Response(JSON.stringify(cuerpo), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("estaAbierta", () => {
  it("una fulfillment order OPEN admite un fulfillmentCreate nuevo", () => {
    expect(estaAbierta({ id: "fo-1", status: "OPEN" })).toBe(true);
  });

  it("CLOSED y CANCELLED NO admiten un fulfillmentCreate nuevo", () => {
    expect(estaAbierta({ id: "fo-1", status: "CLOSED" })).toBe(false);
    expect(estaAbierta({ id: "fo-1", status: "CANCELLED" })).toBe(false);
  });
});

describe("obtenerFulfillmentOrdersPedido", () => {
  it("devuelve `null` cuando la orden no existe en esta tienda (pedido de otra tienda del mismo seller)", async () => {
    const fetchFalso = vi.fn().mockResolvedValue(respuesta({ data: { order: null } }));
    vi.stubGlobal("fetch", fetchFalso);

    const resultado = await obtenerFulfillmentOrdersPedido({
      shopDomain: TIENDA,
      accessToken: TOKEN,
      idExternoPedido: "gid://shopify/Order/1",
    });

    expect(resultado).toBeNull();
  });

  it("devuelve las fulfillment orders cuando la orden SÍ existe en esta tienda", async () => {
    const nodes: FulfillmentOrderShopify[] = [
      { id: "gid://shopify/FulfillmentOrder/1", status: "OPEN" },
      { id: "gid://shopify/FulfillmentOrder/2", status: "CLOSED" },
    ];
    const fetchFalso = vi.fn().mockResolvedValue(
      respuesta({ data: { order: { id: "gid://shopify/Order/1", fulfillmentOrders: { nodes } } } }),
    );
    vi.stubGlobal("fetch", fetchFalso);

    const resultado = await obtenerFulfillmentOrdersPedido({
      shopDomain: TIENDA,
      accessToken: TOKEN,
      idExternoPedido: "gid://shopify/Order/1",
    });

    expect(resultado).toEqual(nodes);
  });
});

describe("crearCumplimientoConTracking", () => {
  it("camino feliz: manda tracking con el codigo_interno y la URL de /tracking/, y devuelve el id del fulfillment", async () => {
    const fetchFalso = vi.fn().mockResolvedValue(
      respuesta({
        data: {
          fulfillmentCreate: {
            fulfillment: { id: "gid://shopify/Fulfillment/1", status: "SUCCESS" },
            userErrors: [],
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchFalso);

    const resultado = await crearCumplimientoConTracking({
      shopDomain: TIENDA,
      accessToken: TOKEN,
      fulfillmentOrderIds: ["gid://shopify/FulfillmentOrder/1"],
      tracking: {
        numero: "RX-AB12-CD34",
        url: "https://app.rutax.io/tracking/abc123",
        compania: "Rutax",
      },
    });

    expect(resultado).toEqual({ fulfillmentId: "gid://shopify/Fulfillment/1" });

    const body = JSON.parse((fetchFalso.mock.calls[0]![1] as { body: string }).body);
    expect(body.variables.fulfillment.trackingInfo).toEqual({
      number: "RX-AB12-CD34",
      url: "https://app.rutax.io/tracking/abc123",
      company: "Rutax",
    });
    expect(body.variables.fulfillment.lineItemsByFulfillmentOrder).toEqual([
      { fulfillmentOrderId: "gid://shopify/FulfillmentOrder/1" },
    ]);
    expect(body.variables.fulfillment.notifyCustomer).toBe(true);
  });

  it("varias fulfillment orders abiertas: las manda TODAS en la misma mutación", async () => {
    const fetchFalso = vi.fn().mockResolvedValue(
      respuesta({
        data: {
          fulfillmentCreate: {
            fulfillment: { id: "gid://shopify/Fulfillment/1", status: "SUCCESS" },
            userErrors: [],
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchFalso);

    await crearCumplimientoConTracking({
      shopDomain: TIENDA,
      accessToken: TOKEN,
      fulfillmentOrderIds: ["gid://shopify/FulfillmentOrder/1", "gid://shopify/FulfillmentOrder/2"],
      tracking: { numero: "RX-AB12-CD34", url: "https://app.rutax.io/tracking/abc123", compania: "Rutax" },
    });

    const body = JSON.parse((fetchFalso.mock.calls[0]![1] as { body: string }).body);
    expect(body.variables.fulfillment.lineItemsByFulfillmentOrder).toEqual([
      { fulfillmentOrderId: "gid://shopify/FulfillmentOrder/1" },
      { fulfillmentOrderId: "gid://shopify/FulfillmentOrder/2" },
    ]);
  });

  it("userErrors NO se cuenta como éxito — lanza ErrorCumplimientoShopifyRechazado", async () => {
    const fetchFalso = vi.fn().mockResolvedValue(
      respuesta({
        data: {
          fulfillmentCreate: {
            fulfillment: null,
            userErrors: [{ field: ["fulfillment"], message: "La fulfillment order ya fue cumplida." }],
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchFalso);

    await expect(
      crearCumplimientoConTracking({
        shopDomain: TIENDA,
        accessToken: TOKEN,
        fulfillmentOrderIds: ["gid://shopify/FulfillmentOrder/1"],
        tracking: { numero: "RX-AB12-CD34", url: "https://app.rutax.io/tracking/abc123", compania: "Rutax" },
      }),
    ).rejects.toBeInstanceOf(ErrorCumplimientoShopifyRechazado);
  });

  it("respuesta sin `fulfillment` ni `userErrors`: lanza (no asume éxito por defecto)", async () => {
    const fetchFalso = vi.fn().mockResolvedValue(
      respuesta({ data: { fulfillmentCreate: { fulfillment: null, userErrors: [] } } }),
    );
    vi.stubGlobal("fetch", fetchFalso);

    await expect(
      crearCumplimientoConTracking({
        shopDomain: TIENDA,
        accessToken: TOKEN,
        fulfillmentOrderIds: ["gid://shopify/FulfillmentOrder/1"],
        tracking: { numero: "RX-AB12-CD34", url: "https://app.rutax.io/tracking/abc123", compania: "Rutax" },
      }),
    ).rejects.toThrow();
  });
});
