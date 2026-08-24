import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { listarEsperadosDeSeller } from "./expectativa";

/**
 * El denominador de la visita de retiro.
 *
 * Lo que se prueba acá no es la aritmética —es un `count`— sino **los criterios**,
 * que tienen que ser exactamente los mismos que usa `obtenerExpectativaDelDia`
 * para el panel del coordinador. Si los dos contaran distinto, el conductor y su
 * jefe verían cifras que no cuadran justo cuando hay que decidir si el bulto que
 * falta se busca o se da por perdido.
 */
type FilaPedido = { id: string; ml_shipment_id: string | null; codigo_interno: string | null };

function clienteConteo(respuesta: { filas?: FilaPedido[]; error?: { message: string } }) {
  const filtros: Array<[string, string, unknown]> = [];
  const cliente = {
    schema: () => ({
      from: () => {
        const q = {
          select: () => q,
          eq: (col: string, val: unknown) => {
            filtros.push(["eq", col, val]);
            return q;
          },
          neq: (col: string, val: unknown) => {
            filtros.push(["neq", col, val]);
            return q;
          },
          range: () =>
            Promise.resolve({ data: respuesta.filas ?? [], error: respuesta.error ?? null }),
        };
        return q;
      },
    }),
  } as unknown as SupabaseClient;
  return { cliente, filtros };
}

const N = (n: number): FilaPedido[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    ml_shipment_id: `447607888${String(i).padStart(2, "0")}`,
    codigo_interno: null,
  }));

describe("contarEsperadosDeSeller", () => {
  const entrada = { tenantId: "t1", sellerId: "s1", fecha: "2026-08-24" };

  it("lista los bultos del seller para esa fecha", async () => {
    const { cliente } = clienteConteo({ filas: N(42) });
    expect(await listarEsperadosDeSeller(cliente, entrada)).toHaveLength(42);
  });

  it("devuelve la LISTA, no un conteo: al cerrar con faltantes hay que nombrarlos", async () => {
    // «Vas a cerrar con 4 sin escanear» sin decir cuáles manda al conductor a
    // recorrer la bodega entera de nuevo.
    const { cliente } = clienteConteo({
      filas: [{ id: "p1", ml_shipment_id: "44760788897", codigo_interno: null }],
    });
    expect(await listarEsperadosDeSeller(cliente, entrada)).toEqual([
      { pedidoId: "p1", codigoVisible: "44760788897" },
    ]);
  });

  it("el código visible cae al interno cuando no hay envío de ML", async () => {
    // Mismo orden de preferencia que `construirDtoPedidoRetiro`. Si acá saliera
    // distinto, el cruce contra lo escaneado fallaría y un mismo bulto figuraría
    // a la vez como escaneado y como faltante.
    const { cliente } = clienteConteo({
      filas: [{ id: "p2", ml_shipment_id: null, codigo_interno: "RX-AB12-CD34" }],
    });
    expect((await listarEsperadosDeSeller(cliente, entrada))[0].codigoVisible).toBe("RX-AB12-CD34");
  });

  it("filtra por tenant, seller y fecha de compromiso", async () => {
    const { cliente, filtros } = clienteConteo({ filas: N(42) });
    await listarEsperadosDeSeller(cliente, entrada);
    expect(filtros).toContainEqual(["eq", "tenant_id", "t1"]);
    expect(filtros).toContainEqual(["eq", "seller_id", "s1"]);
    expect(filtros).toContainEqual(["eq", "fecha_compromiso", "2026-08-24"]);
  });

  it("deja fuera los `no_procesado`, igual que el panel del coordinador", async () => {
    // Son los que se decidió NO retirar. Contarlos haría que el denominador no
    // se alcance nunca, y el conductor cerraría todas sus actas con faltantes.
    const { cliente, filtros } = clienteConteo({ filas: N(42) });
    await listarEsperadosDeSeller(cliente, entrada);
    expect(filtros).toContainEqual(["neq", "situacion_retiro", "no_procesado"]);
  });

  it("NO filtra por «todavía no retirado»: es un denominador, no una cola", async () => {
    // Si contara solo lo pendiente, cada bulto escaneado bajaría el denominador
    // al mismo tiempo que sube el numerador y la fracción diría «38 de 4».
    const { cliente, filtros } = clienteConteo({ filas: N(42) });
    await listarEsperadosDeSeller(cliente, entrada);
    // El único filtro de exclusión es el de `no_procesado`. Cualquier otro
    // —«retirado_en is null», «situacion_retiro = pendiente»— convertiría el
    // denominador en una cola.
    expect(filtros.filter(([op]) => op === "neq")).toEqual([
      ["neq", "situacion_retiro", "no_procesado"],
    ]);
    expect(filtros.some(([, col]) => col === "retirado_en")).toBe(false);
  });

  it("un error se propaga: una lista vacía silenciosa vacía la bodega", async () => {
    // Con la lista vacía el conductor se va creyendo que no hay nada que retirar.
    const { cliente } = clienteConteo({ error: { message: "boom" } });
    await expect(listarEsperadosDeSeller(cliente, entrada)).rejects.toThrow(/boom/);
  });

  it("vacío es un valor legítimo: este seller no despacha hoy", async () => {
    const { cliente } = clienteConteo({ filas: [] });
    expect(await listarEsperadosDeSeller(cliente, entrada)).toEqual([]);
  });
});
