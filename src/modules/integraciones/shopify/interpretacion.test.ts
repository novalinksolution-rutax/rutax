/**
 * Interpretación de órdenes de Shopify.
 *
 * El foco está en el contenido sucio, no en el esquema: Shopify garantiza que
 * los campos existan, pero la dirección la escribe el comprador en un formulario
 * libre y ahí es donde esto se rompe en producción.
 */

import { describe, it, expect } from "vitest";
import {
  interpretarOrden,
  componerDireccion,
  componerNombreDestinatario,
  cumpleFiltroEtiqueta,
} from "./interpretacion";
import type { OrdenShopify } from "./tipos";

function orden(sobrescribe: Partial<OrdenShopify> = {}): OrdenShopify {
  return {
    id: "gid://shopify/Order/1234567890",
    name: "#1001",
    createdAt: "2026-08-16T12:00:00Z",
    displayFulfillmentStatus: "UNFULFILLED",
    tags: [],
    shippingAddress: {
      name: "Ana María Torres",
      address1: "Av. Providencia 1234",
      address2: "Dpto 52",
      city: "Providencia",
      province: "Región Metropolitana",
      phone: "+56911112222",
    },
    ...sobrescribe,
  };
}

describe("componerDireccion", () => {
  it("junta calle y complemento con coma", () => {
    expect(componerDireccion("Av. Providencia 1234", "Dpto 52")).toBe(
      "Av. Providencia 1234, Dpto 52",
    );
  });

  it("no deja la coma colgando cuando falta el complemento", () => {
    expect(componerDireccion("Av. Providencia 1234", null)).toBe("Av. Providencia 1234");
    expect(componerDireccion("Av. Providencia 1234", "   ")).toBe("Av. Providencia 1234");
  });
});

describe("componerNombreDestinatario", () => {
  it("prefiere `name`", () => {
    expect(componerNombreDestinatario(orden())).toBe("Ana María Torres");
  });

  it("cae a firstName + lastName cuando la tienda no manda `name`", () => {
    const o = orden({
      shippingAddress: { name: null, firstName: "Luis", lastName: "Campos", address1: "x", city: "Ñuñoa" },
    });
    expect(componerNombreDestinatario(o)).toBe("Luis Campos");
  });

  it("nunca devuelve cadena vacía", () => {
    const o = orden({ shippingAddress: { address1: "x", city: "Ñuñoa" } });
    expect(componerNombreDestinatario(o)).toBe("Destinatario pendiente");
  });
});

describe("cumpleFiltroEtiqueta", () => {
  it("sin filtro configurado pasan todas", () => {
    expect(cumpleFiltroEtiqueta(orden({ tags: [] }), null)).toBe(true);
    expect(cumpleFiltroEtiqueta(orden({ tags: [] }), "  ")).toBe(true);
  });

  it("compara sin distinguir mayúsculas ni espacios — el tag lo teclea una persona", () => {
    expect(cumpleFiltroEtiqueta(orden({ tags: ["Rutax"] }), "rutax")).toBe(true);
    expect(cumpleFiltroEtiqueta(orden({ tags: [" rutax "] }), "RUTAX")).toBe(true);
  });

  it("descarta la orden que no lleva el tag", () => {
    expect(cumpleFiltroEtiqueta(orden({ tags: ["retiro-en-tienda"] }), "rutax")).toBe(false);
    expect(cumpleFiltroEtiqueta(orden({ tags: null }), "rutax")).toBe(false);
  });
});

