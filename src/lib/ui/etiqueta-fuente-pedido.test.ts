import { describe, it, expect } from "vitest";
import { referenciaTiendaDePedido } from "./etiqueta-fuente-pedido";

describe("referenciaTiendaDePedido — lo que imprime la etiqueta junto al código", () => {
  it("un pedido de Shopify se nombra con la tienda y su número", () => {
    expect(referenciaTiendaDePedido("shopify", "#1001")).toBe("Shopify #1001");
  });

  it("el pedido propio no lleva referencia: no hay otra tienda que nombrar", () => {
    expect(referenciaTiendaDePedido("rutax_manual", "PED-44")).toBeNull();
  });

  it("sin referencia o sin fuente no inventa nada", () => {
    expect(referenciaTiendaDePedido("shopify", null)).toBeNull();
    expect(referenciaTiendaDePedido("shopify", "   ")).toBeNull();
    expect(referenciaTiendaDePedido(null, "#1001")).toBeNull();
  });
});
