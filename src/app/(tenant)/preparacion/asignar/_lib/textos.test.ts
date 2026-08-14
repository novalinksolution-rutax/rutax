import { describe, expect, it } from "vitest";
import {
  textoCabecera,
  textoExitoSinOmisiones,
  textoGrupoReasignacion,
  textoMotivoNoAsignado,
  textoNoSePudoAsignar,
  textoQuedaronCon,
  textoReasignadosDesdeOtro,
  textoSubLineaVeniaDeOtro,
  textoYaEstabaCon,
} from "./textos";

describe("textoCabecera", () => {
  it("plural en el caso general", () => {
    expect(textoCabecera(143, 66)).toBe("143 pedidos retirados · 66 sin asignar");
  });

  it("singular exacto en 1 pedido retirado, sin tocar el número de sin-asignar", () => {
    expect(textoCabecera(1, 0)).toBe("1 pedido retirado · 0 sin asignar");
  });

  it("plural también en 0", () => {
    expect(textoCabecera(0, 0)).toBe("0 pedidos retirados · 0 sin asignar");
  });
});

describe("textoExitoSinOmisiones", () => {
  it("plural en el caso general (ejemplo del documento)", () => {
    expect(textoExitoSinOmisiones(30, "Pedro Soto")).toBe("30 pedidos asignados a Pedro Soto");
  });

  it("singular exacto en 1", () => {
    expect(textoExitoSinOmisiones(1, "Pedro Soto")).toBe("1 pedido asignado a Pedro Soto");
  });
});

describe("textoSubLineaVeniaDeOtro", () => {
  it("plural del verbo en el caso general (ejemplo del documento)", () => {
    expect(textoSubLineaVeniaDeOtro(5)).toBe("5 de ellos venían de otro conductor.");
  });

  it("singular del verbo en 1", () => {
    expect(textoSubLineaVeniaDeOtro(1)).toBe("1 de ellos venía de otro conductor.");
  });
});

describe("textoQuedaronCon", () => {
  it("plural en el caso general (ejemplo del documento)", () => {
    expect(textoQuedaronCon(8, "Ana Muñoz")).toBe("8 pedidos quedaron con Ana Muñoz");
  });

  it("singular exacto en 1 — concuerda sustantivo Y verbo", () => {
    expect(textoQuedaronCon(1, "Ana Muñoz")).toBe("1 pedido quedó con Ana Muñoz");
  });
});

describe("textoReasignadosDesdeOtro", () => {
  it("plural en el caso general (ejemplo del documento)", () => {
    expect(textoReasignadosDesdeOtro(2)).toBe("2 reasignados desde otro conductor");
  });

  it("singular exacto en 1", () => {
    expect(textoReasignadosDesdeOtro(1)).toBe("1 reasignado desde otro conductor");
  });
});

describe("textoYaEstabaCon", () => {
  it("singular exacto en 1 (ejemplo del documento)", () => {
    expect(textoYaEstabaCon(1, "Ana Muñoz")).toBe("1 ya estaba con Ana Muñoz — no hizo falta cambiar nada");
  });

  it("plural en 2+", () => {
    expect(textoYaEstabaCon(3, "Ana Muñoz")).toBe("3 ya estaban con Ana Muñoz — no hizo falta cambiar nada");
  });
});

describe("textoNoSePudoAsignar", () => {
  it("singular exacto en 1 (ejemplo del documento)", () => {
    expect(textoNoSePudoAsignar(1)).toBe("1 no se pudo asignar");
  });

  it("plural en 2+", () => {
    expect(textoNoSePudoAsignar(2)).toBe("2 no se pudieron asignar");
  });
});

describe("textoMotivoNoAsignado", () => {
  it("los tres motivos tienen texto propio, sin caer a un genérico", () => {
    expect(textoMotivoNoAsignado("no_retirado")).toMatch(/retirado/);
    expect(textoMotivoNoAsignado("estado_no_asignable")).toMatch(/canceló/);
    expect(textoMotivoNoAsignado("ajeno")).toMatch(/disponible/);
  });
});

describe("textoGrupoReasignacion", () => {
  it("singular exacto en 1 pedido (ejemplo del documento)", () => {
    expect(textoGrupoReasignacion("Pedro Soto", 1)).toBe("Pedro Soto — 1 pedido");
  });

  it("plural en 2+ (ejemplo del documento)", () => {
    expect(textoGrupoReasignacion("María Rojas", 4)).toBe("María Rojas — 4 pedidos");
  });
});
