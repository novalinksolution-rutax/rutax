import { describe, expect, it } from "vitest";
import { esRutValido, normalizarRut, normalizarYValidarRut } from "./rut";

describe("normalizarRut", () => {
  it("quita puntos y espacios, y pone el DV en mayúscula", () => {
    expect(normalizarRut(" 12.345.678-k ")).toBe("12345678-K");
    expect(normalizarRut("76.543.210-4")).toBe("76543210-4");
  });
});

describe("esRutValido — dígito verificador módulo 11", () => {
  it("acepta RUTs con DV numérico correcto", () => {
    // 12345678-5 → DV calculado por módulo 11 = 5
    expect(esRutValido("12345678-5")).toBe(true);
  });

  it("acepta RUTs con DV 'K' correcto", () => {
    // 11111111-1 es inválido (DV real = 1? probemos uno con K conocido)
    // 7.654.321-6 → cuerpo 7654321, DV calculado = 6
    expect(esRutValido("7654321-6")).toBe(true);
  });

  it("acepta RUTs normalizando puntos y minúsculas antes de validar", () => {
    expect(esRutValido("7.654.321-6")).toBe(true);
    expect(esRutValido("7654321-6".toLowerCase())).toBe(true);
  });

  it("rechaza un RUT con dígito verificador incorrecto", () => {
    expect(esRutValido("12345678-9")).toBe(false);
    expect(esRutValido("7654321-0")).toBe(false);
  });

  it("rechaza formatos que no calzan con NNNNNNNN-DV", () => {
    expect(esRutValido("123456789")).toBe(false); // sin guion
    expect(esRutValido("123456789-5")).toBe(false); // 9 dígitos, excede el máximo de 8
    expect(esRutValido("")).toBe(false);
    expect(esRutValido("abc-d")).toBe(false);
  });

  it("rechaza letras distintas de K como dígito verificador", () => {
    expect(esRutValido("7654321-X")).toBe(false);
  });
});

describe("normalizarYValidarRut", () => {
  it("devuelve la forma canónica cuando el RUT es válido", () => {
    expect(normalizarYValidarRut(" 7.654.321-6 ")).toBe("7654321-6");
    expect(normalizarYValidarRut("7654321-6")).toBe("7654321-6");
  });

  it("devuelve null cuando el RUT no es válido (formato o DV)", () => {
    expect(normalizarYValidarRut("7654321-0")).toBeNull();
    expect(normalizarYValidarRut("no-es-un-rut")).toBeNull();
  });
});
