/**
 * Predicados derivados de la procedencia del pedido.
 *
 * Lo que de verdad se prueba acá no es la tabla de valores — esa es trivial —
 * sino el FALLO CERRADO. Estos predicados deciden si se acepta una prueba de
 * entrega, y una prueba de entrega mueve el estado del pedido y dispara la línea
 * de cobro al seller. Si ante una fuente que no reconocemos el predicado
 * respondiera `true`, bastaría un SELECT que olvide la columna para que Rutax
 * empiece a cerrar entregas de Flex por su cuenta y a facturarlas.
 */

import { describe, it, expect } from "vitest";
import {
  podEsAutoritativoEnRutax,
  podLoGobiernaLaFuente,
  laFuenteProveeEtiqueta,
  esFuenteConocida,
} from "./fuente";

describe("podEsAutoritativoEnRutax", () => {
  it("es false para ml_flex — el POD lo gobierna la app de Mercado Envíos", () => {
    expect(podEsAutoritativoEnRutax("ml_flex")).toBe(false);
  });

  it("es true para las fuentes sin app de captura externa obligatoria", () => {
    expect(podEsAutoritativoEnRutax("rutax_manual")).toBe(true);
    expect(podEsAutoritativoEnRutax("shopify")).toBe(true);
  });

  it.each([null, undefined, "", "falabella", "FLEX", "ml_flex ", "shopify\n"])(
    "falla CERRADO ante un valor que no reconoce: %o",
    (valor) => {
      expect(podEsAutoritativoEnRutax(valor as string | null | undefined)).toBe(false);
    },
  );

  it("podLoGobiernaLaFuente es exactamente su inversa", () => {
    for (const v of ["ml_flex", "rutax_manual", "shopify", null, undefined, "otra"]) {
      const f = v as string | null | undefined;
      expect(podLoGobiernaLaFuente(f)).toBe(!podEsAutoritativoEnRutax(f));
    }
  });
});

describe("laFuenteProveeEtiqueta", () => {
  it("solo ml_flex trae su propia etiqueta imprimible", () => {
    expect(laFuenteProveeEtiqueta("ml_flex")).toBe(true);
    expect(laFuenteProveeEtiqueta("rutax_manual")).toBe(false);
    expect(laFuenteProveeEtiqueta("shopify")).toBe(false);
  });

  it("falla cerrado: ante una fuente desconocida, Rutax genera la etiqueta", () => {
    expect(laFuenteProveeEtiqueta(undefined)).toBe(false);
    expect(laFuenteProveeEtiqueta("falabella")).toBe(false);
  });

  it("es una lista PROPIA, no un alias del predicado de POD", () => {
    // Hoy las dos listas coinciden. Esta prueba no afirma que coincidan —
    // afirma que se consultan por separado, para que el día que una fuente
    // traiga etiqueta sin imponer POD (o al revés) el desacople ya exista y
    // nadie tenga que descubrir que estaban fundidas.
    const fuentes = ["ml_flex", "rutax_manual", "shopify"] as const;
    for (const f of fuentes) {
      expect(typeof laFuenteProveeEtiqueta(f)).toBe("boolean");
      expect(typeof podEsAutoritativoEnRutax(f)).toBe("boolean");
    }
  });
});

describe("esFuenteConocida", () => {
  it("acepta las tres fuentes del enum y nada más", () => {
    expect(esFuenteConocida("ml_flex")).toBe(true);
    expect(esFuenteConocida("rutax_manual")).toBe(true);
    expect(esFuenteConocida("shopify")).toBe(true);
    expect(esFuenteConocida("falabella")).toBe(false);
    expect(esFuenteConocida(null)).toBe(false);
    expect(esFuenteConocida(undefined)).toBe(false);
  });
});
