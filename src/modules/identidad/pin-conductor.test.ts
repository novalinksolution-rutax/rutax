import { describe, expect, it } from "vitest";

import { esPinValido, LARGO_PIN, rechazarPin, soloDigitosPin, TEXTO_RECHAZO } from "./pin-conductor";

/**
 * ⚠️ **Estos casos están duplicados a propósito** en
 * `Desktop/rutax-conductor/src/lib/pin-conductor.test.ts`.
 *
 * Son dos repos separados y no pueden compartir código, así que la única red
 * disponible es que **los dos lados fijen exactamente los mismos casos**: si
 * alguien relaja una regla en un repo y no en el otro, el conductor podría
 * elegir en la app un PIN que la web habría rechazado. Al cambiar algo acá, hay
 * que ir al gemelo.
 */
describe("el PIN del conductor", () => {
  it("se queda solo con dígitos y corta en seis", () => {
    expect(soloDigitosPin("4-8 2b6x19 7")).toBe("482619");
    expect(soloDigitosPin("48")).toBe("48");
  });

  it("rechaza el corto", () => {
    expect(rechazarPin("4826")).toBe("corto");
    expect(rechazarPin("")).toBe("corto");
  });

  it("rechaza todos iguales", () => {
    expect(rechazarPin("000000")).toBe("todos_iguales");
    expect(rechazarPin("777777")).toBe("todos_iguales");
  });

  it("rechaza los seguidos, para arriba y para abajo", () => {
    expect(rechazarPin("123456")).toBe("seguidos");
    expect(rechazarPin("456789")).toBe("seguidos");
    expect(rechazarPin("654321")).toBe("seguidos");
  });

  it("rechaza el patrón que se repite", () => {
    expect(rechazarPin("121212")).toBe("patron_repetido");
    expect(rechazarPin("123123")).toBe("patron_repetido");
  });

  it("acepta un PIN normal, incluida una fecha", () => {
    // A propósito NO se rechazan años ni fechas: cada regla extra empuja al
    // conductor a anotarlo en un papel dentro de la van.
    expect(rechazarPin("482619")).toBeNull();
    expect(rechazarPin("140592")).toBeNull();
    expect(rechazarPin("112233")).toBeNull();
    expect(esPinValido("482619")).toBe(true);
  });

  it("una contraseña de letras no es un PIN", () => {
    // El campo del conductor solo deja escribir números, pero la acción del
    // servidor no puede confiar en eso: un formulario se salta.
    expect(esPinValido("abcdef")).toBe(false);
    expect(esPinValido("Rutax2026")).toBe(false);
  });

  it("cada rechazo dice qué hacer, no solo qué está mal", () => {
    for (const [clave, texto] of Object.entries(TEXTO_RECHAZO)) {
      expect(texto.length, clave).toBeGreaterThan(15);
      expect(/inválido|incorrecto/i.test(texto), clave).toBe(false);
    }
  });

  it("la lista de rechazos saca 1.100 de un millón, y no debe crecer mucho más", () => {
    // Contado, no estimado: 10 de todos iguales + 10 de seguidos + 100 de
    // «xyxyxy» + 1.000 de «xyzxyz». Es el 0,11 % del espacio.
    //
    // El tope existe para que la lista no engorde: cada regla extra empuja al
    // conductor al papel en la guantera. Si esta prueba se pone roja, la pregunta
    // no es «subo el número», es «¿de verdad hace falta esta regla?».
    let rechazados = 0;
    for (let n = 0; n < 1_000_000; n += 1) {
      if (rechazarPin(String(n).padStart(LARGO_PIN, "0"))) rechazados += 1;
    }
    expect(rechazados).toBe(1100);
  });
});
