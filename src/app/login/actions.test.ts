/**
 * Pruebas de login por código (F1). Lo que importa custodiar:
 *   - H1: `shouldCreateUser: false` siempre — login nunca crea una cuenta.
 *   - Mensaje neutro en `enviarCodigoLogin`, con o sin error (no se revela si
 *     el correo tiene cuenta).
 *   - H4: `verificarCodigoLogin` refresca la sesión al verificar con éxito.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: vi.fn(() => ({ marcador: "admin" })),
}));

vi.mock("@/modules/identidad/onboarding", () => ({
  buscarPerfilPorAuthUserId: vi.fn(),
  activarPerfilDueno: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { buscarPerfilPorAuthUserId, activarPerfilDueno } from "@/modules/identidad/onboarding";
import { enviarCodigoLogin, verificarCodigoLogin } from "./actions";

function clienteFalso(opts: { errorEnvio?: { message: string } | null; errorVerify?: { message: string } | null; user?: unknown } = {}) {
  return {
    auth: {
      signInWithOtp: vi.fn(async () => ({ error: opts.errorEnvio ?? null })),
      verifyOtp: vi.fn(async () => ({
        data: { user: opts.errorVerify ? null : (opts.user ?? { id: "u-1" }) },
        error: opts.errorVerify ?? null,
      })),
      refreshSession: vi.fn(async () => ({ data: {}, error: null })),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("enviarCodigoLogin", () => {
  it("rechaza un correo con formato inválido sin llamar a Supabase", async () => {
    const resultado = await enviarCodigoLogin("no-es-un-correo");
    expect(resultado.ok).toBe(false);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("H1: llama a signInWithOtp con shouldCreateUser:false", async () => {
    const supa = clienteFalso();
    vi.mocked(createClient).mockResolvedValue(supa as never);

    await enviarCodigoLogin("Seller@Ejemplo.CL");

    expect(supa.auth.signInWithOtp).toHaveBeenCalledWith({
      email: "seller@ejemplo.cl",
      options: { shouldCreateUser: false },
    });
  });

  it("mensaje neutro cuando Supabase reporta éxito", async () => {
    const supa = clienteFalso();
    vi.mocked(createClient).mockResolvedValue(supa as never);

    const resultado = await enviarCodigoLogin("tiene@cuenta.cl");
    expect(resultado.ok).toBe(true);
    expect(resultado.mensaje).toContain("tiene@cuenta.cl");
  });

  it("🔴 mensaje IGUAL de neutro cuando Supabase reporta error (no revela si el correo existe)", async () => {
    const supa = clienteFalso({ errorEnvio: { message: "correo no encontrado" } });
    vi.mocked(createClient).mockResolvedValue(supa as never);

    const conCuenta = await enviarCodigoLogin("tiene@cuenta.cl");
    const supaOk = clienteFalso();
    vi.mocked(createClient).mockResolvedValue(supaOk as never);
    const sinCuenta = await enviarCodigoLogin("no-tiene@cuenta.cl");

    // Mismo `ok` y misma estructura de mensaje en ambos casos — solo cambia el
    // correo interpolado, no si hubo o no un error de Supabase de por medio.
    expect(conCuenta.ok).toBe(sinCuenta.ok);
    expect(conCuenta.mensaje.replace("tiene@cuenta.cl", "X")).toBe(
      sinCuenta.mensaje.replace("no-tiene@cuenta.cl", "X"),
    );
  });
});

describe("verificarCodigoLogin", () => {
  beforeEach(() => {
    vi.mocked(buscarPerfilPorAuthUserId).mockResolvedValue({
      tenantId: "t-1",
      tipoUsuario: "seller",
      rol: "seller",
      estado: "activo",
    });
  });

  it("código inválido → ok:false, sin refrescar sesión", async () => {
    const supa = clienteFalso({ errorVerify: { message: "token inválido" } });
    vi.mocked(createClient).mockResolvedValue(supa as never);

    const resultado = await verificarCodigoLogin("seller@ejemplo.cl", "000000");

    expect(resultado.ok).toBe(false);
    expect(supa.auth.refreshSession).not.toHaveBeenCalled();
  });

  it("H4: código válido → refresca la sesión antes de devolver ok:true", async () => {
    const supa = clienteFalso({ user: { id: "u-1" } });
    vi.mocked(createClient).mockResolvedValue(supa as never);

    const resultado = await verificarCodigoLogin("seller@ejemplo.cl", "123456");

    expect(resultado.ok).toBe(true);
    expect(supa.auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(supa.auth.verifyOtp).toHaveBeenCalledWith({
      type: "email",
      email: "seller@ejemplo.cl",
      token: "123456",
    });
  });

  it("🔴 caso de borde: perfil INVITADO (dueño del backstage que entra por código antes de aceptar su enlace) → se activa en el mismo paso", async () => {
    const supa = clienteFalso({ user: { id: "u-1" } });
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(buscarPerfilPorAuthUserId).mockResolvedValue({
      tenantId: "t-1",
      tipoUsuario: "interno",
      rol: "dueno",
      estado: "invitado",
    });

    const resultado = await verificarCodigoLogin("dueno@rutax.cl", "123456");

    expect(resultado.ok).toBe(true);
    expect(activarPerfilDueno).toHaveBeenCalledWith(expect.anything(), "u-1");
  });

  it("perfil activo → NO llama a activarPerfilDueno", async () => {
    const supa = clienteFalso({ user: { id: "u-1" } });
    vi.mocked(createClient).mockResolvedValue(supa as never);

    await verificarCodigoLogin("seller@ejemplo.cl", "123456");

    expect(activarPerfilDueno).not.toHaveBeenCalled();
  });
});
