/**
 * Pruebas de las Server Actions de `/registro` (registro v2, paso 1).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/identidad/intencion-registro", () => ({
  asegurarIntencion: vi.fn(),
  limpiarIntencion: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ crearClienteServiceRole: vi.fn() }));
vi.mock("@/modules/identidad/onboarding", () => ({
  buscarPerfilPorAuthUserId: vi.fn(),
  activarPerfilDueno: vi.fn(),
}));
vi.mock("@/modules/identidad/cuenta-por-email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/identidad/cuenta-por-email")>()),
  correoTienePerfil: vi.fn(),
}));

import { asegurarIntencion, limpiarIntencion } from "@/lib/identidad/intencion-registro";
import { createClient } from "@/lib/supabase/server";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { correoTienePerfil } from "@/modules/identidad/cuenta-por-email";
import { activarPerfilDueno, buscarPerfilPorAuthUserId } from "@/modules/identidad/onboarding";
import { enviarCodigoRegistro, iniciarIntencionRegistro, verificarCodigoRegistro } from "./actions";

function clienteFalso(opts: { errorEnvio?: boolean; errorVerify?: boolean } = {}) {
  return {
    auth: {
      signInWithOtp: vi.fn(async () => ({ error: opts.errorEnvio ? { message: "x" } : null })),
      verifyOtp: vi.fn(async () => ({
        data: { user: opts.errorVerify ? null : { id: "auth-1" } },
        error: opts.errorVerify ? { message: "x" } : null,
      })),
      refreshSession: vi.fn(async () => ({ data: {}, error: null })),
      signOut: vi.fn(async () => ({ error: null })),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(crearClienteServiceRole).mockReturnValue({ marcador: "admin" } as never);
  vi.mocked(correoTienePerfil).mockResolvedValue(false);
});

describe("iniciarIntencionRegistro (camino Google)", () => {
  it("anota la intención en el servidor antes de que el cliente salga a Google", async () => {
    await expect(iniciarIntencionRegistro()).resolves.toEqual({ ok: true });
    expect(asegurarIntencion).toHaveBeenCalledTimes(1);
  });
});

describe("enviarCodigoRegistro", () => {
  it("correo inválido: no toca Supabase ni anota intención", async () => {
    const r = await enviarCodigoRegistro("no-es-correo");
    expect(r).toMatchObject({ ok: false, tipo: "correo_invalido" });
    expect(createClient).not.toHaveBeenCalled();
    expect(asegurarIntencion).not.toHaveBeenCalled();
  });

  it("🔴 correo que ya tiene cuenta: se rechaza ANTES de enviar el código, con el mensaje genérico", async () => {
    vi.mocked(correoTienePerfil).mockResolvedValue(true);
    const r = await enviarCodigoRegistro("Seller@Tienda.cl");
    expect(r).toEqual({
      ok: false,
      tipo: "correo_ocupado",
      mensaje: "Ese correo ya tiene una cuenta en Rutax. Usa otro.",
    });
    expect(correoTienePerfil).toHaveBeenCalledWith(expect.anything(), "seller@tienda.cl");
    expect(createClient).not.toHaveBeenCalled();
    expect(asegurarIntencion).not.toHaveBeenCalled();
  });

  it("correo libre: anota la intención ANTES de enviar y crea la identidad (shouldCreateUser)", async () => {
    const supa = clienteFalso();
    vi.mocked(createClient).mockResolvedValue(supa as never);
    const orden: string[] = [];
    vi.mocked(asegurarIntencion).mockImplementation(async () => {
      orden.push("intencion");
      return {} as never;
    });
    supa.auth.signInWithOtp.mockImplementation(async () => {
      orden.push("envio");
      return { error: null };
    });

    const r = await enviarCodigoRegistro("Dueno@Nuevo.cl");

    expect(r.ok).toBe(true);
    expect(orden).toEqual(["intencion", "envio"]);
    expect(supa.auth.signInWithOtp).toHaveBeenCalledWith({
      email: "dueno@nuevo.cl",
      options: { shouldCreateUser: true },
    });
  });

  it("falla del envío → envio_fallido", async () => {
    vi.mocked(createClient).mockResolvedValue(clienteFalso({ errorEnvio: true }) as never);
    expect(await enviarCodigoRegistro("a@b.cl")).toMatchObject({ ok: false, tipo: "envio_fallido" });
  });
});

describe("verificarCodigoRegistro", () => {
  it("código inválido: no consulta perfiles", async () => {
    vi.mocked(createClient).mockResolvedValue(clienteFalso({ errorVerify: true }) as never);
    const r = await verificarCodigoRegistro("a@b.cl", "000000");
    expect(r).toMatchObject({ ok: false, tipo: "codigo_invalido" });
    expect(buscarPerfilPorAuthUserId).not.toHaveBeenCalled();
  });

  it("identidad SIN perfil → /registro/empresa, sin tocar la intención (la consume el paso 2)", async () => {
    vi.mocked(createClient).mockResolvedValue(clienteFalso() as never);
    vi.mocked(buscarPerfilPorAuthUserId).mockResolvedValue(null);
    const r = await verificarCodigoRegistro("a@b.cl", "123456");
    expect(r).toEqual({ ok: true, destino: "/registro/empresa" });
    expect(limpiarIntencion).not.toHaveBeenCalled();
  });

  it("dueño que ya tenía perfil → comportamiento de login (/), refresca el JWT y limpia la intención", async () => {
    const supa = clienteFalso();
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(buscarPerfilPorAuthUserId).mockResolvedValue({
      tenantId: "t-1",
      tipoUsuario: "interno",
      rol: "dueno",
      estado: "activo",
    });
    const r = await verificarCodigoRegistro("a@b.cl", "123456");
    expect(r).toEqual({ ok: true, destino: "/" });
    expect(supa.auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(limpiarIntencion).toHaveBeenCalledTimes(1);
    expect(activarPerfilDueno).not.toHaveBeenCalled();
  });

  it("dueño con perfil `invitado` → se activa (evita el bucle login↔dashboard)", async () => {
    vi.mocked(createClient).mockResolvedValue(clienteFalso() as never);
    vi.mocked(buscarPerfilPorAuthUserId).mockResolvedValue({
      tenantId: "t-1",
      tipoUsuario: "interno",
      rol: "dueno",
      estado: "invitado",
    });
    await verificarCodigoRegistro("a@b.cl", "123456");
    expect(activarPerfilDueno).toHaveBeenCalledWith(expect.anything(), "auth-1");
  });

  it("🔴 perfil de OTRO tipo (conductor) → correo_ocupado y cierra sesión", async () => {
    const supa = clienteFalso();
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(buscarPerfilPorAuthUserId).mockResolvedValue({
      tenantId: "t-9",
      tipoUsuario: "conductor",
      rol: "conductor",
      estado: "activo",
    });
    const r = await verificarCodigoRegistro("c@b.cl", "123456");
    expect(r).toMatchObject({ ok: false, tipo: "correo_ocupado" });
    expect(supa.auth.signOut).toHaveBeenCalledTimes(1);
  });
});
