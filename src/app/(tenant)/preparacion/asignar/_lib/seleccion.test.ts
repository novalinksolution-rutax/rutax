import { describe, expect, it } from "vitest";
import {
  agruparAdvertenciaReasignacion,
  agruparSeleccionPorComuna,
  contarFueraDeFiltro,
  fotoDeSeleccion,
  hayReasignacion,
  type PedidoSeleccionado,
} from "./seleccion";

function foto(over: Partial<PedidoSeleccionado> & { pedidoId: string }): PedidoSeleccionado {
  return {
    codigoVisible: `COD-${over.pedidoId}`,
    comuna: "Ñuñoa",
    sellerNombre: "Comercial Andes",
    estado: "pendiente_asignacion",
    conductorActualId: null,
    conductorActualNombre: null,
    ...over,
  };
}

describe("fotoDeSeleccion", () => {
  it("copia los siete campos de la foto desde la fila de la bandeja, y ninguno más", () => {
    const resultado = fotoDeSeleccion({
      pedidoId: "p1",
      codigoVisible: "44760788901",
      comuna: "Renca",
      sellerId: "seller-1",
      sellerNombre: "Full Import SpA",
      estado: "asignado",
      conductorActualId: "cond-1",
      conductorActualNombre: "Pedro Soto",
    });

    expect(resultado).toEqual({
      pedidoId: "p1",
      codigoVisible: "44760788901",
      comuna: "Renca",
      sellerNombre: "Full Import SpA",
      estado: "asignado",
      conductorActualId: "cond-1",
      conductorActualNombre: "Pedro Soto",
    });
    // `sellerId` no viaja a la foto — no lo necesita ninguna pantalla de esta etapa.
    expect(resultado).not.toHaveProperty("sellerId");
  });
});

describe("contarFueraDeFiltro", () => {
  it("cuenta solo los seleccionados que NO están en los ids visibles", () => {
    const seleccion = new Map([
      ["p1", foto({ pedidoId: "p1" })],
      ["p2", foto({ pedidoId: "p2" })],
      ["p3", foto({ pedidoId: "p3" })],
    ]);
    const visibles = new Set(["p1"]);
    expect(contarFueraDeFiltro(seleccion, visibles)).toBe(2);
  });

  it("devuelve 0 cuando toda la selección está visible", () => {
    const seleccion = new Map([["p1", foto({ pedidoId: "p1" })]]);
    expect(contarFueraDeFiltro(seleccion, new Set(["p1", "p2"]))).toBe(0);
  });

  it("devuelve 0 con selección vacía, sin importar lo visible", () => {
    expect(contarFueraDeFiltro(new Map(), new Set(["p1"]))).toBe(0);
  });
});

describe("agruparAdvertenciaReasignacion — el corazón del arreglo del bug (§6.1)", () => {
  it("vacío cuando nada está asignado (todo pendiente_asignacion)", () => {
    const seleccion = new Map([
      ["p1", foto({ pedidoId: "p1", estado: "pendiente_asignacion" })],
    ]);
    expect(agruparAdvertenciaReasignacion(seleccion, "cond-nuevo")).toEqual([]);
  });

  it("vacío cuando el asignado ya es del MISMO conductor elegido (no hay nada que mover)", () => {
    const seleccion = new Map([
      [
        "p1",
        foto({
          pedidoId: "p1",
          estado: "asignado",
          conductorActualId: "cond-elegido",
          conductorActualNombre: "Pedro Soto",
        }),
      ],
    ]);
    expect(agruparAdvertenciaReasignacion(seleccion, "cond-elegido")).toEqual([]);
  });

  it("agrupa por conductor de origen y NO depende de qué esté 'visible' — la selección ES la fuente", () => {
    // Simula exactamente el escenario de §6.1: estos pedidos fueron marcados
    // bajo OTRO filtro y ya no están en ninguna lista "renderizada". La
    // función igual los encuentra porque itera el Map, no una lista visible.
    const seleccion = new Map([
      [
        "p1",
        foto({
          pedidoId: "p1",
          estado: "asignado",
          conductorActualId: "cond-pedro",
          conductorActualNombre: "Pedro Soto",
        }),
      ],
      [
        "p2",
        foto({
          pedidoId: "p2",
          estado: "asignado",
          conductorActualId: "cond-maria",
          conductorActualNombre: "María Rojas",
        }),
      ],
      [
        "p3",
        foto({
          pedidoId: "p3",
          estado: "asignado",
          conductorActualId: "cond-maria",
          conductorActualNombre: "María Rojas",
        }),
      ],
      // No asignado: no debe aparecer en ningún grupo.
      ["p4", foto({ pedidoId: "p4", estado: "pendiente_asignacion" })],
    ]);

    const grupos = agruparAdvertenciaReasignacion(seleccion, "cond-diego");

    expect(grupos).toHaveLength(2);
    // Orden alfabético por nombre: María antes que Pedro.
    expect(grupos[0].conductorActualNombre).toBe("María Rojas");
    expect(grupos[0].pedidos.map((p) => p.pedidoId).sort()).toEqual(["p2", "p3"]);
    expect(grupos[1].conductorActualNombre).toBe("Pedro Soto");
    expect(grupos[1].pedidos.map((p) => p.pedidoId)).toEqual(["p1"]);
  });

  it("usa 'Conductor desconocido' si la foto no trae nombre (defensivo)", () => {
    const seleccion = new Map([
      [
        "p1",
        foto({
          pedidoId: "p1",
          estado: "asignado",
          conductorActualId: "cond-x",
          conductorActualNombre: null,
        }),
      ],
    ]);
    const grupos = agruparAdvertenciaReasignacion(seleccion, "cond-elegido");
    expect(grupos[0].conductorActualNombre).toBe("Conductor desconocido");
  });
});

describe("hayReasignacion", () => {
  it("refleja exactamente si agruparAdvertenciaReasignacion produjo algo", () => {
    const vacio = new Map<string, PedidoSeleccionado>();
    expect(hayReasignacion(vacio, "cond-1")).toBe(false);

    const conAsignado = new Map([
      [
        "p1",
        foto({ pedidoId: "p1", estado: "asignado", conductorActualId: "cond-otro", conductorActualNombre: "Otro" }),
      ],
    ]);
    expect(hayReasignacion(conAsignado, "cond-elegido")).toBe(true);
  });
});

describe("agruparSeleccionPorComuna", () => {
  it("agrupa alfabéticamente y deja 'sin comuna' al final", () => {
    const seleccion = new Map([
      ["p1", foto({ pedidoId: "p1", comuna: "Renca" })],
      ["p2", foto({ pedidoId: "p2", comuna: "Ñuñoa" })],
      ["p3", foto({ pedidoId: "p3", comuna: null })],
      ["p4", foto({ pedidoId: "p4", comuna: "Ñuñoa" })],
    ]);

    const grupos = agruparSeleccionPorComuna(seleccion);

    expect(grupos.map((g) => g.comuna)).toEqual(["Ñuñoa", "Renca", null]);
    expect(grupos[0].pedidos.map((p) => p.pedidoId)).toEqual(["p2", "p4"]);
  });

  it("omite el grupo 'sin comuna' si no hay ninguno", () => {
    const seleccion = new Map([["p1", foto({ pedidoId: "p1", comuna: "Renca" })]]);
    const grupos = agruparSeleccionPorComuna(seleccion);
    expect(grupos.some((g) => g.comuna === null)).toBe(false);
  });

  it("selección vacía produce lista vacía", () => {
    expect(agruparSeleccionPorComuna(new Map())).toEqual([]);
  });
});