describe("interpretarOrden — qué entra y qué no", () => {
  it("una orden normal entra con sus datos mapeados", () => {
    const r = interpretarOrden(orden(), null);
    expect(r.entra).toBe(true);
    if (!r.entra) return;
    expect(r.datos.idExterno).toBe("gid://shopify/Order/1234567890");
    expect(r.datos.referenciaExterna).toBe("#1001");
    expect(r.datos.destinatarioDireccion).toBe("Av. Providencia 1234, Dpto 52");
    expect(r.datos.destinatarioComuna).toBe("Providencia");
    expect(r.datos.comunaReconocida).toBe(true);
    expect(r.datos.destinatarioTelefono).toBe("+56911112222");
  });

  it("descarta la orden cancelada en la tienda", () => {
    const r = interpretarOrden(orden({ cancelledAt: "2026-08-16T13:00:00Z" }), null);
    expect(r).toEqual({ entra: false, motivo: "cancelada_en_tienda" });
  });

  it("descarta la orden ya despachada por el seller", () => {
    expect(interpretarOrden(orden({ displayFulfillmentStatus: "FULFILLED" }), null)).toEqual({
      entra: false,
      motivo: "ya_cumplida",
    });
  });

  it("descarta el despacho parcial: no sabemos qué bultos quedan", () => {
    // Rutax modela un pedido como UNA entrega, no como una lista de líneas. Ante
    // un despacho parcial no hay forma de saber qué queda por llevar, y una
    // parada de contenido indeterminado es peor que ninguna parada.
    // Además así la función pura coincide con el filtro `fulfillment_status:
    // unfulfilled` que se le manda a la API, que tampoco los devuelve: mientras
    // discreparan, esta rama era código muerto que aparentaba cobertura.
    expect(interpretarOrden(orden({ displayFulfillmentStatus: "PARTIALLY_FULFILLED" }), null)).toEqual({
      entra: false,
      motivo: "despacho_parcial",
    });
  });

  it("descarta cuando falta la calle o falta la comuna", () => {
    expect(
      interpretarOrden(orden({ shippingAddress: { city: "Providencia" } }), null),
    ).toEqual({ entra: false, motivo: "sin_direccion" });
    expect(
      interpretarOrden(orden({ shippingAddress: { address1: "Av. Siempre Viva 742" } }), null),
    ).toEqual({ entra: false, motivo: "sin_direccion" });
  });

  it("descarta cuando el seller usa filtro por tag y la orden no lo lleva", () => {
    expect(interpretarOrden(orden({ tags: ["otro"] }), "rutax")).toEqual({
      entra: false,
      motivo: "sin_etiqueta_requerida",
    });
  });

  // --- Lo que de verdad va a pasar en producción -----------------------------

  it("normaliza la comuna que el comprador escribió sin tilde ni mayúsculas", () => {
    const r = interpretarOrden(
      orden({ shippingAddress: { ...orden().shippingAddress, city: "nunoa" } }),
      null,
    );
    expect(r.entra).toBe(true);
    if (!r.entra) return;
    expect(r.datos.destinatarioComuna).toBe("Ñuñoa");
    expect(r.datos.comunaReconocida).toBe(true);
  });

  it("conserva el texto crudo cuando la comuna no calza, en vez de adivinar", () => {
    const r = interpretarOrden(
      orden({ shippingAddress: { ...orden().shippingAddress, city: "Santiago Centro" } }),
      null,
    );
    expect(r.entra).toBe(true);
    if (!r.entra) return;
    // No se convierte en "Santiago" ni en null: una comuna inventada manda al
    // conductor a otra parte. Se marca como no reconocida y decide el geocoder.
    expect(r.datos.destinatarioComuna).toBe("Santiago Centro");
    expect(r.datos.comunaReconocida).toBe(false);
  });

  it("toma el teléfono de la orden cuando la dirección no lo trae", () => {
    const r = interpretarOrden(
      orden({
        phone: "+56955556666",
        shippingAddress: { ...orden().shippingAddress, phone: null },
      }),
      null,
    );
    expect(r.entra).toBe(true);
    if (!r.entra) return;
    expect(r.datos.destinatarioTelefono).toBe("+56955556666");
  });

  it("aprovecha la coordenada de Shopify cuando viene, y no inventa una cuando no", () => {
    const con = interpretarOrden(
      orden({ shippingAddress: { ...orden().shippingAddress, latitude: -33.42, longitude: -70.61 } }),
      null,
    );
    expect(con.entra && con.datos.lat).toBe(-33.42);

    const sin = interpretarOrden(orden(), null);
    expect(sin.entra && sin.datos.lat).toBe(null);
    expect(sin.entra && sin.datos.long).toBe(null);
  });
});
