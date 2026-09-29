/**
 * `resolverTarifa` / `resolverTarifaVigente` / `detectarPedidosSinTarifa`: el
 * envoltorio TypeScript de `identidad.resolver_tarifa_por_comuna`.
 *
 * La precedencia (seller > tenant, fuente > régimen > general, zona > sin zona)
 * la decide la función SQL y la prueba pgTAP (`identidad_resolver_tarifa.test.sql`).
 * Lo que se prueba acá es lo que SÍ vive en TypeScript: cómo se le habla al RPC
 * (comuna canónica, fuente nula, esquema) y cómo se interpreta la respuesta.
 */
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { detectarPedidosSinTarifa, resolverTarifa, resolverTarifaVigente } from "./tarifas";

function clienteRpc(respuesta: { data?: unknown; error?: { message: string } | null }) {
  const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({
    data: respuesta.data ?? null,
    error: respuesta.error ?? null,
  }));
  const schema = vi.fn(() => ({ rpc }));
  return { cliente: { schema } as unknown as SupabaseClient, rpc, schema };
}

const FILA = {
  tarifa_id: "t-1",
  zona_id: "z-1",
  zona_por_respaldo: true,
  por_seller: true,
  por_fuente: false,
  por_regimen: true,
  por_zona: true,
};

const ENTRADA = {
  tenantId: "tenant-1",
  sellerId: "seller-1",
  fuente: "ml_flex" as const,
  tipoPedido: "flex" as const,
  comuna: "nunoa",
  fecha: "2026-09-28",
};

describe("resolverTarifa", () => {
  it("llama al RPC del esquema identidad con la comuna CANÓNICA", async () => {
    const { cliente, rpc, schema } = clienteRpc({ data: [FILA] });

    await resolverTarifa(cliente, ENTRADA);

    expect(schema).toHaveBeenCalledWith("identidad");
    expect(rpc).toHaveBeenCalledWith("resolver_tarifa_por_comuna", {
      p_tenant: "tenant-1",
      p_seller: "seller-1",
      p_fuente: "ml_flex",
      p_tipo_pedido: "flex",
      p_comuna: "Ñuñoa",
      p_fecha: "2026-09-28",
    });
  });

  it("una comuna fuera del catálogo viaja como NULL (cae a la zona de respaldo), no como texto crudo", async () => {
    const { cliente, rpc } = clienteRpc({ data: [FILA] });

    await resolverTarifa(cliente, { ...ENTRADA, comuna: "Atlantis" });

    expect(rpc.mock.calls[0][1].p_comuna).toBeNull();
  });

  it("sin fuente conocida manda NULL: solo casan tarifas sin fuente", async () => {
    const { cliente, rpc } = clienteRpc({ data: [FILA] });

    await resolverTarifa(cliente, { ...ENTRADA, fuente: undefined });

    expect(rpc.mock.calls[0][1].p_fuente).toBeNull();
  });

  it("traduce la fila a camelCase, con el aviso de respaldo", async () => {
    const { cliente } = clienteRpc({ data: [FILA] });

    expect(await resolverTarifa(cliente, ENTRADA)).toEqual({
      tarifaId: "t-1",
      zonaId: "z-1",
      zonaPorRespaldo: true,
      porSeller: true,
      porFuente: false,
      porRegimen: true,
      porZona: true,
    });
  });

  it("sin tarifa devuelve tarifaId null PERO conserva la zona y el respaldo", async () => {
    const { cliente } = clienteRpc({ data: [{ ...FILA, tarifa_id: null }] });

    const r = await resolverTarifa(cliente, ENTRADA);

    expect(r.tarifaId).toBeNull();
    expect(r.zonaPorRespaldo).toBe(true);
  });

  it("un error de la base se LANZA: «no pude preguntar» no es «no hay tarifa»", async () => {
    const { cliente } = clienteRpc({ error: { message: "boom" } });

    await expect(resolverTarifa(cliente, ENTRADA)).rejects.toThrow(/boom/);
  });
});

describe("resolverTarifaVigente (envoltorio de id)", () => {
  const base = { tenantId: "tenant-1", sellerId: "seller-1", tipoEntrega: "same_day" as const, fecha: "2026-09-28" };

  it("devuelve solo el id", async () => {
    const { cliente } = clienteRpc({ data: [FILA] });
    expect(await resolverTarifaVigente(cliente, base)).toBe("t-1");
  });

  it("null cuando no hay tarifa", async () => {
    const { cliente } = clienteRpc({ data: [{ ...FILA, tarifa_id: null }] });
    expect(await resolverTarifaVigente(cliente, base)).toBeNull();
  });
});

describe("detectarPedidosSinTarifa", () => {
  it("resuelve por (seller, régimen, fuente, comuna): dos comunas del mismo seller pueden dar distinto", async () => {
    const rpc = vi.fn(async (_fn: string, args: Record<string, unknown>) => ({
      data: [{ ...FILA, tarifa_id: args.p_comuna === "Providencia" ? "t-1" : null }],
      error: null,
    }));
    const cliente = { schema: () => ({ rpc }) } as unknown as SupabaseClient;

    const sinTarifa = await detectarPedidosSinTarifa(cliente, { tenantId: "tenant-1", fecha: "2026-09-28" }, [
      { id: "p1", sellerId: "s1", tipoPedido: "flex", fuente: "ml_flex", comuna: "Providencia" },
      { id: "p2", sellerId: "s1", tipoPedido: "flex", fuente: "ml_flex", comuna: "Providencia" },
      { id: "p3", sellerId: "s1", tipoPedido: "flex", fuente: "ml_flex", comuna: "Maipú" },
    ]);

    expect([...sinTarifa]).toEqual(["p3"]);
    // Una consulta por combinación, no por pedido.
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("si la consulta falla NO marca «sin tarifa» (no inventa reparos)", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "caída" } }));
    const cliente = { schema: () => ({ rpc }) } as unknown as SupabaseClient;

    const sinTarifa = await detectarPedidosSinTarifa(cliente, { tenantId: "t", fecha: "2026-09-28" }, [
      { id: "p1", sellerId: "s1", tipoPedido: "flex" },
    ]);

    expect(sinTarifa.size).toBe(0);
  });
});
