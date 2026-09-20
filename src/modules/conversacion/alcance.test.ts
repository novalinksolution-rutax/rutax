import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolverAlcanceDesdeContacto } from "./alcance";

type Fila = Record<string, unknown>;

/**
 * Doble minimalista: no filtra por `eq` (ese comportamiento ya lo ejercitan
 * las pruebas de `consultas/seller.test.ts`) — acá lo que importa es qué hace
 * `resolverAlcanceDesdeContacto` con 0, 1 o 2 filas.
 */
function clienteConContactos(filas: Fila[]) {
  const cliente = {
    schema: () => ({
      from: () => {
        const q = {
          select: () => q,
          eq: () => q,
          then(onFulfilled: (v: { data: Fila[]; error: null }) => unknown) {
            return Promise.resolve({ data: filas, error: null }).then(onFulfilled);
          },
        };
        return q;
      },
    }),
  } as unknown as SupabaseClient;
  return cliente;
}

describe("resolverAlcanceDesdeContacto — §5 y §5.1", () => {
  it("teléfono null (ilegible) → ilegible, sin tocar la base", async () => {
    const cliente = clienteConContactos([{ id: "c1", tenant_id: "t1", seller_id: "s1" }]);
    expect(await resolverAlcanceDesdeContacto(cliente, null)).toEqual({ resolucion: "ilegible" });
  });

  it("ningún contacto con consentimiento vigente → sin_contacto", async () => {
    const cliente = clienteConContactos([]);
    expect(await resolverAlcanceDesdeContacto(cliente, "56911112222")).toEqual({
      resolucion: "sin_contacto",
    });
  });

  it("un contacto → resuelto, con el par (tenantId, sellerId)", async () => {
    const cliente = clienteConContactos([{ id: "c1", tenant_id: "t1", seller_id: "s1" }]);
    const resultado = await resolverAlcanceDesdeContacto(cliente, "56911112222");
    expect(resultado.resolucion).toBe("resuelto");
    if (resultado.resolucion === "resuelto") {
      expect(resultado.alcance.tenantId).toBe("t1");
      expect(resultado.alcance.sellerId).toBe("s1");
      expect(resultado.contactoId).toBe("c1");
    }
  });

  it("§5.1 · más de un contacto → ambiguo, y NUNCA se elige uno al azar", async () => {
    const cliente = clienteConContactos([
      { id: "c1", tenant_id: "t1", seller_id: "s1" },
      { id: "c2", tenant_id: "t2", seller_id: "s2" },
    ]);
    expect(await resolverAlcanceDesdeContacto(cliente, "56911112222")).toEqual({
      resolucion: "ambiguo",
      contactos: 2,
    });
  });
});
