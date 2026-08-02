/**
 * Tests de `sesion-admin.ts` — F3-A: este módulo es ahora una fachada delgada
 * sobre el gate real (`@/modules/plataforma/autorizacion-admin`), probado a
 * fondo en `autorizacion-admin.test.ts` (super_admin activo pasa; desactivado
 * se bloquea al instante; `soporte_lectura` bloqueado en escritura; AAL1
 * bloqueado en escritura). Aquí solo se prueba que la fachada:
 * - `tieneSesionAdmin()`: delega en `exigirSuperAdmin()` y exige AAL2.
 * - `exigirActorAdmin()`: delega en `exigirSuperAdminEscritura()`, propaga sus
 *   excepciones tal cual (drop-in para los callers existentes), y arma
 *   `{ adminSecret, actorUsuarioId, rolAdmin, aal }` a partir del actor real.
 * - `obtenerSuperAdminsActivos()`: lectura de catálogo (sin relación con el
 *   gate), sin cambios de comportamiento vs. antes de F3-A.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock("@/modules/plataforma/autorizacion-admin", () => ({
  exigirSuperAdmin: vi.fn(),
  exigirSuperAdminEscritura: vi.fn(),
}));

import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { exigirSuperAdmin, exigirSuperAdminEscritura } from "@/modules/plataforma/autorizacion-admin";
import {
  tieneSesionAdmin,
  exigirActorAdmin,
  obtenerSuperAdminsActivos,
  obtenerRolAdminActual,
} from "./sesion-admin";

const USUARIO_ID = "ad000000-0000-0000-0000-000000000001";
const ACTOR_BASE = {
  usuarioId: USUARIO_ID,
  email: "admin@rutax.cl",
  nombre: "Fundador Rutax",
  rolAdmin: "admin_total" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SUPER_ADMIN_SECRET = "secreto-de-prueba-suficientemente-largo";
});
afterEach(() => {
  delete process.env.SUPER_ADMIN_SECRET;
});

describe("tieneSesionAdmin", () => {
  it("exigirSuperAdmin lanza (sin sesión / no super-admin) → false", async () => {
    vi.mocked(exigirSuperAdmin).mockRejectedValue(new Error("No autorizado."));
    expect(await tieneSesionAdmin()).toBe(false);
  });

  it("actor con aal1 (sin MFA verificado en esta sesión) → false", async () => {
    vi.mocked(exigirSuperAdmin).mockResolvedValue({ ...ACTOR_BASE, aal: "aal1", aalSiguiente: "aal2" });
    expect(await tieneSesionAdmin()).toBe(false);
  });

  it("actor con aal2 → true", async () => {
    vi.mocked(exigirSuperAdmin).mockResolvedValue({ ...ACTOR_BASE, aal: "aal2", aalSiguiente: "aal2" });
    expect(await tieneSesionAdmin()).toBe(true);
  });
});

describe("obtenerRolAdminActual", () => {
  it("sin sesión válida → null", async () => {
    vi.mocked(exigirSuperAdmin).mockRejectedValue(new Error("No autorizado."));
    expect(await obtenerRolAdminActual()).toBeNull();
  });

  it("sesión válida (cualquier AAL) → el rolAdmin del actor", async () => {
    vi.mocked(exigirSuperAdmin).mockResolvedValue({ ...ACTOR_BASE, rolAdmin: "soporte_lectura", aal: "aal1", aalSiguiente: "aal1" });
    expect(await obtenerRolAdminActual()).toBe("soporte_lectura");
  });
});

describe("exigirActorAdmin", () => {
  it("propaga la excepción de exigirSuperAdminEscritura tal cual (drop-in para los callers)", async () => {
    const err = new Error("Tu rol de soporte (solo lectura) no puede realizar esta acción.");
    err.name = "RequierePermisoEscritura";
    vi.mocked(exigirSuperAdminEscritura).mockRejectedValue(err);

    await expect(exigirActorAdmin()).rejects.toBe(err);
  });

  it("sin SUPER_ADMIN_SECRET configurado → lanza aunque el actor sea válido", async () => {
    delete process.env.SUPER_ADMIN_SECRET;
    vi.mocked(exigirSuperAdminEscritura).mockResolvedValue({ ...ACTOR_BASE, aal: "aal2", aalSiguiente: "aal2" });

    await expect(exigirActorAdmin()).rejects.toThrow(/SUPER_ADMIN_SECRET/);
  });

  it("camino feliz: arma { adminSecret, actorUsuarioId, rolAdmin, aal } desde el actor real", async () => {
    vi.mocked(exigirSuperAdminEscritura).mockResolvedValue({ ...ACTOR_BASE, aal: "aal2", aalSiguiente: "aal2" });

    const resultado = await exigirActorAdmin();

    expect(resultado).toEqual({
      adminSecret: process.env.SUPER_ADMIN_SECRET,
      actorUsuarioId: USUARIO_ID,
      rolAdmin: "admin_total",
      aal: "aal2",
    });
  });
});

describe("obtenerSuperAdminsActivos", () => {
  it("lista solo usuario_id/email/nombre, filtrando activo=true", async () => {
    const eqLlamadas: Array<[string, unknown]> = [];
    const q: Record<string, unknown> = {
      schema: vi.fn(() => q),
      from: vi.fn(() => q),
      select: vi.fn(() => q),
      eq: vi.fn((campo: string, valor: unknown) => {
        eqLlamadas.push([campo, valor]);
        return q;
      }),
      order: vi.fn(() =>
        Promise.resolve({
          data: [{ usuario_id: USUARIO_ID, email: "admin@rutax.cl", nombre: "Fundador Rutax" }],
          error: null,
        }),
      ),
    };
    vi.mocked(crearClienteServiceRole).mockReturnValue(q as unknown as ReturnType<typeof crearClienteServiceRole>);

    const resultado = await obtenerSuperAdminsActivos();

    expect(resultado).toEqual([{ usuarioId: USUARIO_ID, email: "admin@rutax.cl", nombre: "Fundador Rutax" }]);
    expect(eqLlamadas).toContainEqual(["activo", true]);
  });
});
