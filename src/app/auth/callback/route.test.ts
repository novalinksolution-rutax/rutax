/**
 * Pruebas del callback PKCE de Google — `GET /auth/callback` (F1).
 *
 * Cubre las dos bifurcaciones del contrato (ver cabecera de `route.ts`):
 *   - REGISTRO (hay borrador): provisiona, detecta H2/H5, compensa con el
 *     criterio de H3.
 *   - LOGIN (sin borrador): exige perfil existente, limpia huérfanos.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock("@/lib/identidad/borrador-registro", () => ({
  leerBorrador: vi.fn(),
  limpiarBorrador: vi.fn(),
}));

vi.mock("@/modules/identidad/onboarding", () => ({
  buscarPerfilPorAuthUserId: vi.fn(),
  provisionarTenantParaAuthUser: vi.fn(),
  activarPerfilDueno: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { leerBorrador, limpiarBorrador } from "@/lib/identidad/borrador-registro";
import {
  activarPerfilDueno,
  buscarPerfilPorAuthUserId,
  provisionarTenantParaAuthUser,
} from "@/modules/identidad/onboarding";
import { ErrorConflicto } from "@/modules/identidad/errores";
import { GET } from "./route";

const AUTH_USER_ID = "11111111-1111-1111-1111-111111111111";

const BORRADOR = {
  nombreFantasia: "Despachos Rápidos SpA",
  rut: "76543210-3",
  nombreDueno: "María Pérez",
  emailDueno: "dueno@despachosrapidos.cl",
  aceptaTerminos: true as const,
};

function usuarioAuth(overrides: Partial<{ created_at: string; last_sign_in_at: string | null }> = {}) {
  return {
    id: AUTH_USER_ID,
    email: "dueno@despachosrapidos.cl",
    created_at: overrides.created_at ?? new Date().toISOString(),
    last_sign_in_at: overrides.last_sign_in_at ?? new Date().toISOString(),
  };
}

function clienteSupabaseFalso(opts: { user: unknown; errorCanje?: { message: string } | null }) {
  return {
    auth: {
      exchangeCodeForSession: vi.fn(async () => ({ error: opts.errorCanje ?? null })),
      getUser: vi.fn(async () => ({ data: { user: opts.user } })),
      signOut: vi.fn(async () => ({ error: null })),
      refreshSession: vi.fn(async () => ({ data: {}, error: null })),
    },
  };
}

function adminFalso() {
  return { auth: { admin: { deleteUser: vi.fn(async () => ({ error: null })) } } };
}

function peticion(params: { code?: string } = {}) {
  const query = new URLSearchParams();
  if (params.code !== undefined) query.set("code", params.code);
  return new Request(`http://localhost/auth/callback?${query.toString()}`) as unknown as import("next/server").NextRequest;
}

function destino(res: Response): { ruta: string; error: string | null } {
  const url = new URL(res.headers.get("location") ?? "");
  return { ruta: url.pathname, error: url.searchParams.get("error") };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(leerBorrador).mockResolvedValue(null);
  vi.mocked(limpiarBorrador).mockResolvedValue(undefined);
  vi.mocked(crearClienteServiceRole).mockReturnValue(adminFalso() as never);
});

describe("GET /auth/callback — sin `code`", () => {
  it("redirige a /login?error=oauth_invalido sin canjear nada", async () => {
    const res = await GET(peticion());
    expect(destino(res)).toEqual({ ruta: "/login", error: "oauth_invalido" });
  });
});

describe("GET /auth/callback — el canje falla", () => {
  it("redirige a /login?error=oauth_invalido", async () => {
    const supa = clienteSupabaseFalso({ user: usuarioAuth(), errorCanje: { message: "code inválido" } });
    vi.mocked(createClient).mockResolvedValue(supa as never);

    const res = await GET(peticion({ code: "un-code" }));
    expect(destino(res)).toEqual({ ruta: "/login", error: "oauth_invalido" });
  });
});

describe("GET /auth/callback — camino LOGIN (sin borrador)", () => {
  it("con perfil existente ACTIVO: refresca la sesión y va a /, sin activar nada", async () => {
    const supa = clienteSupabaseFalso({ user: usuarioAuth() });
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(buscarPerfilPorAuthUserId).mockResolvedValue({
      tenantId: "t-1",
      tipoUsuario: "interno",
      rol: "dueno",
      estado: "activo",
    });

    const res = await GET(peticion({ code: "un-code" }));

    expect(destino(res)).toEqual({ ruta: "/", error: null });
    expect(supa.auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(supa.auth.signOut).not.toHaveBeenCalled();
    expect(activarPerfilDueno).not.toHaveBeenCalled();
  });

  it("🔴 caso de borde: perfil existente pero INVITADO (dueño del backstage que entra por Google antes de aceptar su enlace) → se activa en el mismo paso, evitando el bucle /login↔/dashboard", async () => {
    const supa = clienteSupabaseFalso({ user: usuarioAuth() });
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(buscarPerfilPorAuthUserId).mockResolvedValue({
      tenantId: "t-1",
      tipoUsuario: "interno",
      rol: "dueno",
      estado: "invitado",
    });

    const res = await GET(peticion({ code: "un-code" }));

    expect(activarPerfilDueno).toHaveBeenCalledWith(expect.anything(), AUTH_USER_ID);
    expect(destino(res)).toEqual({ ruta: "/", error: null });
  });

  it("sin perfil: cierra sesión, borra el huérfano y va a /login?error=sin_cuenta", async () => {
    const supa = clienteSupabaseFalso({ user: usuarioAuth() });
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(buscarPerfilPorAuthUserId).mockResolvedValue(null);
    const admin = adminFalso();
    vi.mocked(crearClienteServiceRole).mockReturnValue(admin as never);

    const res = await GET(peticion({ code: "un-code" }));

    expect(destino(res)).toEqual({ ruta: "/login", error: "sin_cuenta" });
    expect(supa.auth.signOut).toHaveBeenCalledTimes(1);
    expect(admin.auth.admin.deleteUser).toHaveBeenCalledWith(AUTH_USER_ID);
  });
});

describe("GET /auth/callback — camino REGISTRO (hay borrador)", () => {
  it("sin perfil previo: provisiona con estado activo y compensarAuthUser false, limpia el borrador y va a /", async () => {
    const supa = clienteSupabaseFalso({ user: usuarioAuth() });
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(leerBorrador).mockResolvedValue(BORRADOR);
    vi.mocked(buscarPerfilPorAuthUserId).mockResolvedValue(null);
    vi.mocked(provisionarTenantParaAuthUser).mockResolvedValue({ tenantId: "t-1", duenoUsuarioId: AUTH_USER_ID });

    const res = await GET(peticion({ code: "un-code" }));

    expect(provisionarTenantParaAuthUser).toHaveBeenCalledWith(
      expect.anything(),
      AUTH_USER_ID,
      expect.objectContaining({
        tenant: { nombreFantasia: BORRADOR.nombreFantasia, rut: BORRADOR.rut },
        dueno: { email: BORRADOR.emailDueno, nombreCompleto: BORRADOR.nombreDueno },
      }),
      { estado: "activo", compensarAuthUser: false },
    );
    expect(limpiarBorrador).toHaveBeenCalledTimes(1);
    expect(supa.auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(destino(res)).toEqual({ ruta: "/", error: null });
  });

  it("🔴 H5 idempotencia: perfil existente interno+dueno ACTIVO → NO reprovisiona ni reactiva, limpia borrador y va a /", async () => {
    const supa = clienteSupabaseFalso({ user: usuarioAuth() });
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(leerBorrador).mockResolvedValue(BORRADOR);
    vi.mocked(buscarPerfilPorAuthUserId).mockResolvedValue({
      tenantId: "t-1",
      tipoUsuario: "interno",
      rol: "dueno",
      estado: "activo",
    });

    const res = await GET(peticion({ code: "un-code" }));

    expect(provisionarTenantParaAuthUser).not.toHaveBeenCalled();
    expect(activarPerfilDueno).not.toHaveBeenCalled();
    expect(limpiarBorrador).toHaveBeenCalledTimes(1);
    expect(destino(res)).toEqual({ ruta: "/", error: null });
  });

  it("🔴 H2 un correo, una cuenta: perfil existente de OTRO tipo → correo_ocupado, sin provisionar ni borrar el auth user", async () => {
    const supa = clienteSupabaseFalso({ user: usuarioAuth() });
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(leerBorrador).mockResolvedValue(BORRADOR);
    vi.mocked(buscarPerfilPorAuthUserId).mockResolvedValue({
      tenantId: "t-9",
      tipoUsuario: "seller",
      rol: "seller",
      estado: "activo",
    });
    const admin = adminFalso();
    vi.mocked(crearClienteServiceRole).mockReturnValue(admin as never);

    const res = await GET(peticion({ code: "un-code" }));

    expect(provisionarTenantParaAuthUser).not.toHaveBeenCalled();
    expect(supa.auth.signOut).toHaveBeenCalledTimes(1);
    expect(admin.auth.admin.deleteUser).not.toHaveBeenCalled();
    expect(destino(res)).toEqual({ ruta: "/registro", error: "correo_ocupado" });
  });

  it("🔴 H3: provisión falla con identidad RECIÉN creada → borra el usuario Auth huérfano", async () => {
    const supa = clienteSupabaseFalso({ user: usuarioAuth({ created_at: new Date().toISOString(), last_sign_in_at: new Date().toISOString() }) });
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(leerBorrador).mockResolvedValue(BORRADOR);
    vi.mocked(buscarPerfilPorAuthUserId).mockResolvedValue(null);
    vi.mocked(provisionarTenantParaAuthUser).mockRejectedValue(new Error("fallo de infraestructura"));
    const admin = adminFalso();
    vi.mocked(crearClienteServiceRole).mockReturnValue(admin as never);

    const res = await GET(peticion({ code: "un-code" }));

    expect(supa.auth.signOut).toHaveBeenCalledTimes(1);
    expect(admin.auth.admin.deleteUser).toHaveBeenCalledWith(AUTH_USER_ID);
    expect(destino(res)).toEqual({ ruta: "/registro", error: "error_sistema" });
  });

  it("🔴 H3: provisión falla con identidad ANTIGUA (created_at lejano) → NO borra el usuario Auth", async () => {
    const antiguo = usuarioAuth({
      created_at: new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString(),
      last_sign_in_at: new Date().toISOString(),
    });
    const supa = clienteSupabaseFalso({ user: antiguo });
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(leerBorrador).mockResolvedValue(BORRADOR);
    vi.mocked(buscarPerfilPorAuthUserId).mockResolvedValue(null);
    vi.mocked(provisionarTenantParaAuthUser).mockRejectedValue(new Error("fallo de infraestructura"));
    const admin = adminFalso();
    vi.mocked(crearClienteServiceRole).mockReturnValue(admin as never);

    const res = await GET(peticion({ code: "un-code" }));

    expect(supa.auth.signOut).toHaveBeenCalledTimes(1);
    expect(admin.auth.admin.deleteUser).not.toHaveBeenCalled();
    expect(destino(res)).toEqual({ ruta: "/registro", error: "error_sistema" });
  });

  it("RUT duplicado (ErrorConflicto con 'rut' en el mensaje) → error=conflicto_rut", async () => {
    const supa = clienteSupabaseFalso({ user: usuarioAuth() });
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(leerBorrador).mockResolvedValue(BORRADOR);
    vi.mocked(buscarPerfilPorAuthUserId).mockResolvedValue(null);
    vi.mocked(provisionarTenantParaAuthUser).mockRejectedValue(
      new ErrorConflicto("Ya existe un courier registrado con el RUT 76543210-3."),
    );

    const res = await GET(peticion({ code: "un-code" }));

    expect(destino(res)).toEqual({ ruta: "/registro", error: "conflicto_rut" });
  });
});
