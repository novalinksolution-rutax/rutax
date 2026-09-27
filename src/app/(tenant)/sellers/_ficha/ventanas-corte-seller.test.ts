import { describe, expect, it } from "vitest";
import { sumarMinutos } from "./ventanas-corte-seller";

describe("sumarMinutos — la hora comprometida del formulario", () => {
  it("suma dentro del mismo día", () => {
    expect(sumarMinutos("14:00", 150)).toBe("16:30");
  });
  it("marca el día siguiente al pasar medianoche", () => {
    expect(sumarMinutos("21:00", 240)).toBe("01:00 del día siguiente");
  });
  it("una hora ilegible no inventa un resultado", () => {
    expect(sumarMinutos("", 30)).toBe("—");
  });
});
