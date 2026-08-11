/**
 * Pruebas de `solicitarRecuperacionContrasena` — paso 1 de la recuperación.
 *
 * El foco NO es "manda el correo": es que la pantalla no se convierta en un
 * oráculo de enumeración de cuentas. Por eso la mayoría de los casos verifican
 * que la RESPUESTA sea idéntica pase lo que pase del lado de Auth.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ consumirRateLimit: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { consumirRateLimit } from "@/lib/rate-limit";
import { solicitarRecuperacionContrasena } from "./actions";

function mockAuth(resetPasswordForEmail = vi.fn().mockResolvedValue({ error: null })) {
  vi.mocked(createClient).mockResolvedValue({
    auth: { resetPasswordForEmail },
  } as unknown as Awaited<ReturnType<typeof createClient>>);
  return resetPasswordForEmail;
}

function permitir() {
  vi.mocked(consumirRateLimit).mockResolvedValue({ permitido: true, restante: 2, reintentarEnSegundos: 0 });
}

beforeEach(() => {
  vi.clearAllMocks();
  permitir();
  mockAuth();
});

describe("validación de entrada", () => {
  it("rechaza un correo vacío", async () => {
    const r = await solicitarRecuperacionContrasena("   ");
    expect(r).toEqual({ ok: false, tipo: "validacion", mensaje: expect.any(String) });
  });

  it("rechaza texto que no es un correo", async () => {
    const r = await solicitarRecuperacionContrasena("no-soy-un-correo");
    expect(r.ok).toBe(false);
  });

  it("no llama a Auth si la entrada es inválida", async () => {
    const reset = mockAuth();
    await solicitarRecuperacionContrasena("nope");
    expect(reset).not.toHaveBeenCalled();
  });
});

describe("no filtra si la cuenta existe", () => {
  it("responde ok cuando Auth acepta", async () => {
    const r = await solicitarRecuperacionContrasena("existe@rutax.cl");
    expect(r).toEqual({ ok: true });
  });

  it("responde EXACTAMENTE lo mismo cuando Auth devuelve error", async () => {
    mockAuth(vi.fn().mockResolvedValue({ error: { message: "User not found" } }));
    const r = await solicitarRecuperacionContrasena("no-existe@rutax.cl");
    expect(r).toEqual({ ok: true });
  });

  it("normaliza el correo a minúsculas y sin espacios antes de enviarlo", async () => {
    const reset = mockAuth();
    await solicitarRecuperacionContrasena("  Dueno@Rutax.CL  ");
    // Solo el primer argumento: el segundo depende de APP_PUBLIC_URL, que no
    // está definida en el entorno de pruebas (y su ausencia es un caso válido).
    expect(reset.mock.calls[0]?.[0]).toBe("dueno@rutax.cl");
  });

  it("omite redirectTo cuando no hay APP_PUBLIC_URL, en vez de armar una URL rota", async () => {
    const reset = mockAuth();
    await solicitarRecuperacionContrasena("dueno@rutax.cl");
    expect(reset.mock.calls[0]?.[1]).toBeUndefined();
  });
});

describe("límite de tasa", () => {
  it("bloquea y NO llama a Auth cuando se excede", async () => {
    vi.mocked(consumirRateLimit).mockResolvedValue({
      permitido: false,
      restante: 0,
      reintentarEnSegundos: 1800,
    });
    const reset = mockAuth();

    const r = await solicitarRecuperacionContrasena("dueno@rutax.cl");

    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ tipo: "limite" });
    expect(reset).not.toHaveBeenCalled();
  });

  it("usa una llave por correo, para que un abusador no bloquee a los demás", async () => {
    await solicitarRecuperacionContrasena("dueno@rutax.cl");
    expect(consumirRateLimit).toHaveBeenCalledWith("recuperacion:dueno@rutax.cl", expect.any(Number), expect.any(Number));
  });
});
