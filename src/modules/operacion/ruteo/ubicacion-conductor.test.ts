import { describe, expect, it } from "vitest";

import { ubicacionUsable } from "./ubicacion-conductor";

/** Plaza de Armas, Santiago. Una coordenada real del área de operación. */
const VALIDA = { lat: -33.4372, long: -70.6506 };

describe("ubicacionUsable — falla cerrado", () => {
  it("acepta dos números en rango", () => {
    expect(ubicacionUsable(VALIDA)).toEqual(VALIDA);
  });

  it("ignora campos de más en vez de rechazar el objeto", () => {
    // La app puede mandar precisión u otros datos; lo que importa es que no se
    // usen. Rechazar por un campo extra rompería el cliente en la próxima
    // versión sin ganar nada.
    expect(ubicacionUsable({ ...VALIDA, precisionM: 12 })).toEqual(VALIDA);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["un número suelto", -33.4372],
    ["un string", "-33.4372,-70.6506"],
    ["un array", [-33.4372, -70.6506]],
    ["sin long", { lat: -33.4372 }],
    ["long como texto", { lat: -33.4372, long: "-70.6506" }],
    ["NaN", { lat: NaN, long: -70.6506 }],
    ["Infinity", { lat: -33.4372, long: Infinity }],
    ["lat fuera de rango", { lat: -91, long: -70.6506 }],
    ["long fuera de rango", { lat: -33.4372, long: 181 }],
  ])("descarta %s y devuelve null", (_caso, valor) => {
    expect(ubicacionUsable(valor)).toBeNull();
  });

  it("🔴 descarta (0,0): es un GPS sin fijar, no una coordenada", () => {
    // Cae en el Atlántico frente a África. Aceptarlo desplazaría la secuencia
    // entera y nadie lo notaría hasta ver la primera parada a 9.000 km.
    expect(ubicacionUsable({ lat: 0, long: 0 })).toBeNull();
  });

  it("un 0 en un solo eje SÍ es válido: el ecuador y Greenwich existen", () => {
    // La barrera es contra el par (0,0), no contra el cero. Escribirla como
    // `!lat || !long` habría descartado los dos casos.
    expect(ubicacionUsable({ lat: 0, long: -70.6506 })).toEqual({ lat: 0, long: -70.6506 });
    expect(ubicacionUsable({ lat: -33.4372, long: 0 })).toEqual({ lat: -33.4372, long: 0 });
  });
});
