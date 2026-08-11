/**
 * Pruebas de `restablecerContrasena` — paso 2 de la recuperación.
 *
 * Foco: exige sesión, valida el largo, deja rastro en bitácora con su autor
 * (RNF-04), y —lo que más importa— NO toca `usuarios_perfil.estado`, para que
 * "olvidé mi contraseña" no sea una puerta trasera que reactive una cuenta
 * suspendida.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ crearClienteServiceRole: vi.fn() }));
vi.mock("@/modules/identidad/auditoria", () => ({ registrarEnBitacora: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { restablecerContrasena } from "./actions";

const USUARIO_ID = "11111111-1111-1111-1111-111111111111";
const TENANT_ID = "22222222-2222-2222-2222-222222222222";

/** Registra las tablas tocadas por el cliente service_role, para poder afirmar sobre ellas. */
let tablasTocadas: string[];
let updateSpy: ReturnType<typeof vi.fn>;

function mockSesion(user: { id: string } | null, updateUserError: unknown = null) {
  const updateUser = vi.fn().mockResolvedValue({ error: updateUserError });
  vi.mocked(createClient).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user } }),
      updateUser,
    },
  } as unknown as Awaited<ReturnType<typeof createClient>>);
  return updateUser;
}

function mockAdmin(perfil: { tenant_id: string | null; rol: string } | null = { tenant_id: TENANT_ID, rol: "dueno" }) {
  updateSpy = vi.fn();
  vi.mocked(crearClienteServiceRole).mockReturnValue({
    from: vi.fn((tabla: string) => {
      tablasTocadas.push(tabla);
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: perfil, error: null }) }),
        }),
        update: updateSpy.mockReturnValue({
          eq: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ maybeSingle: vi.fn() }) }),
        }),
      };
    }),
  } as unknown as ReturnType<typeof crearClienteServiceRole>);
}

beforeEach(() => {
  vi.clearAllMocks();
  tablasTocadas = [];
  mockAdmin();
});

describe("validación", () => {
  it("rechaza contraseñas de menos de 8 caracteres", async () => {
    mockSesion({ id: USUARIO_ID });
    const r = await restablecerContrasena({ contrasena: "corta" });
    expect(r).toMatchObject({ ok: false, tipo: "validacion" });
  });

  it("no llama a Auth si la contraseña es muy corta", async () => {
    const updateUser = mockSesion({ id: USUARIO_ID });
    await restablecerContrasena({ contrasena: "1234567" });
    expect(updateUser).not.toHaveBeenCalled();
  });
});

describe("exige sesión", () => {
  it("falla con sin_sesion cuando el enlace ya no es válido", async () => {
    mockSesion(null);
    const r = await restablecerContrasena({ contrasena: "unaClaveLarga1" });
    expect(r).toMatchObject({ ok: false, tipo: "sin_sesion" });
    expect(registrarEnBitacora).not.toHaveBeenCalled();
  });
});

describe("camino feliz", () => {
  it("cambia la contraseña y responde ok", async () => {
    const updateUser = mockSesion({ id: USUARIO_ID });
    const r = await restablecerContrasena({ contrasena: "unaClaveLarga1" });
    expect(r).toEqual({ ok: true });
    expect(updateUser).toHaveBeenCalledWith({ password: "unaClaveLarga1" });
  });

  it("deja rastro en bitácora con el autor y el tenant", async () => {
    mockSesion({ id: USUARIO_ID });
    await restablecerContrasena({ contrasena: "unaClaveLarga1" });

    expect(registrarEnBitacora).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: TENANT_ID,
        actorUsuarioId: USUARIO_ID,
        accion: "usuario.contrasena_restablecida",
        entidadId: USUARIO_ID,
      }),
    );
  });

  it("NO escribe la contraseña ni ningún secreto en el detalle de la bitácora", async () => {
    mockSesion({ id: USUARIO_ID });
    await restablecerContrasena({ contrasena: "unaClaveLarga1" });

    const detalle = JSON.stringify(vi.mocked(registrarEnBitacora).mock.calls[0]?.[1]?.detalle ?? {});
    expect(detalle).not.toContain("unaClaveLarga1");
  });
});

describe("no es una puerta trasera de reactivación", () => {
  it("NUNCA hace UPDATE sobre usuarios_perfil — el estado no se toca", async () => {
    mockSesion({ id: USUARIO_ID });
    await restablecerContrasena({ contrasena: "unaClaveLarga1" });

    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("solo lee usuarios_perfil y escribe bitacora_auditoria", async () => {
    mockSesion({ id: USUARIO_ID });
    await restablecerContrasena({ contrasena: "unaClaveLarga1" });

    expect(tablasTocadas).toEqual(["usuarios_perfil"]);
  });
});

describe("fallo al guardar", () => {
  it("no registra en bitácora si Auth rechazó el cambio", async () => {
    mockSesion({ id: USUARIO_ID }, { message: "weak password" });
    const r = await restablecerContrasena({ contrasena: "unaClaveLarga1" });

    expect(r).toMatchObject({ ok: false, tipo: "desconocido" });
    expect(registrarEnBitacora).not.toHaveBeenCalled();
  });
});
