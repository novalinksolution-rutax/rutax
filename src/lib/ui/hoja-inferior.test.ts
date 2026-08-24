import { describe, expect, it } from "vitest";

import {
  ALTO_HOJA,
  altoDurante,
  destinoAlSoltar,
  FRACCION_ARRASTRE,
  VELOCIDAD_INTENCION,
} from "./hoja-inferior";

/** Un teléfono de referencia. */
const ALTO = 812;
const LEJOS = ALTO * FRACCION_ARRASTRE + 1;
const RAPIDO = VELOCIDAD_INTENCION + 0.1;

describe("un roce no mueve la hoja", () => {
  it("ni lento ni largo: se queda donde estaba", () => {
    // Es el dedo que apoya y suelta sin querer arrastrar. Mover la hoja ahí
    // sería castigar un toque involuntario.
    for (const punto of ["media", "completa"] as const) {
      expect(destinoAlSoltar({ punto, desplazamiento: 30, velocidad: 0.1, altoVentana: ALTO })).toBe(punto);
      expect(destinoAlSoltar({ punto, desplazamiento: -30, velocidad: -0.1, altoVentana: ALTO })).toBe(punto);
    }
  });
});

describe("un arrastre rápido vale por su intención, no por su distancia", () => {
  it("un tirón corto hacia arriba expande", () => {
    // 20 px es nada, pero el gesto fue inequívoco. Exigirle media pantalla
    // obliga a repetirlo.
    expect(
      destinoAlSoltar({ punto: "media", desplazamiento: -20, velocidad: -RAPIDO, altoVentana: ALTO }),
    ).toBe("completa");
  });

  it("un tirón corto hacia abajo desde media cierra", () => {
    expect(
      destinoAlSoltar({ punto: "media", desplazamiento: 20, velocidad: RAPIDO, altoVentana: ALTO }),
    ).toBe("cerrar");
  });
});

describe("un arrastre lento manda por su distancia", () => {
  it("recorrer un cuarto de la pantalla hacia arriba expande", () => {
    expect(
      destinoAlSoltar({ punto: "media", desplazamiento: -LEJOS, velocidad: -0.05, altoVentana: ALTO }),
    ).toBe("completa");
  });

  it("quedarse corto no mueve nada", () => {
    const casi = ALTO * FRACCION_ARRASTRE - 1;
    expect(
      destinoAlSoltar({ punto: "media", desplazamiento: -casi, velocidad: -0.05, altoVentana: ALTO }),
    ).toBe("media");
  });
});

describe("⚠️ cerrar cuesta más que volver a media", () => {
  it("desde completa, un tirón hacia abajo baja a media y NO cierra", () => {
    // Cerrar por accidente pierde el trabajo que hay dentro de la hoja;
    // quedarse en media no pierde nada. La asimetría es a propósito.
    expect(
      destinoAlSoltar({ punto: "completa", desplazamiento: 200, velocidad: RAPIDO, altoVentana: ALTO }),
    ).toBe("media");
  });

  it("desde completa, ni un arrastre larguísimo cierra de una", () => {
    expect(
      destinoAlSoltar({ punto: "completa", desplazamiento: ALTO, velocidad: 2, altoVentana: ALTO }),
    ).toBe("media");
  });

  it("desde media sí cierra: hacen falta dos gestos para salir de completa", () => {
    expect(
      destinoAlSoltar({ punto: "media", desplazamiento: LEJOS, velocidad: 0.05, altoVentana: ALTO }),
    ).toBe("cerrar");
  });
});

describe("el alto mientras el dedo arrastra", () => {
  it("sin desplazamiento es el del punto", () => {
    expect(altoDurante({ punto: "media", desplazamiento: 0, altoVentana: ALTO })).toBeCloseTo(
      ALTO * ALTO_HOJA.media,
    );
  });

  it("hacia arriba crece uno a uno hasta el tope", () => {
    const alto = altoDurante({ punto: "media", desplazamiento: -100, altoVentana: ALTO });
    expect(alto).toBeCloseTo(ALTO * ALTO_HOJA.media + 100);
  });

  it("⚠️ pasado el tope se resiste, en vez de quedarse clavada", () => {
    // Sin resistencia el dedo sigue subiendo y la hoja no se mueve: se lee como
    // que la aplicación se colgó. Con resistencia, «se estira» y avisa que ahí
    // termina.
    const tope = ALTO * ALTO_HOJA.completa;
    const excedida = altoDurante({ punto: "completa", desplazamiento: -300, altoVentana: ALTO });
    expect(excedida).toBeGreaterThan(tope);
    // Un tercio del exceso, no el exceso entero.
    expect(excedida).toBeCloseTo(tope + 100);
    expect(excedida).toBeLessThan(tope + 300);
  });

  it("hacia abajo no se resiste: ahí el gesto puede terminar en cerrar", () => {
    const alto = altoDurante({ punto: "media", desplazamiento: 200, altoVentana: ALTO });
    expect(alto).toBeCloseTo(ALTO * ALTO_HOJA.media - 200);
  });

  it("nunca devuelve un alto negativo", () => {
    expect(altoDurante({ punto: "media", desplazamiento: 5000, altoVentana: ALTO })).toBe(0);
  });
});

describe("los dos puntos", () => {
  it("completa NO llega a la pantalla entera", () => {
    // El resto asomando por arriba es lo que dice, sin una palabra, que esto es
    // una capa y no una pantalla nueva.
    expect(ALTO_HOJA.completa).toBeLessThan(1);
    expect(ALTO_HOJA.media).toBeLessThan(ALTO_HOJA.completa);
  });

  it("media deja ver lo de atrás", () => {
    // Es la razón de existir del punto medio: revisar sin perder de vista la
    // lista de la que se sacó lo que se está revisando.
    expect(ALTO_HOJA.media).toBeLessThan(0.7);
  });
});
