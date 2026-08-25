import { describe, expect, it } from "vitest";

import { LARGO_MINIMO, medirFuerza } from "./fuerza-contrasena";

describe("medirFuerza", () => {
  it("con el campo vacío no dice nada", () => {
    // Un medidor que grita «Muy corta» antes de que escribas la primera letra
    // regaña por existir.
    expect(medirFuerza("")).toEqual({ nivel: "corta", etiqueta: null, pasos: 0 });
  });

  it("bajo el mínimo del servidor, lo dice", () => {
    expect(medirFuerza("abc123").etiqueta).toBe("Muy corta");
    expect(medirFuerza("a".repeat(LARGO_MINIMO - 1)).nivel).toBe("corta");
  });

  it("🔴 el largo pesa más que los símbolos, que es todo el punto", () => {
    // Una frase larga en minúsculas es MEJOR que un `Ab1!xY` corto, y el medidor
    // tiene que decirlo — si no, estaría empujando hacia la peor contraseña.
    const frase = medirFuerza("caballo verde en la bodega");
    const enrevesada = medirFuerza("Ab1!xYz9");
    expect(frase.pasos).toBeGreaterThan(enrevesada.pasos);
    expect(frase.nivel).toBe("excelente");
  });

  it("un carácter repetido no aprueba por ser largo", () => {
    // El caso que un medidor ingenuo aprueba con entusiasmo.
    expect(medirFuerza("aaaaaaaaaaaaaaaa").nivel).toBe("debil");
    expect(medirFuerza("ababababababab").nivel).toBe("debil");
  });

  it("la variedad separa buena de excelente, no rescata a una corta", () => {
    expect(medirFuerza("Xk9!zQ2m").nivel).toBe("buena");
    expect(medirFuerza("Xk9!zQ2mLp4#").nivel).toBe("excelente");
    // Corta con las cuatro clases sigue siendo corta: la variedad no la salva.
    expect(medirFuerza("Aa1!").nivel).toBe("corta");
  });

  it("doce caracteres bastan para «buena» aunque sean todos minúsculas", () => {
    expect(medirFuerza("bodegacentro").nivel).toBe("buena");
  });

  it("no revienta con nulo ni con emoji", () => {
    // @ts-expect-error — el campo llega del DOM y puede venir sin valor.
    expect(() => medirFuerza(null)).not.toThrow();
    expect(medirFuerza("🚚🚚🚚🚚🚚🚚🚚🚚🚚").nivel).toBe("debil");
  });
});
