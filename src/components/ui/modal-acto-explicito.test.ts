import { describe, expect, it } from "vitest";

/**
 * La regla del gate de la escalera de fricción, aislada del render.
 *
 * POR QUÉ EXISTE
 * ---------------------------------------------------------------------------
 * La primera versión daba por lista la confirmación cuando el peldaño era 3
 * pero **no venía la frase**: `!confirmacion` devolvía `true` y el botón quedaba
 * habilitado sin escribir nada.
 *
 * No era hipotético. El pago a conductor arma su frase con el monto líquido, y
 * ese monto puede venir nulo mientras la verificación previa todavía responde.
 * O sea: la ceremonia más cara del producto —la única que saca plata del banco—
 * se saltaba sola justo en la ventana en que aún no se sabe cuánto se va a
 * transferir.
 *
 * La regla ahora **falla cerrado**: si alguien pide peldaño 3, tiene que dar la
 * frase. La condición se replica acá tal cual la aplica el componente.
 */

const MINIMO_MOTIVO = 5;

function gateListo(opciones: {
  peldano: 1 | 2 | 3;
  motivo?: { valor: string; minimo?: number };
  confirmacion?: { frase: string };
  escrito: string;
}): boolean {
  const { peldano, motivo, confirmacion, escrito } = opciones;
  const minimoMotivo = motivo?.minimo ?? MINIMO_MOTIVO;
  const motivoListo = peldano < 2 || !motivo || motivo.valor.trim().length >= minimoMotivo;
  const frase = confirmacion?.frase?.trim() ?? "";
  const confirmacionLista = peldano < 3 || (frase.length > 0 && escrito.trim() === frase);
  return motivoListo && confirmacionLista;
}

describe("escalera de fricción · el gate", () => {
  it("peldaño 1: la consecuencia escrita basta", () => {
    expect(gateListo({ peldano: 1, escrito: "" })).toBe(true);
  });

  it("peldaño 2: sin motivo suficiente no habilita", () => {
    expect(gateListo({ peldano: 2, motivo: { valor: "" }, escrito: "" })).toBe(false);
    expect(gateListo({ peldano: 2, motivo: { valor: "abc" }, escrito: "" })).toBe(false);
    expect(gateListo({ peldano: 2, motivo: { valor: "porque sí" }, escrito: "" })).toBe(true);
  });

  it("peldaño 2 respeta un mínimo propio, como el de las anulaciones", () => {
    const largo = { valor: "nueve car", minimo: 10 };
    expect(gateListo({ peldano: 2, motivo: largo, escrito: "" })).toBe(false);
    expect(
      gateListo({ peldano: 2, motivo: { valor: "diez chars", minimo: 10 }, escrito: "" }),
    ).toBe(true);
  });

  it("peldaño 3: la frase tiene que calzar exacta", () => {
    const c = { frase: "Vega Norte SpA" };
    expect(gateListo({ peldano: 3, confirmacion: c, escrito: "Vega" })).toBe(false);
    expect(gateListo({ peldano: 3, confirmacion: c, escrito: "Otro Seller" })).toBe(false);
    expect(gateListo({ peldano: 3, confirmacion: c, escrito: "Vega Norte SpA" })).toBe(true);
  });

  it("peldaño 3 tolera espacios de sobra, que no son el error que ataja", () => {
    expect(
      gateListo({ peldano: 3, confirmacion: { frase: "Vega Norte SpA" }, escrito: "  Vega Norte SpA  " }),
    ).toBe(true);
  });

  it("FALLA CERRADO: peldaño 3 sin frase NO habilita", () => {
    // El caso real: el pago arma su frase con el monto líquido, y ese monto
    // puede venir nulo mientras la verificación previa responde.
    expect(gateListo({ peldano: 3, escrito: "" })).toBe(false);
    expect(gateListo({ peldano: 3, escrito: "lo que sea" })).toBe(false);
  });

  it("peldaño 3 con motivo Y frase exige las dos cosas", () => {
    const base = { peldano: 3 as const, confirmacion: { frase: "323400" } };
    expect(gateListo({ ...base, motivo: { valor: "" }, escrito: "323400" })).toBe(false);
    expect(gateListo({ ...base, motivo: { valor: "porque sí" }, escrito: "323" })).toBe(false);
    expect(gateListo({ ...base, motivo: { valor: "porque sí" }, escrito: "323400" })).toBe(true);
  });

  it("una frase EN BLANCO tampoco es una frase", () => {
    // Se normalizaría a "" y calzaría con el campo vacío: un peldaño 3 que no
    // gatea nada. Falla cerrado igual que si no viniera.
    expect(gateListo({ peldano: 3, confirmacion: { frase: "   " }, escrito: "" })).toBe(false);
    expect(gateListo({ peldano: 3, confirmacion: { frase: "" }, escrito: "" })).toBe(false);
  });
});
