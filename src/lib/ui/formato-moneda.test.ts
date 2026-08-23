/**
 * El negativo: la parte que `Intl` no resuelve.
 *
 * `Intl.NumberFormat("es-CL", {style:"currency"})` devuelve `$-1.000` — el
 * guion entre el símbolo y la cifra, donde no se lee como signo, y encima es un
 * guion (U+002D) y no un signo menos. La regla 20 pide signo menos real
 * (U+2212), delante, nunca un paréntesis contable ni solo color.
 */

import { describe, expect, it } from "vitest";

import { formatearCLP, formatearCLPOGuion, formatearMiles } from "./formato-moneda";

const MENOS = "\u2212";

describe("formatearCLP · el signo del negativo", () => {
  it("pone signo menos REAL delante del símbolo, no un guion adentro", () => {
    expect(formatearCLP(-1000)).toBe(`${MENOS}$1.000`);
    // Lo que hacía antes, y que no debe volver:
    expect(formatearCLP(-1000)).not.toContain("$-");
  });

  it("no usa el guion U+002D en ninguna parte", () => {
    expect(formatearCLP(-8000)).not.toContain("-");
  });

  it("nunca usa paréntesis contable", () => {
    expect(formatearCLP(-8000)).not.toContain("(");
  });

  it("el positivo y el cero no cambian", () => {
    expect(formatearCLP(1500)).toBe("$1.500");
    expect(formatearCLP(0)).toBe("$0");
  });

  it("−0 se muestra como cero, no como «menos cero»", () => {
    // Math.round(-0.4) es -0, y `-0 < 0` es false, así que cae al camino
    // positivo. Se fija acá para que un refactor no lo cambie a `<= 0`.
    expect(formatearCLP(-0.4)).toBe("$0");
  });

  it("redondea antes de decidir el signo", () => {
    expect(formatearCLP(-1000.6)).toBe(`${MENOS}$1.001`);
  });

  it("`formatearCLPOGuion` hereda el signo, y el nulo sigue siendo raya", () => {
    expect(formatearCLPOGuion(-1000)).toBe(`${MENOS}$1.000`);
    expect(formatearCLPOGuion(null)).toBe("—");
    expect(formatearCLPOGuion(undefined)).toBe("—");
  });
});

describe("formatearMiles · sin símbolo, para el bloque de composición", () => {
  it("no lleva el símbolo: un `$` por sumando compite con la resta", () => {
    expect(formatearMiles(867000)).toBe("867.000");
    expect(formatearMiles(867000)).not.toContain("$");
  });
});
