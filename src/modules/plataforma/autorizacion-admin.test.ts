import { AREAS_PRODUCTO } from "@/modules/identidad/areas-producto";
/**
 * Tests de `autorizacion-admin.ts` — el "dual-gate" real de F3-A:
 * - `resolverSuperAdminActivo`: lectura fresca `service_role` de
 *   `plataforma.super_admins` (null si no existe o `activo=false`).
 * - `exigirSuperAdmin`: sesión real + `esSuperAdminDePlataforma` + gobernanza
 *   activa + AAL resuelto (sin exigir un nivel particular).
 * - `exigirSuperAdminEscritura`: además exige `rolAdmin==='admin_total'` y
 *   `aal==='aal2'`.
 *
 * El runtime de Supabase (MFA, sesión SSR) se mockea — no hay entorno real de
 * Auth disponible en Vitest.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/identidad/usuario-actual-servidor", () => ({
  obtenerSesionActual: vi.fn(),
}));

import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { createClient } from "@/lib/supabase/server";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import type { SesionActual } from "@/lib/identidad/usuario-actual-servidor";
import type { UsuarioActual } from "@/modules/identidad/usuario-actual";
import {
  resolverSuperAdminActivo,
  exigirSuperAdmin,
  exigirSuperAdminEscritura,
  NoAutorizadoAdmin,
  RequierePermisoEscritura,
  RequiereAal2,
} from "./autorizacion-admin";

const USUARIO_ID = "ad000000-0000-0000-0000-000000000001";

/** Builder mínimo para las queries de lectura de `plataforma.super_admins`. */
function crearMockSupabaseSuperAdmins(respuesta: { data: unknown; error: unknown }) {
  const eqLlamadas: Array<[string, unknown]> = [];
  const q: Record<string, unknown> = {
    schema: vi.fn(() => q),
    from: vi.fn(() => q),
    select: vi.fn(() => q),
    eq: vi.fn((campo: string, valor: unknown) => {
      eqLlamadas.push([campo, valor]);
      return q;
    }),
    maybeSingle: vi.fn(() => Promise.resolve(respuesta)),
  };
  return { q, eqLlamadas };
}

/** Mock del cliente SSR (`@/lib/supabase/server`) — solo lo que toca `exigirSuperAdmin`. */
function mockClienteSsr(respuestaAal: { data: unknown; error: unknown }) {
  const getAuthenticatorAssuranceLevel = vi.fn(() => Promise.resolve(respuestaAal));
  vi.mocked(createClient).mockResolvedValue({
    auth: { mfa: { getAuthenticatorAssuranceLevel } },
  } as unknown as Awaited<ReturnType<typeof createClient>>);
  return { getAuthenticatorAssuranceLevel };
}

function usuarioSuperAdmin(overrides: Partial<UsuarioActual> = {}): UsuarioActual {
  return {
    tenantId: null,
    tipoUsuario: "super_admin",
    sellerId: null,
    driverId: null,
    rol: "super_admin",
    estado: "activo",
    ...overrides,
    areasHabilitadas: overrides.areasHabilitadas ?? [...AREAS_PRODUCTO],
  };
}

function mockSesion(sesion: SesionActual | null) {
  vi.mocked(obtenerSesionActual).mockResolvedValue(sesion);
}

