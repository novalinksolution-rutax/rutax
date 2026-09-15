/**
 * Pruebas de `/auth/confirm` — puente de enlace de correo (F1: exclusivo del
 * backstage desde que el autoservicio dejó de mandar enlaces).
 *
 * Cubre lo que F1 le agregó: para `type=invite`, activa el perfil
 * (`estado: invitado → activo`) en el mismo paso, y si esa activación falla,
 * cierra sesión en vez de dejarla varada.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: vi.fn(() => ({ marcador: "admin" })),
}));

vi.mock("@/modules/identidad/onboarding", () => ({
  activarPerfilDueno: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { activarPerfilDueno } from "@/modules/identidad/onboarding";
import { GET } from "./route";

const USER = { id: "u-1", email: "dueno@rutax.cl" };

function clienteFalso(opts: { errorVerify?: { message: string } | null; user?: unknown } = {}) {
  return {
    auth: {
      verifyOtp: vi.fn(async () => ({ error: opts.errorVerify ?? null })),
      getUser: vi.fn(async () => ({ data: { user: opts.user ?? USER } })),
      refreshSession: vi.fn(async () => ({ data: {}, error: null })),
      signOut: vi.fn(async () => ({ error: null })),
    },
  };
}

function peticion(params: { token_hash?: string; type?: string; next?: string } = {}) {
  const query = new URLSearchParams();
  if (params.token_hash) query.set("token_hash", params.token_hash);
  if (params.type) query.set("type", params.type);
  if (params.next) query.set("next", params.next);
  return new Request(`http://localhost/auth/confirm?${query.toString()}`) as unknown as import("next/server").NextRequest;
}

function destino(res: Response): { ruta: string; error: string | null } {
  const url = new URL(res.headers.get("location") ?? "");
  return { ruta: url.pathname, error: url.searchParams.get("error") };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /auth/confirm — sin token_hash o type", () => {
  it("redirige a /login?error=enlace_invalido", async () => {
    const res = await GET(peticion());
    expect(destino(res)).toEqual({ ruta: "/login", error: "enlace_invalido" });
  });
});

describe("GET /auth/confirm — verifyOtp falla", () => {
  it("redirige a /login?error=enlace_invalido", async () => {
    vi.mocked(createClient).mockResolvedValue(
      clienteFalso({ errorVerify: { message: "token vencido" } }) as never,
    );
    const res = await GET(peticion({ token_hash: "abc", type: "invite" }));
    expect(destino(res)).toEqual({ ruta: "/login", error: "enlace_invalido" });
  });
});

describe("GET /auth/confirm — type=invite (backstage)", () => {
  it("activa el perfil, refresca la sesión y sigue al `next` pedido", async () => {
    const supa = clienteFalso();
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(activarPerfilDueno).mockResolvedValue({ tenantId: "t-1", rol: "dueno" });

    const res = await GET(peticion({ token_hash: "abc", type: "invite", next: "/dashboard" }));

    expect(activarPerfilDueno).toHaveBeenCalledWith(expect.anything(), USER.id);
    expect(supa.auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(destino(res)).toEqual({ ruta: "/dashboard", error: null });
  });

  it("sin `next` explícito, cae en la raíz (decisión 3: el root enruta por rol)", async () => {
    const supa = clienteFalso();
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(activarPerfilDueno).mockResolvedValue({ tenantId: "t-1", rol: "dueno" });

    const res = await GET(peticion({ token_hash: "abc", type: "invite" }));

    expect(destino(res)).toEqual({ ruta: "/", error: null });
  });

  it("idempotente: activarPerfilDueno devuelve null (ya estaba activo) y aun así sigue a destino", async () => {
    const supa = clienteFalso();
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(activarPerfilDueno).mockResolvedValue(null);

    const res = await GET(peticion({ token_hash: "abc", type: "invite" }));

    expect(destino(res)).toEqual({ ruta: "/", error: null });
  });

  it("🔴 si la activación lanza, cierra sesión y va a /login?error=activacion_fallida (no deja la sesión varada)", async () => {
    const supa = clienteFalso();
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(activarPerfilDueno).mockRejectedValue(new Error("fallo de infraestructura"));

    const res = await GET(peticion({ token_hash: "abc", type: "invite" }));

    expect(supa.auth.signOut).toHaveBeenCalledTimes(1);
    expect(destino(res)).toEqual({ ruta: "/login", error: "activacion_fallida" });
  });
});

describe("GET /auth/confirm — otros `type` (p. ej. `email` de otros flujos)", () => {
  it("no llama a activarPerfilDueno y sigue directo al `next`", async () => {
    const supa = clienteFalso();
    vi.mocked(createClient).mockResolvedValue(supa as never);

    const res = await GET(peticion({ token_hash: "abc", type: "email", next: "/portal" }));

    expect(activarPerfilDueno).not.toHaveBeenCalled();
    expect(destino(res)).toEqual({ ruta: "/portal", error: null });
  });
});

describe("GET /auth/confirm — saneo del `next` (plantilla hosted desincronizada / open-redirect)", () => {
  beforeEach(() => {
    const supa = clienteFalso();
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(activarPerfilDueno).mockResolvedValue({ tenantId: "t-1", rol: "dueno" });
  });

  it("🔴 una plantilla vieja con next=/activar-cuenta (ruta retirada) cae en la raíz, no en un 404", async () => {
    const res = await GET(peticion({ token_hash: "abc", type: "invite", next: "/activar-cuenta" }));
    expect(destino(res)).toEqual({ ruta: "/", error: null });
  });

  it("las otras rutas retiradas de F1 también caen en la raíz", async () => {
    for (const retirada of ["/recuperar-contrasena", "/restablecer-contrasena"]) {
      const res = await GET(peticion({ token_hash: "abc", type: "invite", next: retirada }));
      expect(destino(res).ruta).toBe("/");
    }
  });

  it("un open-redirect a otro origen (//evil.com) cae en la raíz", async () => {
    const res = await GET(peticion({ token_hash: "abc", type: "invite", next: "//evil.com" }));
    expect(destino(res).ruta).toBe("/");
  });

  it("un `next` absoluto (https://evil.com) cae en la raíz", async () => {
    const res = await GET(peticion({ token_hash: "abc", type: "invite", next: "https://evil.com" }));
    expect(destino(res).ruta).toBe("/");
  });

  it("una ruta interna legítima con query se conserva tal cual", async () => {
    const res = await GET(peticion({ token_hash: "abc", type: "invite", next: "/dashboard?bienvenida=1" }));
    const url = new URL(res.headers.get("location") ?? "");
    expect(url.pathname).toBe("/dashboard");
    expect(url.searchParams.get("bienvenida")).toBe("1");
  });
});
