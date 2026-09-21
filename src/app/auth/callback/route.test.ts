import { NextRequest } from "next/server";
/**
 * Pruebas del callback PKCE de Google — `GET /auth/callback` (F1).
 *
 * Cubre las dos bifurcaciones del contrato (ver cabecera de `route.ts`):
 *   - REGISTRO (hay borrador): provisiona, detecta H2/H5, compensa con el
 *     criterio de H3.
 *   - LOGIN (sin borrador): exige perfil existente, limpia huérfanos.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock("@/lib/identidad/borrador-registro", () => ({
  leerBorrador: vi.fn(),
  limpiarBorrador: vi.fn(),
}));

vi.mock("@/lib/identidad/borrador-invitacion", () => ({
  leerBorrador: vi.fn(),
  limpiarBorrador: vi.fn(),
}));

vi.mock("@/lib/identidad/borrador-registro-seller", () => ({
  leerBorrador: vi.fn(),
  limpiarBorrador: vi.fn(),
}));

vi.mock("@/lib/identidad/borrador-wizard-seller", () => ({
  guardarBorrador: vi.fn(),
}));

vi.mock("@/modules/identidad/onboarding", () => ({
  buscarPerfilPorAuthUserId: vi.fn(),
  provisionarTenantParaAuthUser: vi.fn(),
  activarPerfilDueno: vi.fn(),
}));

vi.mock("@/modules/identidad/aceptacion-invitacion-passwordless", () => ({
  buscarInvitacionPorToken: vi.fn(),
  aplicarAceptacionInvitacionPasswordless: vi.fn(),
}));

vi.mock("@/modules/identidad/barrera-auto-registro-seller", () => ({
  verificarBarreraAutoRegistroSeller: vi.fn(),
}));

vi.mock("@/modules/identidad/seller-membresias", () => ({
  cambiarCourierActivo: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { leerBorrador, limpiarBorrador } from "@/lib/identidad/borrador-registro";
import {
  leerBorrador as leerBorradorInvitacion,
  limpiarBorrador as limpiarBorradorInvitacion,
} from "@/lib/identidad/borrador-invitacion";
import {
  leerBorrador as leerBorradorRegistroSeller,
  limpiarBorrador as limpiarBorradorRegistroSeller,
} from "@/lib/identidad/borrador-registro-seller";
import { guardarBorrador as guardarBorradorWizardSeller } from "@/lib/identidad/borrador-wizard-seller";
import {
  activarPerfilDueno,
  buscarPerfilPorAuthUserId,
  provisionarTenantParaAuthUser,
} from "@/modules/identidad/onboarding";
import {
  aplicarAceptacionInvitacionPasswordless,
  buscarInvitacionPorToken,
} from "@/modules/identidad/aceptacion-invitacion-passwordless";
import { verificarBarreraAutoRegistroSeller } from "@/modules/identidad/barrera-auto-registro-seller";
import { cambiarCourierActivo } from "@/modules/identidad/seller-membresias";
import { ErrorConflicto } from "@/modules/identidad/errores";
import { GET } from "./route";

const AUTH_USER_ID = "11111111-1111-1111-1111-111111111111";

const BORRADOR = {
  nombreFantasia: "Despachos Rápidos SpA",
  rut: "76543210-3",
  nombreDueno: "María Pérez",
  emailDueno: "dueno@despachosrapidos.cl",
  aceptaTerminos: true as const,
};

function usuarioAuth(overrides: Partial<{ created_at: string; last_sign_in_at: string | null }> = {}) {
  return {
    id: AUTH_USER_ID,
    email: "dueno@despachosrapidos.cl",
    created_at: overrides.created_at ?? new Date().toISOString(),
    last_sign_in_at: overrides.last_sign_in_at ?? new Date().toISOString(),
  };
}

function clienteSupabaseFalso(opts: { user: unknown; errorCanje?: { message: string } | null }) {
  return {
    auth: {
      exchangeCodeForSession: vi.fn(async () => ({ error: opts.errorCanje ?? null })),
      getUser: vi.fn(async () => ({ data: { user: opts.user } })),
      signOut: vi.fn(async () => ({ error: null })),
      refreshSession: vi.fn(async () => ({ data: {}, error: null })),
    },
  };
}

function adminFalso() {
  return { auth: { admin: { deleteUser: vi.fn(async () => ({ error: null })) } } };
}

function peticion(params: { code?: string; cookies?: string } = {}) {
  const query = new URLSearchParams();
  if (params.code !== undefined) query.set("code", params.code);
  // NextRequest de verdad y no un Request casteado: el callback lee
  // `request.cookies` para el diagnóstico del canje, y un Request a secas no
  // las tiene. El casteo escondía eso y la prueba caía con un TypeError que
  // parecía un bug de producción.
  const cabeceras = params.cookies ? { cookie: params.cookies } : undefined;
  return new NextRequest(`http://localhost/auth/callback?${query.toString()}`, { headers: cabeceras });
}

function destino(res: Response): { ruta: string; error: string | null } {
  const url = new URL(res.headers.get("location") ?? "");
  return { ruta: url.pathname, error: url.searchParams.get("error") };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(leerBorrador).mockResolvedValue(null);
  vi.mocked(limpiarBorrador).mockResolvedValue(undefined);
  vi.mocked(leerBorradorInvitacion).mockResolvedValue(null);
  vi.mocked(limpiarBorradorInvitacion).mockResolvedValue(undefined);
  vi.mocked(leerBorradorRegistroSeller).mockResolvedValue(null);
  vi.mocked(limpiarBorradorRegistroSeller).mockResolvedValue(undefined);
  vi.mocked(guardarBorradorWizardSeller).mockResolvedValue(undefined);
  vi.mocked(crearClienteServiceRole).mockReturnValue(adminFalso() as never);
});

describe("GET /auth/callback — sin `code`", () => {
  it("redirige a /login?error=oauth_invalido sin canjear nada", async () => {
    const res = await GET(peticion());
    expect(destino(res)).toEqual({ ruta: "/login", error: "oauth_invalido" });
  });
});

describe("GET /auth/callback — el canje falla", () => {
  it("redirige a /login?error=oauth_invalido", async () => {
    const supa = clienteSupabaseFalso({ user: usuarioAuth(), errorCanje: { message: "code inválido" } });
    vi.mocked(createClient).mockResolvedValue(supa as never);

    const res = await GET(peticion({ code: "un-code" }));
    expect(destino(res)).toEqual({ ruta: "/login", error: "oauth_invalido" });
  });
});

describe("GET /auth/callback — camino LOGIN (sin borrador)", () => {
  it("con perfil existente ACTIVO: refresca la sesión y va a /, sin activar nada", async () => {
    const supa = clienteSupabaseFalso({ user: usuarioAuth() });
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(buscarPerfilPorAuthUserId).mockResolvedValue({
      tenantId: "t-1",
      tipoUsuario: "interno",
      rol: "dueno",
      estado: "activo",
    });

    const res = await GET(peticion({ code: "un-code" }));

    expect(destino(res)).toEqual({ ruta: "/", error: null });
    expect(supa.auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(supa.auth.signOut).not.toHaveBeenCalled();
    expect(activarPerfilDueno).not.toHaveBeenCalled();
  });

  it("🔴 caso de borde: perfil existente pero INVITADO (dueño del backstage que entra por Google antes de aceptar su enlace) → se activa en el mismo paso, evitando el bucle /login↔/dashboard", async () => {
    const supa = clienteSupabaseFalso({ user: usuarioAuth() });
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(buscarPerfilPorAuthUserId).mockResolvedValue({
      tenantId: "t-1",
      tipoUsuario: "interno",
      rol: "dueno",
      estado: "invitado",
    });

    const res = await GET(peticion({ code: "un-code" }));

    expect(activarPerfilDueno).toHaveBeenCalledWith(expect.anything(), AUTH_USER_ID);
    expect(destino(res)).toEqual({ ruta: "/", error: null });
  });

  it("sin perfil: cierra sesión, borra el huérfano y va a /login?error=sin_cuenta", async () => {
    const supa = clienteSupabaseFalso({ user: usuarioAuth() });
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(buscarPerfilPorAuthUserId).mockResolvedValue(null);
    const admin = adminFalso();
    vi.mocked(crearClienteServiceRole).mockReturnValue(admin as never);

    const res = await GET(peticion({ code: "un-code" }));

    expect(destino(res)).toEqual({ ruta: "/login", error: "sin_cuenta" });
    expect(supa.auth.signOut).toHaveBeenCalledTimes(1);
    expect(admin.auth.admin.deleteUser).toHaveBeenCalledWith(AUTH_USER_ID);
  });
});

describe("GET /auth/callback — camino REGISTRO (hay borrador)", () => {
  it("sin perfil previo: provisiona con estado activo y compensarAuthUser false, limpia el borrador y va a /", async () => {
    const supa = clienteSupabaseFalso({ user: usuarioAuth() });
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(leerBorrador).mockResolvedValue(BORRADOR);
    vi.mocked(buscarPerfilPorAuthUserId).mockResolvedValue(null);
    vi.mocked(provisionarTenantParaAuthUser).mockResolvedValue({ tenantId: "t-1", duenoUsuarioId: AUTH_USER_ID });

    const res = await GET(peticion({ code: "un-code" }));

    expect(provisionarTenantParaAuthUser).toHaveBeenCalledWith(
      expect.anything(),
      AUTH_USER_ID,
      expect.objectContaining({
        tenant: { nombreFantasia: BORRADOR.nombreFantasia, rut: BORRADOR.rut },
        dueno: { email: BORRADOR.emailDueno, nombreCompleto: BORRADOR.nombreDueno },
      }),
      { estado: "activo", compensarAuthUser: false },
    );
    expect(limpiarBorrador).toHaveBeenCalledTimes(1);
    expect(supa.auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(destino(res)).toEqual({ ruta: "/", error: null });
  });

  it("🔴 H5 idempotencia: perfil existente interno+dueno ACTIVO → NO reprovisiona ni reactiva, limpia borrador y va a /", async () => {
    const supa = clienteSupabaseFalso({ user: usuarioAuth() });
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(leerBorrador).mockResolvedValue(BORRADOR);
    vi.mocked(buscarPerfilPorAuthUserId).mockResolvedValue({
      tenantId: "t-1",
      tipoUsuario: "interno",
      rol: "dueno",
      estado: "activo",
    });

    const res = await GET(peticion({ code: "un-code" }));

    expect(provisionarTenantParaAuthUser).not.toHaveBeenCalled();
    expect(activarPerfilDueno).not.toHaveBeenCalled();
    expect(limpiarBorrador).toHaveBeenCalledTimes(1);
    expect(destino(res)).toEqual({ ruta: "/", error: null });
  });

  it("🔴 H2 un correo, una cuenta: perfil existente de OTRO tipo → correo_ocupado, sin provisionar ni borrar el auth user", async () => {
    const supa = clienteSupabaseFalso({ user: usuarioAuth() });
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(leerBorrador).mockResolvedValue(BORRADOR);
    vi.mocked(buscarPerfilPorAuthUserId).mockResolvedValue({
      tenantId: "t-9",
      tipoUsuario: "seller",
      rol: "seller",
      estado: "activo",
    });
    const admin = adminFalso();
    vi.mocked(crearClienteServiceRole).mockReturnValue(admin as never);

    const res = await GET(peticion({ code: "un-code" }));

    expect(provisionarTenantParaAuthUser).not.toHaveBeenCalled();
    expect(supa.auth.signOut).toHaveBeenCalledTimes(1);
    expect(admin.auth.admin.deleteUser).not.toHaveBeenCalled();
    expect(destino(res)).toEqual({ ruta: "/registro", error: "correo_ocupado" });
  });

  it("🔴 H3: provisión falla con identidad RECIÉN creada → borra el usuario Auth huérfano", async () => {
    const supa = clienteSupabaseFalso({ user: usuarioAuth({ created_at: new Date().toISOString(), last_sign_in_at: new Date().toISOString() }) });
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(leerBorrador).mockResolvedValue(BORRADOR);
    vi.mocked(buscarPerfilPorAuthUserId).mockResolvedValue(null);
    vi.mocked(provisionarTenantParaAuthUser).mockRejectedValue(new Error("fallo de infraestructura"));
    const admin = adminFalso();
    vi.mocked(crearClienteServiceRole).mockReturnValue(admin as never);

    const res = await GET(peticion({ code: "un-code" }));

    expect(supa.auth.signOut).toHaveBeenCalledTimes(1);
    expect(admin.auth.admin.deleteUser).toHaveBeenCalledWith(AUTH_USER_ID);
    expect(destino(res)).toEqual({ ruta: "/registro", error: "error_sistema" });
  });

  it("🔴 H3: provisión falla con identidad ANTIGUA (created_at lejano) → NO borra el usuario Auth", async () => {
    const antiguo = usuarioAuth({
      created_at: new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString(),
      last_sign_in_at: new Date().toISOString(),
    });
    const supa = clienteSupabaseFalso({ user: antiguo });
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(leerBorrador).mockResolvedValue(BORRADOR);
    vi.mocked(buscarPerfilPorAuthUserId).mockResolvedValue(null);
    vi.mocked(provisionarTenantParaAuthUser).mockRejectedValue(new Error("fallo de infraestructura"));
    const admin = adminFalso();
    vi.mocked(crearClienteServiceRole).mockReturnValue(admin as never);

    const res = await GET(peticion({ code: "un-code" }));

    expect(supa.auth.signOut).toHaveBeenCalledTimes(1);
    expect(admin.auth.admin.deleteUser).not.toHaveBeenCalled();
    expect(destino(res)).toEqual({ ruta: "/registro", error: "error_sistema" });
  });

  it("RUT duplicado (ErrorConflicto con 'rut' en el mensaje) → error=conflicto_rut", async () => {
    const supa = clienteSupabaseFalso({ user: usuarioAuth() });
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(leerBorrador).mockResolvedValue(BORRADOR);
    vi.mocked(buscarPerfilPorAuthUserId).mockResolvedValue(null);
    vi.mocked(provisionarTenantParaAuthUser).mockRejectedValue(
      new ErrorConflicto("Ya existe un courier registrado con el RUT 76543210-3."),
    );

    const res = await GET(peticion({ code: "un-code" }));

    expect(destino(res)).toEqual({ ruta: "/registro", error: "conflicto_rut" });
  });
});

describe("GET /auth/callback — camino ACEPTACIÓN (F3, hay borrador de invitación)", () => {
  const BORRADOR_INVITACION = { token: "tok-invitacion-1" };

  it("va PRIMERO: con borrador de invitación presente, ni siquiera mira el borrador de registro", async () => {
    const supa = clienteSupabaseFalso({ user: usuarioAuth({}) });
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(leerBorradorInvitacion).mockResolvedValue(BORRADOR_INVITACION);
    vi.mocked(buscarInvitacionPorToken).mockResolvedValue({ email: "dueno@despachosrapidos.cl", rol: "supervisor" });
    vi.mocked(aplicarAceptacionInvitacionPasswordless).mockResolvedValue({
      tenantId: "t-1",
      rol: "supervisor",
      destino: "/",
    });

    await GET(peticion({ code: "un-code" }));

    expect(leerBorrador).not.toHaveBeenCalled();
    expect(provisionarTenantParaAuthUser).not.toHaveBeenCalled();
  });

  it("seller: acepta y redirige al destino que devuelve la aceptación (/portal/conectar-ml)", async () => {
    const supa = clienteSupabaseFalso({ user: usuarioAuth({}) });
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(leerBorradorInvitacion).mockResolvedValue({
      token: "tok-seller",
      optInWhatsApp: true,
      telefonoWhatsApp: "+56912345678",
    });
    vi.mocked(buscarInvitacionPorToken).mockResolvedValue({ email: "dueno@despachosrapidos.cl", rol: "seller" });
    vi.mocked(aplicarAceptacionInvitacionPasswordless).mockResolvedValue({
      tenantId: "t-1",
      rol: "seller",
      destino: "/portal/conectar-ml",
    });

    const res = await GET(peticion({ code: "un-code" }));

    expect(aplicarAceptacionInvitacionPasswordless).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        token: "tok-seller",
        usuarioAuthId: AUTH_USER_ID,
        whatsapp: { telefono: "+56912345678", acepta: true },
      }),
    );
    expect(limpiarBorradorInvitacion).toHaveBeenCalledTimes(1);
    expect(supa.auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(destino(res)).toEqual({ ruta: "/portal/conectar-ml", error: null });
  });

  it("interno: acepta y redirige a / ", async () => {
    const supa = clienteSupabaseFalso({ user: usuarioAuth({}) });
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(leerBorradorInvitacion).mockResolvedValue(BORRADOR_INVITACION);
    vi.mocked(buscarInvitacionPorToken).mockResolvedValue({ email: "dueno@despachosrapidos.cl", rol: "supervisor" });
    vi.mocked(aplicarAceptacionInvitacionPasswordless).mockResolvedValue({
      tenantId: "t-1",
      rol: "supervisor",
      destino: "/",
    });

    const res = await GET(peticion({ code: "un-code" }));

    expect(destino(res)).toEqual({ ruta: "/", error: null });
  });

  it("🔴 el correo de Google NO calza con el de la invitación → email_no_calza, sin aceptar nada", async () => {
    const supa = clienteSupabaseFalso({ user: usuarioAuth({}) });
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(leerBorradorInvitacion).mockResolvedValue({ token: "tok-otro-correo" });
    vi.mocked(buscarInvitacionPorToken).mockResolvedValue({ email: "otra-persona@ejemplo.cl", rol: "supervisor" });

    const res = await GET(peticion({ code: "un-code" }));

    expect(aplicarAceptacionInvitacionPasswordless).not.toHaveBeenCalled();
    expect(supa.auth.signOut).toHaveBeenCalledTimes(1);
    expect(limpiarBorradorInvitacion).toHaveBeenCalledTimes(1);
    expect(destino(res)).toEqual({ ruta: "/invitacion/tok-otro-correo", error: "email_no_calza" });
  });

  it("token de invitación inválido/inexistente → invitacion_invalida", async () => {
    const supa = clienteSupabaseFalso({ user: usuarioAuth({}) });
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(leerBorradorInvitacion).mockResolvedValue({ token: "tok-muerto" });
    vi.mocked(buscarInvitacionPorToken).mockResolvedValue(null);

    const res = await GET(peticion({ code: "un-code" }));

    expect(aplicarAceptacionInvitacionPasswordless).not.toHaveBeenCalled();
    expect(supa.auth.signOut).toHaveBeenCalledTimes(1);
    expect(destino(res)).toEqual({ ruta: "/invitacion/tok-muerto", error: "invitacion_invalida" });
  });

  it("🔴 el CONDUCTOR no pasa por este camino: `buscarInvitacionPorToken` ya lo trata como inexistente", async () => {
    // El módulo compartido filtra rol='conductor' devolviendo null (ver su
    // propia prueba unitaria); acá se afirma que el callback, al recibir ese
    // null, se comporta exactamente igual que con un token inválido —nunca
    // acepta ni crea un perfil de conductor por este camino sin contraseña.
    const supa = clienteSupabaseFalso({ user: usuarioAuth({}) });
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(leerBorradorInvitacion).mockResolvedValue({ token: "tok-conductor" });
    vi.mocked(buscarInvitacionPorToken).mockResolvedValue(null);

    const res = await GET(peticion({ code: "un-code" }));

    expect(aplicarAceptacionInvitacionPasswordless).not.toHaveBeenCalled();
    expect(destino(res)).toEqual({ ruta: "/invitacion/tok-conductor", error: "invitacion_invalida" });
  });

  it("la aceptación falla (p. ej. invitación revocada justo entre medio) → error_sistema, sesión cerrada", async () => {
    const supa = clienteSupabaseFalso({ user: usuarioAuth({}) });
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(leerBorradorInvitacion).mockResolvedValue({ token: "tok-1" });
    vi.mocked(buscarInvitacionPorToken).mockResolvedValue({ email: "dueno@despachosrapidos.cl", rol: "supervisor" });
    vi.mocked(aplicarAceptacionInvitacionPasswordless).mockRejectedValue(new ErrorConflicto("La invitación ya no está disponible."));

    const res = await GET(peticion({ code: "un-code" }));

    expect(supa.auth.signOut).toHaveBeenCalledTimes(1);
    expect(limpiarBorradorInvitacion).toHaveBeenCalledTimes(1);
    expect(destino(res)).toEqual({ ruta: "/invitacion/tok-1", error: "error_sistema" });
  });
});

describe("GET /auth/callback — camino REGISTRO-SELLER (RF-010 rediseño, hay borrador de intent)", () => {
  const BORRADOR_SELLER = { tenantId: "t-courier-1", enlaceToken: "tok-enlace-1" };

  it("barrera OK: arranca el wizard (guarda su cookie, limpia el intent, redirige a /registro-seller/wizard)", async () => {
    const supa = clienteSupabaseFalso({ user: usuarioAuth({}) });
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(leerBorradorRegistroSeller).mockResolvedValue(BORRADOR_SELLER);
    vi.mocked(verificarBarreraAutoRegistroSeller).mockResolvedValue({ ok: true });

    const res = await GET(peticion({ code: "un-code" }));

    expect(guardarBorradorWizardSeller).toHaveBeenCalledWith({ tenantId: "t-courier-1" });
    expect(limpiarBorradorRegistroSeller).toHaveBeenCalledTimes(1);
    expect(cambiarCourierActivo).not.toHaveBeenCalled();
    expect(destino(res)).toEqual({ ruta: "/registro-seller/wizard", error: null });
  });

  it("identidad ya es otra cosa (conductor/interno/super_admin): rebota a la landing, SIN borrar el usuario Auth", async () => {
    const supa = clienteSupabaseFalso({ user: usuarioAuth({}) });
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(leerBorradorRegistroSeller).mockResolvedValue(BORRADOR_SELLER);
    vi.mocked(verificarBarreraAutoRegistroSeller).mockResolvedValue({
      ok: false,
      motivo: "identidad_no_es_seller",
      tipoActual: "conductor",
    });
    const admin = adminFalso();
    vi.mocked(crearClienteServiceRole).mockReturnValue(admin as never);

    const res = await GET(peticion({ code: "un-code" }));

    expect(supa.auth.signOut).toHaveBeenCalledTimes(1);
    expect(admin.auth.admin.deleteUser).not.toHaveBeenCalled();
    expect(limpiarBorradorRegistroSeller).toHaveBeenCalledTimes(1);
    expect(guardarBorradorWizardSeller).not.toHaveBeenCalled();
    expect(destino(res)).toEqual({ ruta: "/registro-seller/tok-enlace-1", error: "correo_ocupado" });
  });

  it("idempotente: ya es seller de ESTE courier → conmuta a él y entra a /portal", async () => {
    const supa = clienteSupabaseFalso({ user: usuarioAuth({}) });
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(leerBorradorRegistroSeller).mockResolvedValue(BORRADOR_SELLER);
    vi.mocked(verificarBarreraAutoRegistroSeller).mockResolvedValue({
      ok: false,
      motivo: "ya_tiene_membresia_en_este_courier",
    });
    vi.mocked(cambiarCourierActivo).mockResolvedValue({ tenantId: "t-courier-1", sellerId: "seller-1" });

    const res = await GET(peticion({ code: "un-code" }));

    expect(cambiarCourierActivo).toHaveBeenCalledWith(expect.anything(), {
      authUserId: AUTH_USER_ID,
      tenantId: "t-courier-1",
    });
    expect(supa.auth.signOut).not.toHaveBeenCalled();
    expect(supa.auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(limpiarBorradorRegistroSeller).toHaveBeenCalledTimes(1);
    expect(destino(res)).toEqual({ ruta: "/portal", error: null });
  });

  it("idempotente: si el switch falla igual entra a /portal (best-effort, nunca bloquea el login)", async () => {
    const supa = clienteSupabaseFalso({ user: usuarioAuth({}) });
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(leerBorradorRegistroSeller).mockResolvedValue(BORRADOR_SELLER);
    vi.mocked(verificarBarreraAutoRegistroSeller).mockResolvedValue({
      ok: false,
      motivo: "ya_tiene_membresia_en_este_courier",
    });
    vi.mocked(cambiarCourierActivo).mockRejectedValue(new Error("membresía bloqueada"));

    const res = await GET(peticion({ code: "un-code" }));

    expect(destino(res)).toEqual({ ruta: "/portal", error: null });
  });

  it("va junto a ACEPTACIÓN: con borrador de intent presente, ni siquiera mira el borrador de registro de courier", async () => {
    const supa = clienteSupabaseFalso({ user: usuarioAuth({}) });
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(leerBorradorRegistroSeller).mockResolvedValue(BORRADOR_SELLER);
    vi.mocked(verificarBarreraAutoRegistroSeller).mockResolvedValue({ ok: true });

    await GET(peticion({ code: "un-code" }));

    expect(leerBorrador).not.toHaveBeenCalled();
    expect(provisionarTenantParaAuthUser).not.toHaveBeenCalled();
  });
});

describe("GET /auth/callback — el diagnóstico del canje llega LEGIBLE a Sentry", () => {
  it("lo que el callback REALMENTE manda sobrevive a la redacción de PII", async () => {
    const observabilidad = await import("@/lib/observabilidad");
    const espia = vi.spyOn(observabilidad, "capturarMensaje").mockResolvedValue(undefined as never);
    const { redactarSensible } = await import("@/lib/observabilidad/redaccion");

    const supa = clienteSupabaseFalso({
      user: usuarioAuth(),
      errorCanje: { message: "PKCE code verifier not found", code: "pkce_code_verifier_not_found" } as never,
    });
    vi.mocked(createClient).mockResolvedValue(supa as never);

    await GET(peticion({ code: "un-code", cookies: "sb-abc-auth-token=x" }));

    const llamada = espia.mock.calls.find((c) => /exchangeCodeForSession/.test(String(c[0])));
    expect(llamada, "el callback dejó de reportar el canje fallido").toBeDefined();
    const extra = (llamada![2] as { extra: Record<string, unknown> }).extra;
    const redactado = redactarSensible(extra) as Record<string, unknown>;

    // ⚠️ Se prueba contra las claves que manda el CÓDIGO, no contra una copia:
    // si alguien vuelve a nombrarlas con «cookie», el filtro las tacha, esta
    // prueba cae, y el bug de PKCE no vuelve a quedar sin diagnóstico.
    const sobrevivientes = Object.values(redactado).filter((v) => v === false || v === true);
    expect(sobrevivientes, "el sí/no del verificador PKCE llegó tachado").toContain(false);
    espia.mockRestore();
  });
});
