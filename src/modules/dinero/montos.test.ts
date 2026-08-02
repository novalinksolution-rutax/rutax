import { describe, it, expect } from "vitest";
import { montosDesdeNeto, TASA_IVA } from "./montos";

describe("montosDesdeNeto", () => {
  it("calcula IVA 19% y total bruto desde el neto", () => {
    expect(montosDesdeNeto(1000)).toEqual({ netoClp: 1000, ivaClp: 190, totalClp: 1190 });
    expect(montosDesdeNeto(2500)).toEqual({ netoClp: 2500, ivaClp: 475, totalClp: 2975 });
  });

  it("redondea el IVA a entero (medio hacia arriba)", () => {
    expect(montosDesdeNeto(105)).toEqual({ netoClp: 105, ivaClp: 20, totalClp: 125 }); // 19.95 → 20
    expect(montosDesdeNeto(3)).toEqual({ netoClp: 3, ivaClp: 1, totalClp: 4 }); // 0.57 → 1
  });

  it("neto 0 → todo 0", () => {
    expect(montosDesdeNeto(0)).toEqual({ netoClp: 0, ivaClp: 0, totalClp: 0 });
  });

  it("redondea entradas no enteras del neto", () => {
    expect(montosDesdeNeto(1000.4)).toEqual({ netoClp: 1000, ivaClp: 190, totalClp: 1190 });
  });

  it("expone la tasa general de IVA de Chile", () => {
    expect(TASA_IVA).toBe(0.19);
  });
});
