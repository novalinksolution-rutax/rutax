/**
 * Pruebas de las Server Actions de `/registro` (F1, login sin contraseña).
 *
 * Reemplaza las pruebas de `altaDeEmpresa`/`reenviarCorreoActivacion`
 * (retiradas en F1 — ver cabecera de `actions.ts`) por las de las tres
 * acciones nuevas: `guardarBorradorTenant`, `enviarCodigoRegistro` y
 * `verificarCodigoRegistro`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/identidad/borrador-registro", () => ({
  guardarBorrador: vi.fn(),
  leerBorrador: vi.fn(),
  limpiarBorrador: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock("@/modules/identidad/onboarding", () => ({
  buscarPerfilPorAuthUserId: vi.fn(),
  provisionarTenantParaAuthUser: vi.fn(),
  activarPerfilDueno: vi.fn(),
}));

import { guardarBorrador, leerBorrador, limpiarBorrador } from "@/lib/identidad/borrador-registro";
import { createClient } from "@/lib/supabase/server";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  activarPerfilDueno,
  buscarPerfilPorAuthUserId,
  provisionarTenantParaAuthUser,
} from "@/modules/identidad/onboarding";
import { ErrorConflicto } from "@/modules/identidad/errores";
import { enviarCodigoRegistro, guardarBorradorTenant, verificarCodigoRegistro } from "./actions";

const ENTRADA_VALIDA = {
  nombreFantasia: "Despachos Rápidos SpA",
  rut: "76.543.210-3", // cuerpo 76543210 → DV módulo 11 = 3
  nombreDueno: "María Pérez",
  emailDueno: "Dueno@DespachosRapidos.cl",
  aceptaTerminos: true,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("guardarBorradorTenant", () => {
  it("rechaza nombre de fantasía vacío sin guardar la cookie", async () => {
    const resultado = await guardarBorradorTenant({ ...ENTRADA_VALIDA, nombreFantasia: "   " });
    expect(resultado).toMatchObject({ ok: false, campo: "nombreFantasia" });
    expect(guardarBorrador).not.toHaveBeenCalled();
  });

  it("rechaza un RUT con dígito verificador inválido", async () => {
    const resultado = await guardarBorradorTenant({ ...ENTRADA_VALIDA, rut: "76543210-9" });
    expect(resultado).toMatchObject({ ok: false, campo: "rut" });
    expect(guardarBorrador).not.toHaveBeenCalled();
  });

  it("rechaza un correo con formato inválido", async () => {
    const resultado = await guardarBorradorTenant({ ...ENTRADA_VALIDA, emailDueno: "no-es-un-correo" });
    expect(resultado).toMatchObject({ ok: false, campo: "emailDueno" });
  });

  it("🔴 H6: rechaza si no se aceptaron los términos, aunque el resto sea válido", async () => {
    const resultado = await guardarBorradorTenant({ ...ENTRADA_VALIDA, aceptaTerminos: false });
    expect(resultado).toMatchObject({ ok: false, campo: "aceptaTerminos" });
    expect(guardarBorrador).not.toHaveBeenCalled();
  });

  it("con datos válidos, guarda el borrador con el RUT normalizado y el correo en minúsculas", async () => {
    const resultado = await guardarBorradorTenant(ENTRADA_VALIDA);

    expect(resultado).toEqual({ ok: true });
    expect(guardarBorrador).toHaveBeenCalledWith({
      nombreFantasia: "Despachos Rápidos SpA",
      rut: "76543210-3",
      nombreDueno: "María Pérez",
      emailDueno: "dueno@despachosrapidos.cl",
      aceptaTerminos: true,
    });
  });
});

function clienteFalso(opts: { errorEnvio?: { message: string } | null; errorVerify?: { message: string } | null; user?: unknown } = {}) {
  return {
    auth: {
      signInWithOtp: vi.fn(async () => ({ error: opts.errorEnvio ?? null })),
      verifyOtp: vi.fn(async () => ({
        data: { user: opts.errorVerify ? null : (opts.user ?? { id: "auth-user-1" }) },
        error: opts.errorVerify ?? null,
      })),
      refreshSession: vi.fn(async () => ({ data: {}, error: null })),
      signOut: vi.fn(async () => ({ error: null })),
    },
  };
}

describe("enviarCodigoRegistro", () => {
  it("H1: llama a signInWithOtp con shouldCreateUser:true (a diferencia del login)", async () => {
    const supa = clienteFalso();
    vi.mocked(createClient).mockResolvedValue(supa as never);

    await enviarCodigoRegistro("Dueno@Nuevo.cl");

    expect(supa.auth.signInWithOtp).toHaveBeenCalledWith({
      email: "dueno@nuevo.cl",
      options: { shouldCreateUser: true },
    });
  });

  it("rechaza un correo con formato inválido sin llamar a Supabase", async () => {
    const resultado = await enviarCodigoRegistro("no-es-un-correo");
    expect(resultado.ok).toBe(false);
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe("verificarCodigoRegistro", () => {
  beforeEach(() => {
    vi.mocked(crearClienteServiceRole).mockReturnValue({ marcador: "admin" } as never);
  });

  it("código inválido → tipo codigo_invalido, sin tocar el borrador", async () => {
    const supa = clienteFalso({ errorVerify: { message: "token inválido" } });
    vi.mocked(createClient).mockResolvedValue(supa as never);

    const resultado = await verificarCodigoRegistro("dueno@nuevo.cl", "000000");

    expect(resultado).toMatchObject({ ok: false, tipo: "codigo_invalido" });
    expect(buscarPerfilPorAuthUserId).not.toHaveBeenCalled();
  });

  it("sin perfil previo y con borrador: provisiona con estado activo y compensarAuthUser false", async () => {
    const supa = clienteFalso();
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(buscarPerfilPorAuthUserId).mockResolvedValue(null);
    vi.mocked(leerBorrador).mockResolvedValue({
      nombreFantasia: "Despachos Rápidos SpA",
      rut: "76543210-3",
      nombreDueno: "María Pérez",
      emailDueno: "dueno@nuevo.cl",
      aceptaTerminos: true,
    });
    vi.mocked(provisionarTenantParaAuthUser).mockResolvedValue({ tenantId: "t-1", duenoUsuarioId: "auth-user-1" });

    const resultado = await verificarCodigoRegistro("dueno@nuevo.cl", "123456");

    expect(resultado).toEqual({ ok: true });
    expect(provisionarTenantParaAuthUser).toHaveBeenCalledWith(
      expect.anything(),
      "auth-user-1",
      expect.anything(),
      { estado: "activo", compensarAuthUser: false },
    );
    expect(limpiarBorrador).toHaveBeenCalledTimes(1);
    expect(supa.auth.refreshSession).toHaveBeenCalledTimes(1);
  });

  it("🔴 H5 idempotencia: perfil existente interno+dueno ACTIVO → no reprovisiona ni reactiva", async () => {
    const supa = clienteFalso();
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(buscarPerfilPorAuthUserId).mockResolvedValue({
      tenantId: "t-1",
      tipoUsuario: "interno",
      rol: "dueno",
      estado: "activo",
    });

    const resultado = await verificarCodigoRegistro("dueno@nuevo.cl", "123456");

    expect(resultado).toEqual({ ok: true });
    expect(provisionarTenantParaAuthUser).not.toHaveBeenCalled();
    expect(activarPerfilDueno).not.toHaveBeenCalled();
    expect(limpiarBorrador).toHaveBeenCalledTimes(1);
  });

  it("🔴 caso de borde: perfil interno+dueno pero INVITADO (colisión con invitación del backstage) → se activa igual, evitando el bucle", async () => {
    const supa = clienteFalso();
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(buscarPerfilPorAuthUserId).mockResolvedValue({
      tenantId: "t-1",
      tipoUsuario: "interno",
      rol: "dueno",
      estado: "invitado",
    });

    const resultado = await verificarCodigoRegistro("dueno@nuevo.cl", "123456");

    expect(resultado).toEqual({ ok: true });
    expect(activarPerfilDueno).toHaveBeenCalledWith(expect.anything(), "auth-user-1");
  });

  it("🔴 H2 un correo, una cuenta: perfil existente de OTRO tipo → correo_ocupado, cierra sesión", async () => {
    const supa = clienteFalso();
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(buscarPerfilPorAuthUserId).mockResolvedValue({
      tenantId: "t-9",
      tipoUsuario: "conductor",
      rol: "conductor",
      estado: "activo",
    });

    const resultado = await verificarCodigoRegistro("conductor@otro.cl", "123456");

    expect(resultado).toMatchObject({ ok: false, tipo: "correo_ocupado" });
    expect(provisionarTenantParaAuthUser).not.toHaveBeenCalled();
    expect(supa.auth.signOut).toHaveBeenCalledTimes(1);
  });

  it("sin perfil y sin borrador (venció) → sin_borrador, cierra sesión", async () => {
    const supa = clienteFalso();
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(buscarPerfilPorAuthUserId).mockResolvedValue(null);
    vi.mocked(leerBorrador).mockResolvedValue(null);

    const resultado = await verificarCodigoRegistro("dueno@nuevo.cl", "123456");

    expect(resultado).toMatchObject({ ok: false, tipo: "sin_borrador" });
    expect(supa.auth.signOut).toHaveBeenCalledTimes(1);
  });

  it("RUT duplicado al provisionar → conflicto_rut", async () => {
    const supa = clienteFalso();
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(buscarPerfilPorAuthUserId).mockResolvedValue(null);
    vi.mocked(leerBorrador).mockResolvedValue({
      nombreFantasia: "X",
      rut: "76543210-3",
      nombreDueno: "Otro",
      emailDueno: "otro@nuevo.cl",
      aceptaTerminos: true,
    });
    vi.mocked(provisionarTenantParaAuthUser).mockRejectedValue(
      new ErrorConflicto("Ya existe un courier registrado con el RUT 76543210-3."),
    );

    const resultado = await verificarCodigoRegistro("otro@nuevo.cl", "123456");

    expect(resultado).toMatchObject({ ok: false, tipo: "conflicto_rut" });
    expect(supa.auth.signOut).toHaveBeenCalledTimes(1);
  });

  it("falla desconocida al provisionar → tipo desconocido, sin filtrar el detalle técnico", async () => {
    const supa = clienteFalso();
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(buscarPerfilPorAuthUserId).mockResolvedValue(null);
    vi.mocked(leerBorrador).mockResolvedValue({
      nombreFantasia: "X",
      rut: "76543210-3",
      nombreDueno: "Otro",
      emailDueno: "otro@nuevo.cl",
      aceptaTerminos: true,
    });
    vi.mocked(provisionarTenantParaAuthUser).mockRejectedValue(new Error("boom interno de infraestructura"));

    const resultado = await verificarCodigoRegistro("otro@nuevo.cl", "123456");

    expect(resultado).toMatchObject({ ok: false, tipo: "desconocido" });
    if (!resultado.ok) {
      expect(resultado.mensaje).not.toContain("boom");
    }
  });
});
