import { describe, expect, it } from "vitest";
import { clasificarResultado, idsQueSiguenSeleccionados, type ResultadoAsignacionEnBloque } from "./resultado";
import type { PedidoSeleccionado } from "./seleccion";

function foto(pedidoId: string, over: Partial<PedidoSeleccionado> = {}): PedidoSeleccionado {
  return {
    pedidoId,
    codigoVisible: `COD-${pedidoId}`,
    comuna: "Las Condes",
    sellerNombre: "Ana Muñoz SpA",
    estado: "pendiente_asignacion",
    conductorActualId: null,
    conductorActualNombre: null,
    ...over,
  };
}

function resultadoBase(over: Partial<ResultadoAsignacionEnBloque> = {}): ResultadoAsignacionEnBloque {
  return {
    manifiestoId: "manifiesto-1",
    manifiestoCreado: false,
    totalSolicitados: 0,
    totalAsignados: 0,
    totalReasignados: 0,
    totalOmitidos: 0,
    omitidos: [],
    ...over,
  };
}

describe("clasificarResultado", () => {
  it("sin omisiones: huboOmisiones = false y los dos baldes quedan vacíos", () => {
    const resultado = resultadoBase({ totalSolicitados: 30, totalAsignados: 30, totalOmitidos: 0 });
    const clasificado = clasificarResultado(resultado, new Map());

    expect(clasificado.huboOmisiones).toBe(false);
    expect(clasificado.totalQuedaronCon).toBe(30);
    expect(clasificado.yaEnManifiesto).toEqual([]);
    expect(clasificado.noSePudoAsignar).toEqual([]);
  });

  it("totalQuedaronCon suma asignados Y reasignados — la sub-línea es composición, no un extra", () => {
    const resultado = resultadoBase({ totalAsignados: 3, totalReasignados: 5 });
    const clasificado = clasificarResultado(resultado, new Map());
    expect(clasificado.totalQuedaronCon).toBe(8);
    expect(clasificado.totalReasignadosDesdeOtro).toBe(5);
  });

  it("separa ya_estaba_en_manifiesto (neutro) de no_retirado/estado_no_asignable (ámbar) — nunca el mismo balde", () => {
    const fotos = new Map([
      ["p-ya", foto("p-ya", { comuna: "Las Condes" })],
      ["p-no-retirado", foto("p-no-retirado", { comuna: "Providencia" })],
      ["p-estado", foto("p-estado", { comuna: "Ñuñoa" })],
    ]);
    const resultado = resultadoBase({
      totalAsignados: 8,
      totalOmitidos: 3,
      omitidos: [
        { pedidoId: "p-ya", motivo: "ya_estaba_en_manifiesto" },
        { pedidoId: "p-no-retirado", motivo: "no_retirado" },
        { pedidoId: "p-estado", motivo: "estado_no_asignable" },
      ],
    });

    const clasificado = clasificarResultado(resultado, fotos);

    expect(clasificado.huboOmisiones).toBe(true);
    expect(clasificado.yaEnManifiesto).toEqual([{ pedidoId: "p-ya", codigoVisible: "COD-p-ya", comuna: "Las Condes" }]);
    expect(clasificado.noSePudoAsignar).toEqual([
      { pedidoId: "p-no-retirado", codigoVisible: "COD-p-no-retirado", comuna: "Providencia", motivo: "no_retirado" },
      { pedidoId: "p-estado", codigoVisible: "COD-p-estado", comuna: "Ñuñoa", motivo: "estado_no_asignable" },
    ]);
  });

  it("trata 'ajeno' como parte del balde ámbar 'no se pudo asignar' (decisión de esta etapa — no está en la tabla del §7.5)", () => {
    const resultado = resultadoBase({
      totalOmitidos: 1,
      omitidos: [{ pedidoId: "p-ajeno", motivo: "ajeno" }],
    });
    const clasificado = clasificarResultado(resultado, new Map());
    expect(clasificado.noSePudoAsignar).toEqual([
      { pedidoId: "p-ajeno", codigoVisible: "p-ajeno", motivo: "ajeno", comuna: null },
    ]);
  });

  it("si la foto no está disponible (selección ya depurada), cae al pedidoId como código visible en vez de dejar la fila en blanco", () => {
    const resultado = resultadoBase({
      totalOmitidos: 1,
      omitidos: [{ pedidoId: "huerfano-123", motivo: "no_retirado" }],
    });
    const clasificado = clasificarResultado(resultado, new Map());
    expect(clasificado.noSePudoAsignar[0].codigoVisible).toBe("huerfano-123");
    expect(clasificado.noSePudoAsignar[0].comuna).toBeNull();
  });
});

describe("idsQueSiguenSeleccionados — §7.5 'qué pasa con la selección al cerrar'", () => {
  it("los que terminaron bien (sin omisión) no aparecen — ya no están en `omitidos`", () => {
    const resultado = resultadoBase({ totalAsignados: 5, totalOmitidos: 0 });
    expect(idsQueSiguenSeleccionados(resultado)).toEqual(new Set());
  });

  it("ya_estaba_en_manifiesto SALE de la selección — es un éxito, no algo por resolver", () => {
    const resultado = resultadoBase({
      totalOmitidos: 1,
      omitidos: [{ pedidoId: "p1", motivo: "ya_estaba_en_manifiesto" }],
    });
    expect(idsQueSiguenSeleccionados(resultado)).toEqual(new Set());
  });

  it("no_retirado, estado_no_asignable y ajeno SE QUEDAN seleccionados", () => {
    const resultado = resultadoBase({
      totalOmitidos: 3,
      omitidos: [
        { pedidoId: "p1", motivo: "no_retirado" },
        { pedidoId: "p2", motivo: "estado_no_asignable" },
        { pedidoId: "p3", motivo: "ajeno" },
      ],
    });
    expect(idsQueSiguenSeleccionados(resultado)).toEqual(new Set(["p1", "p2", "p3"]));
  });

  it("mezcla: solo los que de verdad fallaron sobreviven, ya_estaba_en_manifiesto se va con los exitosos", () => {
    const resultado = resultadoBase({
      totalOmitidos: 2,
      omitidos: [
        { pedidoId: "p-ok", motivo: "ya_estaba_en_manifiesto" },
        { pedidoId: "p-falla", motivo: "estado_no_asignable" },
      ],
    });
    expect(idsQueSiguenSeleccionados(resultado)).toEqual(new Set(["p-falla"]));
  });
});
