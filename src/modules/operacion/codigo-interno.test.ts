/**
 * Pruebas de `codigo-interno.ts`.
 *
 * Cubre:
 * 1. `formatearCodigoInterno` produce el patrón `RX-XXXX-XXXX`.
 * 2. `formatearCodigoInterno` lanza si no recibe exactamente 8 símbolos.
 * 3. `generarCodigoInterno` siempre cumple el patrón y usa solo el alfabeto
 *    Crockford (sin I, L, O, U).
 * 4. `esCodigoInternoValido` acepta el formato correcto y rechaza variantes
 *    inválidas (minúsculas, letras prohibidas, longitud incorrecta).
 */

import { describe, expect, it } from "vitest";
import {
  ALFABETO_CROCKFORD,
  formatearCodigoInterno,
  generarCodigoInterno,
  esCodigoInternoValido,
  PATRON_CODIGO_INTERNO,
} from "./codigo-interno";

describe("formatearCodigoInterno", () => {
  it("produce el patrón RX-XXXX-XXXX a partir de 8 símbolos", () => {
    expect(formatearCodigoInterno("7K2M9QP4")).toBe("RX-7K2M-9QP4");
  });

  it("lanza si recibe menos de 8 símbolos", () => {
    expect(() => formatearCodigoInterno("ABC")).toThrow();
  });

  it("lanza si recibe más de 8 símbolos", () => {
    expect(() => formatearCodigoInterno("ABCDEFGHI")).toThrow();
  });
});

describe("generarCodigoInterno", () => {
  it("cumple el patrón RX-XXXX-XXXX", () => {
    for (let i = 0; i < 50; i++) {
      const codigo = generarCodigoInterno();
      expect(codigo).toMatch(PATRON_CODIGO_INTERNO);
    }
  });

  it("usa únicamente símbolos del alfabeto Crockford (sin I, L, O, U)", () => {
    for (let i = 0; i < 50; i++) {
      const codigo = generarCodigoInterno();
      const simbolos = codigo.replace(/^RX-/, "").replace("-", "");
      for (const simbolo of simbolos) {
        expect(ALFABETO_CROCKFORD).toContain(simbolo);
      }
      expect(simbolos).not.toMatch(/[ILOU]/i);
    }
  });

  it("genera códigos distintos entre llamadas (no determinista)", () => {
    const codigos = new Set(Array.from({ length: 20 }, () => generarCodigoInterno()));
    // Con ~40 bits de entropía, 20 muestras no deberían colisionar en la práctica.
    expect(codigos.size).toBe(20);
  });
});

describe("esCodigoInternoValido", () => {
  it("acepta un código bien formado", () => {
    expect(esCodigoInternoValido("RX-7K2M-9QP4")).toBe(true);
  });

  it("rechaza minúsculas", () => {
    expect(esCodigoInternoValido("rx-7k2m-9qp4")).toBe(false);
  });

  it("rechaza letras prohibidas del alfabeto (I, L, O, U)", () => {
    expect(esCodigoInternoValido("RX-ILOU-9QP4")).toBe(false);
  });

  it("rechaza longitud incorrecta", () => {
    expect(esCodigoInternoValido("RX-7K2-9QP4")).toBe(false);
    expect(esCodigoInternoValido("RX-7K2MX-9QP4")).toBe(false);
  });

  it("rechaza formato sin prefijo o guiones", () => {
    expect(esCodigoInternoValido("7K2M9QP4")).toBe(false);
    expect(esCodigoInternoValido("RX7K2M9QP4")).toBe(false);
  });
});
