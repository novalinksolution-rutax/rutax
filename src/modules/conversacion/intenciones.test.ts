import { describe, it, expect } from "vitest";
import { determinarIntencion, TOPE_CODIGOS_POR_MENSAJE } from "./intenciones";

describe("determinarIntencion — varios códigos por mensaje", () => {
  it('"hola cómo estás" NO produce código — cae al menú (contraprueba)', () => {
    expect(determinarIntencion("hola cómo estás")).toEqual({ tipo: "menu" });
  });

  it("un solo código sigue funcionando (no se rompe con el cambio a arreglo)", () => {
    const intencion = determinarIntencion("RX-AB12-CD34");
    expect(intencion).toEqual({
      tipo: "consulta_pedido",
      codigos: [
        { clasificacion: "codigo_interno", identificador: { tipo: "codigo_interno", valor: "RX-AB12-CD34" } },
      ],
      sobrante: 0,
    });
  });

  it("dos códigos ⇒ los dos entran, sin sobrante", () => {
    const intencion = determinarIntencion("RX-AB12-CD34 y RX-EF56-GH78");
    expect(intencion.tipo).toBe("consulta_pedido");
    if (intencion.tipo !== "consulta_pedido") throw new Error("tipo inesperado");
    expect(intencion.codigos).toHaveLength(2);
    expect(intencion.sobrante).toBe(0);
  });

  it("exactamente 5 códigos ⇒ los 5 entran, sobrante 0", () => {
    const codigos = Array.from({ length: 5 }, (_, i) => `RX-AB${i}2-CD34`).join(" ");
    const intencion = determinarIntencion(codigos);
    expect(intencion.tipo).toBe("consulta_pedido");
    if (intencion.tipo !== "consulta_pedido") throw new Error("tipo inesperado");
    expect(intencion.codigos).toHaveLength(5);
    expect(intencion.sobrante).toBe(0);
  });

  it("más de 5 códigos ⇒ se responden los primeros 5 y el resto se cuenta, NUNCA se recorta en silencio", () => {
    const codigos = Array.from({ length: 8 }, (_, i) => `RX-AB${i}2-CD34`).join(" ");
    const intencion = determinarIntencion(codigos);
    expect(intencion.tipo).toBe("consulta_pedido");
    if (intencion.tipo !== "consulta_pedido") throw new Error("tipo inesperado");
    expect(intencion.codigos).toHaveLength(TOPE_CODIGOS_POR_MENSAJE);
    expect(intencion.sobrante).toBe(3);
  });

  it("códigos repetidos en el mismo mensaje se consultan cada uno (no se deduplican)", () => {
    const intencion = determinarIntencion("RX-AB12-CD34 RX-AB12-CD34");
    expect(intencion.tipo).toBe("consulta_pedido");
    if (intencion.tipo !== "consulta_pedido") throw new Error("tipo inesperado");
    expect(intencion.codigos).toHaveLength(2);
    expect(intencion.codigos[0]).toEqual(intencion.codigos[1]);
  });
});

describe("comando /pedido — la intención que evita el bucle", () => {
  it("«/pedido» NO cae al menú: el menú anuncia ese comando", () => {
    expect(determinarIntencion("/pedido").tipo).toBe("como_consultar");
    expect(determinarIntencion("pedido").tipo).toBe("como_consultar");
  });

  it("un código gana sobre la palabra: «pedido 44760788901» se consulta", () => {
    const intencion = determinarIntencion("pedido 44760788901");
    expect(intencion.tipo).toBe("consulta_pedido");
  });

  it("«/retiro» sigue mandando sobre la ayuda", () => {
    expect(determinarIntencion("/retiro").tipo).toBe("retiro_del_dia");
  });

  it("una frase larga con la palabra pedido NO dispara la ayuda", () => {
    expect(determinarIntencion("hola quiero saber de mi pedido de ayer por favor").tipo).toBe("menu");
  });
});
