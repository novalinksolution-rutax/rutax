import { describe, it, expect, vi, beforeEach } from "vitest";

const orden: string[] = [];
const mocks = vi.hoisted(() => ({
  candidatas: { data: [] as unknown, error: null as null | { message: string } },
  cierre: { data: null as unknown, error: null as null | { message: string } },
  bitacora: [] as Record<string, unknown>[],
  rpc: [] as { nombre: string; args: Record<string, unknown> }[],
}));

vi.mock("./auditoria", () => ({
  registrarEnBitacora: vi.fn(async (_c: unknown, e: Record<string, unknown>) => {
    orden.push(`bitacora:${e.accion}`);
    mocks.bitacora.push(e);
  }),
}));

import { cerrarTarifasLegadasDelTenant, registrarLegadasPorCerrar } from "./tarifas-legadas";

const cliente = {
  schema: () => ({
    rpc: async (nombre: string, args: Record<string, unknown>) => {
      orden.push(`rpc:${nombre}`);
      mocks.rpc.push({ nombre, args });
      return nombre === "tarifas_legadas_del_tenant" ? mocks.candidatas : mocks.cierre;
    },
  }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const P = { tenantId: "t-1", actorUsuarioId: "u-1", hoy: "2026-09-29" };

beforeEach(() => {
  orden.length = 0;
  mocks.bitacora.length = 0;
  mocks.rpc.length = 0;
  mocks.candidatas = { data: ["l1", "l2"], error: null };
  mocks.cierre = {
    data: { hay_general: true, cerradas: ["l1"], inactivadas: ["l2"] },
    error: null,
  };
});

describe("cerrarTarifasLegadasDelTenant", () => {
  it("bitácora con autor y los ids ANTES de cerrar", async () => {
    const r = await cerrarTarifasLegadasDelTenant(cliente, P);
    expect(orden).toEqual([
      "rpc:tarifas_legadas_del_tenant",
      "bitacora:tarifa.legadas_cerradas",
      "rpc:cerrar_tarifas_legadas_del_tenant",
    ]);
    expect(mocks.bitacora[0]).toMatchObject({
      tenantId: "t-1",
      actorUsuarioId: "u-1",
      actorTipo: "usuario",
      detalle: { tarifa_ids: ["l1", "l2"] },
    });
    expect(mocks.rpc[1].args).toEqual({ p_tenant: "t-1", p_hoy: "2026-09-29" });
    expect(r).toEqual({ hayGeneral: true, cerradas: ["l1"], inactivadas: ["l2"] });
  });

  it("sin legadas no registra ni cierra", async () => {
    mocks.candidatas = { data: [], error: null };
    const r = await cerrarTarifasLegadasDelTenant(cliente, P);
    expect(orden).toEqual(["rpc:tarifas_legadas_del_tenant"]);
    expect(r.cerradas).toEqual([]);
  });

  it("si la bitácora falla no se cierra nada", async () => {
    const { registrarEnBitacora } = await import("./auditoria");
    vi.mocked(registrarEnBitacora).mockRejectedValueOnce(new Error("bitácora caída"));
    await expect(cerrarTarifasLegadasDelTenant(cliente, P)).rejects.toThrow("bitácora caída");
    expect(orden).not.toContain("rpc:cerrar_tarifas_legadas_del_tenant");
  });

  it("propaga el error del cierre", async () => {
    mocks.cierre = { data: null, error: { message: "boom" } };
    await expect(cerrarTarifasLegadasDelTenant(cliente, P)).rejects.toThrow("boom");
  });
});

describe("registrarLegadasPorCerrar", () => {
  it("solo registra; no llama al cierre", async () => {
    const ids = await registrarLegadasPorCerrar(cliente, P);
    expect(ids).toEqual(["l1", "l2"]);
    expect(orden).not.toContain("rpc:cerrar_tarifas_legadas_del_tenant");
  });
});
