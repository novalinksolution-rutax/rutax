/**
 * Tests de la normalización de RUT del dominio de pagos.
 * Unitarios puros — sin I/O, sin mocks.
 */

import { describe, it, expect } from "vitest";
import { normalizarRut } from "./tipos";

describe("normalizarRut", () => {
  it("deja un RUT ya sin formato (como lo entrega Fintoc) tal cual en mayúscula", () => {
    expect(normalizarRut("745931278")).toBe("745931278");
  });

  it("quita puntos y guion de un RUT con formato", () => {
    expect(normalizarRut("74.593.127-8")).toBe("745931278");
  });

  it("normaliza el dígito verificador K a mayúscula", () => {
    expect(normalizarRut("12345678-k")).toBe("12345678K");
    expect(normalizarRut("12.345.678-K")).toBe("12345678K");
  });

  it("ignora espacios", () => {
    expect(normalizarRut("  74593127 8 ")).toBe("745931278");
  });

  it("devuelve null para null/undefined (no inventa un RUT)", () => {
    expect(normalizarRut(null)).toBeNull();
    expect(normalizarRut(undefined)).toBeNull();
  });

  it("devuelve null para cadenas vacías o demasiado cortas", () => {
    expect(normalizarRut("")).toBeNull();
    expect(normalizarRut("-")).toBeNull();
    expect(normalizarRut("7")).toBeNull();
  });
});
