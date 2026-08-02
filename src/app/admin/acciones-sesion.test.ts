/**
 * Pruebas de las Server Actions de sesión del backstage (`acciones-sesion.ts`)
 * — F3-A. Foco: el fail-closed post-login. Un `signInWithPassword` exitoso a
 * nivel de Supabase Auth NO basta para entrar al backstage — si el usuario no
 * es un super-admin ACTIVO, la acción debe cerrar la sesión recién creada y
 * devolver un error genérico (nunca dejar una sesión autenticada "colgando").
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/modules/plataforma/autorizacion-admin", () => ({
  resolverSuperAdminActivo: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { resolverSuperAdminActivo } from "@/modules/plataforma/autorizacion-admin";
import { iniciarSesionAdmin, cerrarSesionAdmin } from "./acciones-sesion";

const USUARIO_ID = "ad000000-0000-0000-0000-000000000001";

function formData(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.set(k, v);
  return fd;
}

function mockCliente(opts: {
  signInWithPassword: ReturnType<typeof vi.fn>;
  signOut?: ReturnType<typeof vi.fn>;
}) {
  const signOut = opts.signOut ?? vi.fn(() => Promise.resolve({ error: null }));
  vi.mocked(createClient).mockResolvedValue({
    auth: { signInWithPassword: opts.signInWithPassword, signOut },
  } as unknown as Awaited<ReturnType<typeof createClient>>);
  return { signOut };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("iniciarSesionAdmin", () => {
  it("campos vacíos → error genérico, sin tocar Supabase Auth", async () => {
    const resultado = await iniciarSesionAdmin(formData({ email: "", password: "" }));
    expect(resultado.ok).toBe(false);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("signInWithPassword falla → 'Credenciales inválidas', sin consultar super_admins", async () => {
    mockCliente({
      signInWithPassword: vi.fn(() => Promise.resolve({ data: { user: null }, error: { message: "Invalid login" } })),
    });

    const resultado = await iniciarSesionAdmin(formData({ email: "x@x.cl", password: "wrong" }));

    expect(resultado).toEqual({ ok: false, mensaje: "Credenciales inválidas." });
    expect(resolverSuperAdminActivo).not.toHaveBeenCalled();
  });

  it("login de Auth OK pero NO es super-admin activo → cierra la sesión y error genérico (fail-closed)", async () => {
    const { signOut } = mockCliente({
      signInWithPassword: vi.fn(() =>
        Promise.resolve({ data: { user: { id: USUARIO_ID } }, error: null }),
      ),
    });
    vi.mocked(resolverSuperAdminActivo).mockResolvedValue(null);

    const resultado = await iniciarSesionAdmin(formData({ email: "dueno@courier.cl", password: "Demo2026!" }));

    expect(resultado).toEqual({ ok: false, mensaje: "Credenciales inválidas." });
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("error al leer plataforma.super_admins → trata como no-admin, cierra sesión (fail-closed)", async () => {
    const { signOut } = mockCliente({
      signInWithPassword: vi.fn(() =>
        Promise.resolve({ data: { user: { id: USUARIO_ID } }, error: null }),
      ),
    });
    vi.mocked(resolverSuperAdminActivo).mockRejectedValue(new Error("boom"));

    const resultado = await iniciarSesionAdmin(formData({ email: "admin@rutax.cl", password: "Demo2026!" }));

    expect(resultado.ok).toBe(false);
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("camino feliz: Auth OK + super-admin activo → ok, NO cierra la sesión", async () => {
    const { signOut } = mockCliente({
      signInWithPassword: vi.fn(() =>
        Promise.resolve({ data: { user: { id: USUARIO_ID } }, error: null }),
      ),
    });
    vi.mocked(resolverSuperAdminActivo).mockResolvedValue({
      usuarioId: USUARIO_ID,
      email: "admin@rutax.cl",
      nombre: "Fundador Rutax",
      rolAdmin: "admin_total",
    });

    const resultado = await iniciarSesionAdmin(formData({ email: "admin@rutax.cl", password: "Demo2026!" }));

    expect(resultado).toEqual({ ok: true });
    expect(signOut).not.toHaveBeenCalled();
  });
});

describe("cerrarSesionAdmin", () => {
  it("cierra la sesión Supabase real", async () => {
    const { signOut } = mockCliente({ signInWithPassword: vi.fn() });
    await cerrarSesionAdmin();
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
