/**
 * El popover «¿Por qué este monto?» tiene que leer snapshots v1 (ya escritos,
 * inmutables) y v2 (con fuente de tarifa y respaldo). Se prueban los helpers que
 * deciden qué se muestra; son los que cambian entre versiones.
 */
import { describe, expect, it } from "vitest";
import { alcanceDeTarifa, cobradaPorZonaDeRespaldo } from "./popover-snapshot-regla";

describe("alcanceDeTarifa", () => {
  it("v1: el régimen legado manda", () => {
    expect(alcanceDeTarifa({ tipo_entrega: "flex" })).toBe("Flex");
  });

  it("v2: tarifa por plataforma (tipo_entrega NULL) muestra la plataforma", () => {
    expect(alcanceDeTarifa({ tipo_entrega: null, fuente_pedido_tarifa: "shopify" })).toBe("Shopify");
  });

  it("v2: tarifa general (ninguna de las dos) no se rotula como «—»", () => {
    expect(alcanceDeTarifa({ tipo_entrega: null, fuente_pedido_tarifa: null })).toBe("General");
  });

  it("no revienta con un snapshot sin ninguna de las claves", () => {
    expect(alcanceDeTarifa({})).toBe("General");
  });
});

describe("cobradaPorZonaDeRespaldo", () => {
  it("solo true cuando el snapshot v2 lo dice", () => {
    expect(cobradaPorZonaDeRespaldo({ por_respaldo: true })).toBe(true);
    expect(cobradaPorZonaDeRespaldo({ por_respaldo: false })).toBe(false);
    expect(cobradaPorZonaDeRespaldo({ por_respaldo: null })).toBe(false);
  });

  it("v1 (sin la clave) y zona ausente → false", () => {
    expect(cobradaPorZonaDeRespaldo({ zona_id: "z" })).toBe(false);
    expect(cobradaPorZonaDeRespaldo(null)).toBe(false);
  });
});
