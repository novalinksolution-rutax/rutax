import { describe, expect, it } from "vitest";
import { resolverAlcanceTarifa } from "./alcance-tarifa";

describe("resolverAlcanceTarifa", () => {
  it("el formulario actual (solo tipo_entrega) sigue creando tarifas legadas", () => {
    expect(resolverAlcanceTarifa("flex", null)).toEqual({ ok: true, tipoEntrega: "flex", fuente: null });
    expect(resolverAlcanceTarifa("same_day", "")).toEqual({ ok: true, tipoEntrega: "same_day", fuente: null });
  });

  it("por plataforma deja tipo_entrega en NULL (el CHECK impide ambas)", () => {
    expect(resolverAlcanceTarifa(null, "shopify")).toEqual({ ok: true, tipoEntrega: null, fuente: "shopify" });
  });

  it("«todas» es la tarifa general: ambas columnas NULL", () => {
    expect(resolverAlcanceTarifa(null, "todas")).toEqual({ ok: true, tipoEntrega: null, fuente: null });
  });

  it("rechaza plataforma desconocida, tipo inválido y la combinación de las dos", () => {
    expect(resolverAlcanceTarifa(null, "falabella").ok).toBe(false);
    expect(resolverAlcanceTarifa("otro", null).ok).toBe(false);
    expect(resolverAlcanceTarifa(null, null).ok).toBe(false);
    expect(resolverAlcanceTarifa("flex", "ml_flex").ok).toBe(false);
  });
});
