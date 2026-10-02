import { describe, expect, it } from "vitest";

import { resumirPlataformas } from "./perfil-comercial";

const p = (fuentes: string[], otra: string | null = null) => ({
  enviosDiaRango: "100_300",
  conductoresRango: "1_5",
  fuentesPedidos: fuentes,
  fuenteOtra: otra,
});

describe("resumirPlataformas", () => {
  it("cuenta couriers por plataforma y ordena de más a menos", () => {
    const r = resumirPlataformas([p(["shopify", "mercado_libre_flex"]), p(["shopify"]), p(["vtex"])]);
    expect(r.respondieron).toBe(3);
    expect(r.plataformas[0]).toMatchObject({ valor: "shopify", couriers: 2 });
    expect(r.plataformas.find((x) => x.valor === "falabella")?.couriers).toBe(0);
    expect(r.plataformas.some((x) => x.valor === "otra")).toBe(false);
  });

  it("agrupa el texto libre sin distinguir mayúsculas ni espacios", () => {
    const r = resumirPlataformas([p(["otra"], "Bsale"), p(["otra"], " bsale "), p(["otra"], "Tiendanube")]);
    expect(r.otras).toEqual([
      { texto: "Bsale", couriers: 2 },
      { texto: "Tiendanube", couriers: 1 },
    ]);
  });

  it("sin respuestas devuelve ceros", () => {
    const r = resumirPlataformas([]);
    expect(r.respondieron).toBe(0);
    expect(r.otras).toEqual([]);
  });
});
