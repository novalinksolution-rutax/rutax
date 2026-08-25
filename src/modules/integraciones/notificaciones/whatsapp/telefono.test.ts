/**
 * Pruebas de la normalización de teléfonos a E.164.
 *
 * Importan más de lo que parece: Meta ACEPTA un número mal formado y responde
 * 200. El mensaje no llega y no hay error que mirar. Estas pruebas son la única
 * barrera antes de ese silencio.
 */

import { describe, it, expect } from "vitest";
import { normalizarTelefonoE164, enmascararTelefono } from "./telefono";

describe("normalizarTelefonoE164 — formas en que la gente escribe un móvil chileno", () => {
  const equivalentes = [
    "+56 9 4709 5571",
    "56947095571",
    "947095571",
    "9 4709 5571",
    "(+56) 9-4709-5571",
    "+56-9-4709-5571",
    "0056947095571",
  ];

  for (const entrada of equivalentes) {
    it(`"${entrada}" → 56947095571`, () => {
      const resultado = normalizarTelefonoE164(entrada);
      expect(resultado.valido).toBe(true);
      if (resultado.valido) expect(resultado.telefonoE164).toBe("56947095571");
    });
  }
});

describe("normalizarTelefonoE164 — el error que costaría caro", () => {
  it("NO le antepone 56 a un número que ya lo trae", () => {
    // El bug obvio: anteponer el código de país a ciegas produce 5656912345678,
    // un número que Meta acepta y que no existe.
    const resultado = normalizarTelefonoE164("56912345678");
    expect(resultado.valido).toBe(true);
    if (resultado.valido) expect(resultado.telefonoE164).toBe("56912345678");
  });

  it("respeta un número internacional que ya trae su código", () => {
    const resultado = normalizarTelefonoE164("+1 415 555 0132");
    expect(resultado.valido).toBe(true);
    if (resultado.valido) expect(resultado.telefonoE164).toBe("14155550132");
  });

  it("acepta un fijo chileno de 9 dígitos", () => {
    const resultado = normalizarTelefonoE164("2 2345 6789");
    expect(resultado.valido).toBe(true);
    if (resultado.valido) expect(resultado.telefonoE164).toBe("56223456789");
  });
});

describe("normalizarTelefonoE164 — rechazos", () => {
  it.each([
    ["", "vacio"],
    ["   ", "vacio"],
    ["sin números", "sin_digitos"],
    ["1234", "demasiado_corto"],
    ["1234567890123456789", "demasiado_largo"],
    ["000000", "formato"],
  ])('"%s" se rechaza con motivo %s', (entrada, motivo) => {
    const resultado = normalizarTelefonoE164(entrada);
    expect(resultado.valido).toBe(false);
    if (!resultado.valido) expect(resultado.motivo).toBe(motivo);
  });

  it("null y undefined no lanzan", () => {
    expect(normalizarTelefonoE164(null).valido).toBe(false);
    expect(normalizarTelefonoE164(undefined).valido).toBe(false);
  });

  it("el motivo NUNCA incluye el número — termina en logs y respuestas HTTP", () => {
    const resultado = normalizarTelefonoE164("1234");
    expect(resultado.valido).toBe(false);
    expect(JSON.stringify(resultado)).not.toContain("1234");
  });
});

describe("enmascararTelefono", () => {
  it("deja ver el prefijo y los últimos cuatro de un móvil chileno", () => {
    expect(enmascararTelefono("56947095571")).toBe("+56 9 **** 5571");
  });

  it("nunca devuelve los dígitos del medio", () => {
    expect(enmascararTelefono("56947095571")).not.toContain("4709");
  });

  it("no lanza con basura", () => {
    expect(enmascararTelefono("nada")).toBe("número inválido");
  });
});
