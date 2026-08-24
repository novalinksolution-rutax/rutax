import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  contarComposicionPorLiquidacion,
  frasearRechazoDeBanco,
} from "./listado-liquidaciones";

function clienteFalso(filas: { liquidacion_id: string | null; tipo_hecho: string | null }[]) {
  const registro = { eq: [] as [string, unknown][] };
  let entregado = false;

  const chain: Record<string, unknown> = {
    eq: (campo: string, valor: unknown) => {
      registro.eq.push([campo, valor]);
      return chain;
    },
    in: () => chain,
    range: () => chain,
    then: (resolve: (r: { data: unknown[]; error: null }) => void) => {
      const data = entregado ? [] : filas;
      entregado = true;
      resolve({ data, error: null });
    },
  };

  const cliente = {
    schema: () => ({ from: () => ({ select: () => chain }) }),
  } as unknown as SupabaseClient;

  return { cliente, registro };
}

describe("contarComposicionPorLiquidacion", () => {
  it("no consulta nada sin liquidaciones", async () => {
    const { cliente, registro } = clienteFalso([]);
    expect(await contarComposicionPorLiquidacion(cliente, "t1", [])).toEqual({});
    expect(registro.eq).toEqual([]);
  });

  it("separa entregas de visitas a bodega", async () => {
    // Es la razón de ser del módulo: `liquidaciones.total_entregas` cuenta una
    // sola de las dos clases de línea, y desde la etapa 8 al conductor también
    // se le paga por visitar la bodega del seller.
    const { cliente } = clienteFalso([
      { liquidacion_id: "l1", tipo_hecho: "entrega" },
      { liquidacion_id: "l1", tipo_hecho: "entrega" },
      { liquidacion_id: "l1", tipo_hecho: "retiro_bodega" },
      { liquidacion_id: "l2", tipo_hecho: "retiro_bodega" },
    ]);
    const r = await contarComposicionPorLiquidacion(cliente, "t1", ["l1", "l2"]);
    expect(r).toEqual({
      l1: { entregas: 2, visitas: 1 },
      l2: { entregas: 0, visitas: 1 },
    });
  });

  it("una línea sin `tipo_hecho` cuenta como entrega, no se pierde", async () => {
    // Las líneas anteriores a la etapa 8 pueden no traerlo. Descartarlas dejaría
    // una composición más chica que el neto de la fila.
    const { cliente } = clienteFalso([{ liquidacion_id: "l1", tipo_hecho: null }]);
    expect(await contarComposicionPorLiquidacion(cliente, "t1", ["l1"])).toEqual({
      l1: { entregas: 1, visitas: 0 },
    });
  });

  it("excluye las anuladas en la consulta", async () => {
    const { cliente, registro } = clienteFalso([]);
    await contarComposicionPorLiquidacion(cliente, "t1", ["l1"]);
    expect(registro.eq).toContainEqual(["anulada", false]);
  });
});

describe("frasearRechazoDeBanco", () => {
  it("conserva el texto del proveedor entero", () => {
    // No se traduce: `payouts_conductor` no guarda un código, y adivinar la
    // causa sobre una cadena que el proveedor puede cambiar es peor que
    // mostrarla.
    expect(frasearRechazoDeBanco("cuenta_no_existe")).toContain("cuenta_no_existe");
    expect(frasearRechazoDeBanco("cuenta_no_existe")).toContain("El banco lo rechazó");
  });

  it("sin motivo, lo dice en vez de inventar uno", () => {
    expect(frasearRechazoDeBanco(null)).toBe("El banco lo rechazó y no devolvió un motivo.");
    expect(frasearRechazoDeBanco("   ")).toBe("El banco lo rechazó y no devolvió un motivo.");
  });
});
