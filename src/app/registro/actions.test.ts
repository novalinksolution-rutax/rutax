/**
 * Regresión — `reenviarCorreoActivacion` debe pasar `redirectTo` a
 * `inviteUserByEmail`, igual que `crearTenantConDueno`
 * (ver `src/modules/identidad/onboarding.test.ts`).
 *
 * Sin `redirectTo`, el reenvío del enlace de activación tiene el mismo agujero
 * que el alta original (detectado al provisionar producción, 2026-08-07): el
 * enlace depende por completo de que la plantilla de correo de Supabase esté
 * personalizada. El default de Supabase usa `{{ .ConfirmationURL }}` (flujo
 * implícito, tokens en el FRAGMENTO de la URL); `/auth/confirm` lee
 * `token_hash` del QUERY STRING — nunca se encuentran, y el dueño aterriza en
 * la raíz del sitio en vez de en `/activar-cuenta`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: vi.fn(),
}));

import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { reenviarCorreoActivacion } from "./actions";

const CLAVES = ["APP_PUBLIC_URL", "APP_BASE_URL", "NEXT_PUBLIC_APP_URL", "VERCEL_URL"] as const;

function crearClienteFalso(usuarioExistente: { id: string; email: string } | null) {
  const inviteUserByEmail = vi.fn(
    async (_email: string, _opciones?: { redirectTo?: string; data?: Record<string, unknown> }) => ({
      data: { user: usuarioExistente },
      error: null,
    }),
  );
  const listUsers = vi.fn(async () => ({
    data: { users: usuarioExistente ? [usuarioExistente] : [] },
    error: null,
  }));
  return {
    cliente: { auth: { admin: { listUsers, inviteUserByEmail } } },
    inviteUserByEmail,
  };
}

describe("reenviarCorreoActivacion — redirectTo (no depender de la plantilla de Supabase)", () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const clave of CLAVES) {
      original[clave] = process.env[clave];
      delete process.env[clave];
    }
  });

  afterEach(() => {
    for (const clave of CLAVES) {
      if (original[clave] === undefined) delete process.env[clave];
      else process.env[clave] = original[clave];
    }
    vi.clearAllMocks();
  });

  it("pasa redirectTo apuntando a /activar-cuenta cuando hay URL pública declarada", async () => {
    process.env.APP_PUBLIC_URL = "https://rutax.io";
    const { cliente, inviteUserByEmail } = crearClienteFalso({ id: "u-1", email: "dueno@rutax.cl" });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente as never);

    const resultado = await reenviarCorreoActivacion("dueno@rutax.cl");

    expect(resultado.ok).toBe(true);
    expect(inviteUserByEmail).toHaveBeenCalledTimes(1);
    expect(inviteUserByEmail).toHaveBeenCalledWith(
      "dueno@rutax.cl",
      expect.objectContaining({ redirectTo: "https://rutax.io/activar-cuenta" }),
    );
  });

  it("no manda redirectTo vacío ni la ruta relativa sola cuando no hay URL pública declarada", async () => {
    // Sin ninguna de las cuatro variables puestas — mismo caso límite que
    // `resolverRedirectToActivacionCuenta` en `onboarding.test.ts`: el llamador
    // debe recibir `undefined`, nunca un string vacío o una ruta relativa que
    // Supabase interpretaría mal.
    const { cliente, inviteUserByEmail } = crearClienteFalso({ id: "u-1", email: "dueno@rutax.cl" });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente as never);

    await reenviarCorreoActivacion("dueno@rutax.cl");

    expect(inviteUserByEmail).toHaveBeenCalledTimes(1);
    const opciones = inviteUserByEmail.mock.calls[0]?.[1] as { redirectTo?: string } | undefined;
    expect(opciones?.redirectTo).toBeUndefined();
  });
});
