/**
 * Búsqueda de cuentas por correo.
 *
 * Fija el arreglo del 2026-10-02: la búsqueda va por la función SQL
 * `identidad.auth_usuario_id_por_email` y NO por `auth.admin.listUsers`, que en
 * local respondía 500 y se leía como «no existe» — el registro dejaba pasar
 * correos que ya eran cuenta de Rutax.
 */
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buscarCuentaPorEmail, correoTienePerfil } from "./cuenta-por-email";

type Perfil = { tipo_usuario: string; tenant_id: string } | null;

function cliente(opciones: { id?: string | null; errorRpc?: boolean; perfil?: Perfil }) {
  const rpc = vi.fn(async () =>
    opciones.errorRpc
      ? { data: null, error: { message: "fallo" } }
      : { data: opciones.id ?? null, error: null },
  );
  const listUsers = vi.fn(async () => {
    throw new Error("listUsers no debe usarse");
  });
  const cadena = {
    select: () => cadena,
    eq: () => cadena,
    maybeSingle: async () => ({ data: opciones.perfil ?? null, error: null }),
  };
  const c = {
    auth: { admin: { listUsers } },
    schema: () => ({ rpc, from: () => cadena }),
  } as unknown as Pick<SupabaseClient, "auth" | "schema">;
  return { c, rpc, listUsers };
}

describe("correoTienePerfil", () => {
  it("busca por la función SQL con el correo normalizado, nunca con listUsers", async () => {
    const { c, rpc, listUsers } = cliente({ id: "u1", perfil: { tipo_usuario: "interno", tenant_id: "t1" } });
    expect(await correoTienePerfil(c, "  Dueno@Despachos.CL ")).toBe(true);
    expect(rpc).toHaveBeenCalledWith("auth_usuario_id_por_email", { p_email: "dueno@despachos.cl" });
    expect(listUsers).not.toHaveBeenCalled();
  });

  it("cuenta de Auth sin perfil: no cuenta como ocupada (puede retomar «Tu empresa»)", async () => {
    const { c } = cliente({ id: "u1", perfil: null });
    expect(await correoTienePerfil(c, "x@y.cl")).toBe(false);
  });

  it("correo sin cuenta: false", async () => {
    const { c } = cliente({ id: null });
    expect(await correoTienePerfil(c, "x@y.cl")).toBe(false);
  });
});

describe("buscarCuentaPorEmail", () => {
  it("encuentra la cuenta del mismo courier y dice su tipo", async () => {
    const { c } = cliente({ id: "u1", perfil: { tipo_usuario: "conductor", tenant_id: "t1" } });
    expect(await buscarCuentaPorEmail(c, "c@y.cl", "t1")).toEqual({ existe: true, tipoEnMiCourier: "conductor" });
  });

  it("de otro courier: existe, sin revelar el tipo", async () => {
    const { c } = cliente({ id: "u1", perfil: { tipo_usuario: "conductor", tenant_id: "t2" } });
    expect(await buscarCuentaPorEmail(c, "c@y.cl", "t1")).toEqual({ existe: true, tipoEnMiCourier: null });
  });

  it("si la búsqueda falla, no lanza (comportamiento documentado de las invitaciones)", async () => {
    const { c } = cliente({ errorRpc: true });
    await expect(buscarCuentaPorEmail(c, "c@y.cl", "t1")).resolves.toEqual({ existe: false, tipoEnMiCourier: null });
  });
});
