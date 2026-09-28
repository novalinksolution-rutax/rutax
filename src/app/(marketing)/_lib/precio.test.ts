import { describe, expect, it } from "vitest";

import { costoMensual, MINIMO_MENSUAL_CLP } from "./precio";

describe("costoMensual — tramos graduados con mínimo", () => {
  it("reproduce los ejemplos aprobados por el usuario", () => {
    expect(costoMensual(1_500).total).toBe(180_000);
    expect(costoMensual(5_000).total).toBe(550_000);
    expect(costoMensual(15_000).total).toBe(1_400_000);
    expect(costoMensual(40_000).total).toBe(3_050_000);
  });

  it("es graduado: cruzar un tramo nunca abarata el mes", () => {
    // Con precio único por tramo alcanzado, 3.001 costaría 3.001 × 95 = 285.095, menos que 3.000.
    expect(costoMensual(3_000).total).toBe(360_000);
    expect(costoMensual(3_001).total).toBe(360_095);
    for (const borde of [3_000, 10_000, 25_000]) {
      expect(costoMensual(borde + 1).total).toBeGreaterThan(costoMensual(borde).total);
    }
  });

  it("cobra el mínimo cuando las entregas no lo alcanzan, y lo dice", () => {
    expect(costoMensual(400)).toMatchObject({ total: MINIMO_MENSUAL_CLP, aplicaMinimo: true });
    expect(costoMensual(0)).toMatchObject({ total: MINIMO_MENSUAL_CLP, aplicaMinimo: true, promedio: 0 });
    expect(costoMensual(500)).toMatchObject({ total: 60_000, aplicaMinimo: false });
  });

  it("el promedio por entrega baja con el volumen", () => {
    expect(costoMensual(5_000).promedio).toBe(110);
    expect(costoMensual(40_000).promedio).toBe(76.25);
  });
});
