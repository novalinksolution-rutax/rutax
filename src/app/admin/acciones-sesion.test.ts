/**
 * Pruebas de las Server Actions de sesión del backstage (`acciones-sesion.ts`).
 *
 * `iniciarSesionAdmin` (correo+contraseña, F3-A) se retiró el 2026-09-15
 * (F4.d): el backstage ya no tiene login propio, así que sus pruebas de
 * fail-closed post-login se retiraron con ella — el gate real
 * (`exigirSuperAdmin`/`exigirSuperAdminEscritura`) sigue probado en
 * `@/modules/plataforma/autorizacion-admin`. Lo único que queda acá es
 * `cerrarSesionAdmin`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { cerrarSesionAdmin } from "./acciones-sesion";

function mockCliente(signOut = vi.fn(() => Promise.resolve({ error: null }))) {
  vi.mocked(createClient).mockResolvedValue({
    auth: { signOut },
  } as unknown as Awaited<ReturnType<typeof createClient>>);
  return { signOut };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("cerrarSesionAdmin", () => {
  it("cierra la sesión Supabase real", async () => {
    const { signOut } = mockCliente();
    await cerrarSesionAdmin();
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