const SESION_SUPER_ADMIN: SesionActual = {
  usuarioId: USUARIO_ID,
  email: "admin@rutax.cl",
  nombreCompleto: "Fundador Rutax",
  usuario: usuarioSuperAdmin(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolverSuperAdminActivo", () => {
  it("usuarioId vacío → null, sin tocar la BD", async () => {
    expect(await resolverSuperAdminActivo("")).toBeNull();
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });

  it("fila no encontrada → null", async () => {
    const { q } = crearMockSupabaseSuperAdmins({ data: null, error: null });
    vi.mocked(crearClienteServiceRole).mockReturnValue(q as unknown as ReturnType<typeof crearClienteServiceRole>);

    expect(await resolverSuperAdminActivo(USUARIO_ID)).toBeNull();
  });

  it("fila existe pero activo=false → null (revocación inmediata)", async () => {
    const { q } = crearMockSupabaseSuperAdmins({
      data: { usuario_id: USUARIO_ID, email: "admin@rutax.cl", nombre: "Fundador", rol_admin: "admin_total", activo: false },
      error: null,
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(q as unknown as ReturnType<typeof crearClienteServiceRole>);

    expect(await resolverSuperAdminActivo(USUARIO_ID)).toBeNull();
  });

  it("fila activa → devuelve usuarioId/email/nombre/rolAdmin", async () => {
    const { q, eqLlamadas } = crearMockSupabaseSuperAdmins({
      data: {
        usuario_id: USUARIO_ID,
        email: "admin@rutax.cl",
        nombre: "Fundador Rutax",
        rol_admin: "soporte_lectura",
        activo: true,
      },
      error: null,
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(q as unknown as ReturnType<typeof crearClienteServiceRole>);

    const resultado = await resolverSuperAdminActivo(USUARIO_ID);

    expect(resultado).toEqual({
      usuarioId: USUARIO_ID,
      email: "admin@rutax.cl",
      nombre: "Fundador Rutax",
      rolAdmin: "soporte_lectura",
    });
    expect(eqLlamadas).toContainEqual(["usuario_id", USUARIO_ID]);
  });

  it("error de BD → lanza", async () => {
    const { q } = crearMockSupabaseSuperAdmins({ data: null, error: { message: "boom" } });
    vi.mocked(crearClienteServiceRole).mockReturnValue(q as unknown as ReturnType<typeof crearClienteServiceRole>);

    await expect(resolverSuperAdminActivo(USUARIO_ID)).rejects.toThrow(/error al validar super-admin/i);
  });
});

describe("exigirSuperAdmin", () => {
  it("sin sesión → NoAutorizadoAdmin", async () => {
    mockSesion(null);
    await expect(exigirSuperAdmin()).rejects.toBeInstanceOf(NoAutorizadoAdmin);
  });

  it("sesión de un rol que no es super_admin → NoAutorizadoAdmin (no llega a consultar gobernanza)", async () => {
    mockSesion({
      usuarioId: USUARIO_ID,
      email: "dueno@courier.cl",
      nombreCompleto: "Dueño Courier",
      usuario: { tenantId: "tenant-1", tipoUsuario: "interno", sellerId: null, driverId: null, rol: "dueno", estado: "activo", areasHabilitadas: [...AREAS_PRODUCTO] },
    });

    await expect(exigirSuperAdmin()).rejects.toBeInstanceOf(NoAutorizadoAdmin);
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });

  it("super_admin en el JWT pero SIN fila activa en plataforma.super_admins → NoAutorizadoAdmin (revocado)", async () => {
    mockSesion(SESION_SUPER_ADMIN);
    const { q } = crearMockSupabaseSuperAdmins({ data: null, error: null });
    vi.mocked(crearClienteServiceRole).mockReturnValue(q as unknown as ReturnType<typeof crearClienteServiceRole>);

    await expect(exigirSuperAdmin()).rejects.toBeInstanceOf(NoAutorizadoAdmin);
  });

  it("error al resolver el AAL de la sesión → NoAutorizadoAdmin (fail-closed)", async () => {
    mockSesion(SESION_SUPER_ADMIN);
    const { q } = crearMockSupabaseSuperAdmins({
      data: { usuario_id: USUARIO_ID, email: "admin@rutax.cl", nombre: "Fundador", rol_admin: "admin_total", activo: true },
      error: null,
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(q as unknown as ReturnType<typeof crearClienteServiceRole>);
    mockClienteSsr({ data: null, error: { message: "no session" } });

    await expect(exigirSuperAdmin()).rejects.toBeInstanceOf(NoAutorizadoAdmin);
  });

  it("camino feliz, sin MFA enrolado: aal='aal1', aalSiguiente='aal1'", async () => {
    mockSesion(SESION_SUPER_ADMIN);
    const { q } = crearMockSupabaseSuperAdmins({
      data: { usuario_id: USUARIO_ID, email: "admin@rutax.cl", nombre: "Fundador Rutax", rol_admin: "admin_total", activo: true },
      error: null,
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(q as unknown as ReturnType<typeof crearClienteServiceRole>);
    mockClienteSsr({ data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null });

    const actor = await exigirSuperAdmin();

    expect(actor).toEqual({
      usuarioId: USUARIO_ID,
      email: "admin@rutax.cl",
      nombre: "Fundador Rutax",
      rolAdmin: "admin_total",
      aal: "aal1",
      aalSiguiente: "aal1",
    });
  });

  it("camino feliz, con factor enrolado pendiente de step-up: aal='aal1', aalSiguiente='aal2'", async () => {
    mockSesion(SESION_SUPER_ADMIN);
    const { q } = crearMockSupabaseSuperAdmins({
      data: { usuario_id: USUARIO_ID, email: "admin@rutax.cl", nombre: "Fundador Rutax", rol_admin: "admin_total", activo: true },
      error: null,
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(q as unknown as ReturnType<typeof crearClienteServiceRole>);
    mockClienteSsr({ data: { currentLevel: "aal1", nextLevel: "aal2" }, error: null });

    const actor = await exigirSuperAdmin();

    expect(actor.aal).toBe("aal1");
    expect(actor.aalSiguiente).toBe("aal2");
  });

  it("camino feliz, MFA verificado en esta sesión: aal='aal2'", async () => {
    mockSesion(SESION_SUPER_ADMIN);
    const { q } = crearMockSupabaseSuperAdmins({
      data: { usuario_id: USUARIO_ID, email: "admin@rutax.cl", nombre: "Fundador Rutax", rol_admin: "admin_total", activo: true },
      error: null,
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(q as unknown as ReturnType<typeof crearClienteServiceRole>);
    mockClienteSsr({ data: { currentLevel: "aal2", nextLevel: "aal2" }, error: null });

    const actor = await exigirSuperAdmin();

    expect(actor.aal).toBe("aal2");
    expect(actor.aalSiguiente).toBe("aal2");
  });
});

describe("exigirSuperAdminEscritura", () => {
  function mockCaminoBase(rolAdmin: "admin_total" | "soporte_lectura", aal: "aal1" | "aal2") {
    mockSesion(SESION_SUPER_ADMIN);
    const { q } = crearMockSupabaseSuperAdmins({
      data: { usuario_id: USUARIO_ID, email: "admin@rutax.cl", nombre: "Fundador Rutax", rol_admin: rolAdmin, activo: true },
      error: null,
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(q as unknown as ReturnType<typeof crearClienteServiceRole>);
    mockClienteSsr({ data: { currentLevel: aal, nextLevel: "aal2" }, error: null });
  }

  it("soporte_lectura, aunque tenga aal2 → RequierePermisoEscritura", async () => {
    mockCaminoBase("soporte_lectura", "aal2");
    await expect(exigirSuperAdminEscritura()).rejects.toBeInstanceOf(RequierePermisoEscritura);
  });

  it("admin_total sin MFA verificado (aal1) → RequiereAal2", async () => {
    mockCaminoBase("admin_total", "aal1");
    await expect(exigirSuperAdminEscritura()).rejects.toBeInstanceOf(RequiereAal2);
  });

  it("admin_total + aal2 → devuelve el actor completo", async () => {
    mockCaminoBase("admin_total", "aal2");
    const actor = await exigirSuperAdminEscritura();
    expect(actor.rolAdmin).toBe("admin_total");
    expect(actor.aal).toBe("aal2");
    expect(actor.usuarioId).toBe(USUARIO_ID);
  });
});
