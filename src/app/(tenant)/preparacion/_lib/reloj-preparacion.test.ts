import { describe, expect, it } from "vitest";
import {
  calcularConductoresNecesarios,
  MINUTOS_POR_PARADA,
} from "@/modules/operacion/retiro/expectativa";

describe("calcularConductoresNecesarios", () => {
  it("hace la cuenta del alcance: 12 min por parada contra la ventana que queda", () => {
    // 128 bultos × 12 min = 1536 min de trabajo. Con 300 min (5 h) hasta el
    // corte hacen falta ceil(1536/300) = 6 conductores.
    const r = calcularConductoresNecesarios(128, 300);
    expect(r.conductores).toBe(6);
    expect(r.aplicable).toBe(true);
    expect(MINUTOS_POR_PARADA).toBe(12);
  });

  it("redondea HACIA ARRIBA, siempre", () => {
    // 5,04 conductores no existen: con cinco no se alcanza.
    expect(calcularConductoresNecesarios(126, 300).conductores).toBe(6);
    expect(calcularConductoresNecesarios(125, 300).conductores).toBe(5);
  });

  it("deja de aplicar cuando ya pasó el corte", () => {
    // Con la ventana cerrada la fórmula dividiría por cero o por un negativo y
    // escupiría un número enorme o absurdo. Se declara no aplicable en vez de
    // mostrar «necesitas 4.000 conductores».
    const r = calcularConductoresNecesarios(128, 0);
    expect(r.aplicable).toBe(false);
    expect(r.conductores).toBe(0);

    expect(calcularConductoresNecesarios(128, -30).aplicable).toBe(false);
  });

  it("sin bultos no hay nada que estimar", () => {
    const r = calcularConductoresNecesarios(0, 300);
    expect(r.aplicable).toBe(false);
    expect(r.conductores).toBe(0);
  });
});
