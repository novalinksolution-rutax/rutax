/**
 * Pruebas de las Server Actions de MFA TOTP (`acciones-mfa.ts`) — F3-A.
 * Foco: las tres acciones exigen sesión real de super-admin (AAL1 basta —
 * enrolar/step-up es justamente CÓMO se llega a AAL2) y delegan en
 * `supabase.auth.mfa.*`, sin filtrar el secret/código en ningún mensaje.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/modules/plataforma/autorizacion-admin", () => ({
  exigirSuperAdmin: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { exigirSuperAdmin } from "@/modules/plataforma/autorizacion-admin";
import { iniciarEnrolamientoTotp, verificarEnrolamientoTotp, desafiarTotp } from "./acciones-mfa";

function mockCliente(opts: {
  enroll?: ReturnType<typeof vi.fn>;
  challengeAndVerify?: ReturnType<typeof vi.fn>;
}) {
  vi.mocked(createClient).mockResolvedValue({
    auth: {
      mfa: {
        enroll: opts.enroll ?? vi.fn(),
        challengeAndVerify: opts.challengeAndVerify ?? vi.fn(),
      },
    },
  } as unknown as Awaited<ReturnType<typeof createClient>>);
}

const ACTOR = {
  usuarioId: "ad000000-0000-0000-0000-000000000001",
  email: "admin@rutax.cl",
  nombre: "Fundador Rutax",
  rolAdmin: "admin_total" as const,
  aal: "aal1" as const,
  aalSiguiente: "aal1" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("iniciarEnrolamientoTotp", () => {
  it("sin sesión de super-admin → no autorizado, no llama a Supabase", async () => {
    vi.mocked(exigirSuperAdmin).mockRejectedValue(new Error("No autorizado."));

    const resultado = await iniciarEnrolamientoTotp();

    expect(resultado).toEqual({ ok: false, mensaje: "No autorizado." });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("camino feliz: devuelve factorId + QR + secret + uri", async () => {
    vi.mocked(exigirSuperAdmin).mockResolvedValue(ACTOR);
    mockCliente({
      enroll: vi.fn(() =>
        Promise.resolve({
          data: { id: "factor-1", type: "totp", totp: { qr_code: "<svg/>", secret: "SECRETO", uri: "otpauth://totp/x" } },
          error: null,
        }),
      ),
    });

    const resultado = await iniciarEnrolamientoTotp();

    expect(resultado).toEqual({
      ok: true,
      factorId: "factor-1",
      qrCodeSvg: "<svg/>",
      secret: "SECRETO",
      uri: "otpauth://totp/x",
    });
  });

  it("Supabase devuelve error → mensaje genérico", async () => {
    vi.mocked(exigirSuperAdmin).mockResolvedValue(ACTOR);
    mockCliente({ enroll: vi.fn(() => Promise.resolve({ data: null, error: { message: "boom" } })) });

    const resultado = await iniciarEnrolamientoTotp();

    expect(resultado.ok).toBe(false);
  });
});

describe("verificarEnrolamientoTotp", () => {
  it("código vacío → error de validación, no llama a Supabase", async () => {
    vi.mocked(exigirSuperAdmin).mockResolvedValue(ACTOR);

    const resultado = await verificarEnrolamientoTotp("factor-1", "  ");

    expect(resultado.ok).toBe(false);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("challengeAndVerify OK → ok:true", async () => {
    vi.mocked(exigirSuperAdmin).mockResolvedValue(ACTOR);
    const challengeAndVerify = vi.fn(() => Promise.resolve({ data: {}, error: null }));
    mockCliente({ challengeAndVerify });

    const resultado = await verificarEnrolamientoTotp("factor-1", "123456");

    expect(resultado).toEqual({ ok: true });
    expect(challengeAndVerify).toHaveBeenCalledWith({ factorId: "factor-1", code: "123456" });
  });

  it("código incorrecto → mensaje de error, sin filtrar el código en el mensaje", async () => {
    vi.mocked(exigirSuperAdmin).mockResolvedValue(ACTOR);
    mockCliente({ challengeAndVerify: vi.fn(() => Promise.resolve({ data: null, error: { message: "invalid" } })) });

    const resultado = await verificarEnrolamientoTotp("factor-1", "000000");

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.mensaje).not.toContain("000000");
    }
  });
});

describe("desafiarTotp", () => {
  it("sin sesión → no autorizado", async () => {
    vi.mocked(exigirSuperAdmin).mockRejectedValue(new Error("No autorizado."));

    const resultado = await desafiarTotp("factor-1", "123456");

    expect(resultado).toEqual({ ok: false, mensaje: "No autorizado." });
  });

  it("camino feliz: step-up exitoso", async () => {
    vi.mocked(exigirSuperAdmin).mockResolvedValue(ACTOR);
    mockCliente({ challengeAndVerify: vi.fn(() => Promise.resolve({ data: {}, error: null })) });

    const resultado = await desafiarTotp("factor-1", "123456");

    expect(resultado).toEqual({ ok: true });
  });
});
