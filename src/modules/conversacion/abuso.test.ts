import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { excedeTopeDeAbuso, detectaBarridoDeCodigos, TOPE_CONSULTAS_POR_HORA, UMBRAL_INTENTOS_SIN_MATCH } from "./abuso";

function clienteConConteo(count: number) {
  const filtros: Array<[string, unknown]> = [];
  const cliente = {
    schema: () => ({
      from: () => {
        const q = {
          select: () => q,
          eq(col: string, val: unknown) {
            filtros.push([col, val]);
            return q;
          },
          gte: () => q,
          then(onFulfilled: (v: { count: number; error: null }) => unknown) {
            return Promise.resolve({ count, error: null }).then(onFulfilled);
          },
        };
        return q;
      },
    }),
  } as unknown as SupabaseClient;
  return { cliente, filtros };
}

describe("excedeTopeDeAbuso", () => {
  it("bajo el tope → false", async () => {
    const { cliente } = clienteConConteo(TOPE_CONSULTAS_POR_HORA - 1);
    expect(await excedeTopeDeAbuso(cliente, "c1")).toBe(false);
  });

  it("en el tope o por encima → true", async () => {
    const { cliente } = clienteConConteo(TOPE_CONSULTAS_POR_HORA);
    expect(await excedeTopeDeAbuso(cliente, "c1")).toBe(true);
  });

  it("filtra por el contacto correcto", async () => {
    const { cliente, filtros } = clienteConConteo(0);
    await excedeTopeDeAbuso(cliente, "contacto-x");
    expect(filtros).toContainEqual(["contacto_id", "contacto-x"]);
  });
});

describe("detectaBarridoDeCodigos", () => {
  it("bajo el umbral → false", async () => {
    const { cliente } = clienteConConteo(UMBRAL_INTENTOS_SIN_MATCH - 1);
    expect(await detectaBarridoDeCodigos(cliente, "c1")).toBe(false);
  });

  it("en el umbral → true (señal de barrido, corta el canal)", async () => {
    const { cliente } = clienteConConteo(UMBRAL_INTENTOS_SIN_MATCH);
    expect(await detectaBarridoDeCodigos(cliente, "c1")).toBe(true);
  });

  it("filtra por flex_manual SIN match — un match exitoso no cuenta", async () => {
    const { cliente, filtros } = clienteConConteo(0);
    await detectaBarridoDeCodigos(cliente, "c1");
    expect(filtros).toContainEqual(["clasificacion", "flex_manual"]);
    expect(filtros).toContainEqual(["hubo_match", false]);
  });
});
