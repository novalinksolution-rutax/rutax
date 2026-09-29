import { describe, it, expect, vi, beforeEach } from "vitest";

const orden: string[] = [];
const mocks = vi.hoisted(() => ({
  cierres: [] as Record<string, unknown>[],
  errorInsert: null as null | { code: string; message: string },
  puede: true,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/identidad/usuario-actual-servidor", () => ({
  obtenerSesionActual: vi.fn(async () => ({
    usuarioId: "u-1",
    usuario: { tenantId: "t-1" },
  })),
}));
vi.mock("@/modules/identidad/capacidades", () => ({
  puedeGestionarTarifas: vi.fn(() => mocks.puede),
}));
vi.mock("@/lib/fecha-santiago", () => ({ hoyEnSantiago: () => "2026-09-29" }));
vi.mock("@/modules/identidad/auditoria", () => ({
  registrarEnBitacora: vi.fn(async (_c: unknown, e: Record<string, unknown>) => {
    orden.push(`bitacora:${e.accion}`);
  }),
}));
vi.mock("@/modules/identidad/tarifas-legadas", () => ({
  cerrarTarifasLegadasDelTenant: vi.fn(async (_c: unknown, p: Record<string, unknown>) => {
    orden.push("cerrar-legadas");
    mocks.cierres.push(p);
    return { hayGeneral: true, cerradas: [], inactivadas: [] };
  }),
}));
vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: () => ({
    schema: () => ({
      from: () => ({
        insert: async () => {
          orden.push("insert-tarifa");
          return { error: mocks.errorInsert };
        },
      }),
    }),
  }),
}));

import { accionCrearTarifa } from "./actions";
import { cerrarTarifasLegadasDelTenant } from "@/modules/identidad/tarifas-legadas";

function form(campos: Record<string, string>) {
  const f = new FormData();
  const base: Record<string, string> = {
    modo_calculo: "monto_fijo",
    monto_clp: "4000",
    monto_conductor_clp: "2500",
    vigente_desde: "2026-09-29",
  };
  for (const [k, v] of Object.entries({ ...base, ...campos })) f.set(k, v);
  return f;
}

beforeEach(() => {
  orden.length = 0;
  mocks.cierres.length = 0;
  mocks.errorInsert = null;
  mocks.puede = true;
  vi.mocked(cerrarTarifasLegadasDelTenant).mockClear();
});

describe("accionCrearTarifa: cierre de tarifas antiguas", () => {
  it("una tarifa del modelo nuevo (todas las plataformas) cierra las antiguas, después de crearla", async () => {
    const r = await accionCrearTarifa(form({ fuente: "todas" }));
    expect(r).toEqual({ ok: true });
    expect(orden).toEqual(["bitacora:identidad.tarifa_creada", "insert-tarifa", "cerrar-legadas"]);
    expect(mocks.cierres[0]).toEqual({ tenantId: "t-1", actorUsuarioId: "u-1", hoy: "2026-09-29" });
  });

  it("una tarifa por plataforma también", async () => {
    await accionCrearTarifa(form({ fuente: "shopify" }));
    expect(orden).toContain("cerrar-legadas");
  });

  it("una tarifa legada por régimen NO cierra nada", async () => {
    await accionCrearTarifa(form({ tipo_entrega: "flex" }));
    expect(orden).not.toContain("cerrar-legadas");
  });

  it("una tarifa de un seller NO cierra las del tenant", async () => {
    await accionCrearTarifa(form({ fuente: "todas", seller_id: "s-1" }));
    expect(orden).not.toContain("cerrar-legadas");
  });

  it("si el insert falla no se cierra nada", async () => {
    mocks.errorInsert = { code: "23505", message: "dup" };
    const r = await accionCrearTarifa(form({ fuente: "todas" }));
    expect(r.ok).toBe(false);
    expect(orden).not.toContain("cerrar-legadas");
  });

  it("si el cierre falla lo dice, sin ocultar que la tarifa se creó", async () => {
    vi.mocked(cerrarTarifasLegadasDelTenant).mockRejectedValueOnce(new Error("x"));
    const r = await accionCrearTarifa(form({ fuente: "todas" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.mensaje).toContain("se creó");
  });

  it("sin permiso no hace nada", async () => {
    mocks.puede = false;
    const r = await accionCrearTarifa(form({ fuente: "todas" }));
    expect(r.ok).toBe(false);
    expect(orden).toEqual([]);
  });
});
