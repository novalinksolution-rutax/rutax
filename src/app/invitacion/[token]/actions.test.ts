/**
 * Prueba de regresión — pantalla pública de canje de invitación
 * (`resolverInvitacionPorToken`, `aceptarInvitacionComoPersonaNueva`,
 * `aceptarInvitacionComoPersonaExistente`).
 *
 * POR QUÉ EXISTE (encargo puntual, no cobertura general de este archivo): las
 * TRES funciones filtran por `token` contra `.from("invitaciones")`. La
 * migración `20260807000001_identidad_invitaciones_token_privilegios` quitó
 * `token` de `public.invitaciones` a propósito (fuga cerrada: cualquier
 * interno podía leer tokens pendientes por PostgREST), pero estos tres sitios
 * seguían sin `.schema("identidad")` — apuntaban a la vista recortada, y
 * `.eq("token", …)` fallaba con 42703 igual que un SELECT que pidiera la
 * columna. Nadie podía activar su cuenta, desde el 07-ago hasta el 13-ago.
 *
 * `aceptarInvitacion` (el paso final, en `identidad/invitaciones.ts`) corre
 * REAL aquí, sin mockear — a propósito: también tenía el mismo bug en su
 * propio SELECT por token, así que estas pruebas ejercitan de punta a punta
 * los DOS sitios arreglados en la misma operación de negocio.
 *
 * El doble de prueba usado (`crearClienteInvitacionesFalso`) es schema-aware:
 * modela las columnas de `public.invitaciones` vs. `identidad.invitaciones`
 * tal como son hoy. Si cualquiera de estos sitios volviera a perder su
 * `.schema("identidad")`, la prueba REGRESIÓN correspondiente falla con el
 * mismo 42703 real.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/identidad/borrador-invitacion", () => ({
  guardarBorrador: vi.fn(),
}));

vi.mock("@/modules/identidad/aceptacion-invitacion-passwordless", () => ({
  buscarInvitacionPorToken: vi.fn(),
  aplicarAceptacionInvitacionPasswordless: vi.fn(),
  guardarWhatsAppInvitado: vi.fn(),
}));

import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { createClient } from "@/lib/supabase/server";
import { guardarBorrador as guardarBorradorInvitacionCookie } from "@/lib/identidad/borrador-invitacion";
import {
  aplicarAceptacionInvitacionPasswordless,
  buscarInvitacionPorToken,
} from "@/modules/identidad/aceptacion-invitacion-passwordless";
import { ErrorConflicto } from "@/modules/identidad/errores";
import {
  resolverInvitacionPorToken,
  guardarBorradorInvitacion,
  enviarCodigoInvitacion,
  verificarCodigoInvitacion,
} from "./actions";
import {
  crearClienteInvitacionesFalso,
  type FilaInvitacionFalsa,
} from "@/modules/identidad/invitaciones-postgrest-falso";

const TENANT_A = "10000000-0000-0000-0000-000000000001";
const TOKEN_VALIDO = "token-secreto-de-canje";

function invitacionFalsa(overrides: Partial<FilaInvitacionFalsa> = {}): FilaInvitacionFalsa {
  return {
    id: "inv-1",
    tenant_id: TENANT_A,
    email: "invitado@example.com",
    tipo_usuario: "interno",
    rol: "supervisor",
    seller_id: null,
    driver_id: null,
    estado: "pendiente",
    expira_en: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    token: TOKEN_VALIDO,
    ...overrides,
  };
}

/** Tablas auxiliares que tocan `aceptarInvitacion` real y `resolverInvitacionPorToken`. */
function otrasTablasBase(bitacora: Array<Record<string, unknown>>, perfiles: Array<Record<string, unknown>>) {
  return (tabla: string): unknown => {
    if (tabla === "tenants") {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: { nombre_fantasia: "Courier de Prueba" }, error: null }) }),
        }),
      };
    }
    if (tabla === "bitacora_auditoria") {
      return {
        insert: async (fila: Record<string, unknown>) => {
          bitacora.push(fila);
          return { data: null, error: null };
        },
      };
    }
    if (tabla === "usuarios_perfil") {
      return {
        upsert: async (fila: Record<string, unknown>) => {
          const idx = perfiles.findIndex((p) => p.id === fila.id);
          if (idx >= 0) perfiles[idx] = fila;
          else perfiles.push(fila);
          return { data: null, error: null };
        },
      };
    }
    throw new Error(`Tabla inesperada en esta prueba: ${tabla}`);
  };
}

/** Doble mínimo de `auth.admin`/`auth`, inyectado sobre el cliente schema-aware. */
function conAuthFalso(
  cliente: ReturnType<typeof crearClienteInvitacionesFalso>["cliente"],
  auth: Record<string, unknown>,
) {
  return Object.assign(cliente as Record<string, unknown>, { auth }) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// resolverInvitacionPorToken
// =============================================================================
describe("resolverInvitacionPorToken", () => {
  it("token vacío → inválida, sin tocar la base", async () => {
    const resultado = await resolverInvitacionPorToken("   ");
    expect(resultado).toEqual({ estado: "invalida" });
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });

  it("REGRESIÓN 2026-08-07: token válido resuelve (lee vía identidad.invitaciones, no la vista)", async () => {
    const bitacora: Array<Record<string, unknown>> = [];
    const perfiles: Array<Record<string, unknown>> = [];
    const { cliente } = crearClienteInvitacionesFalso({
      invitaciones: [invitacionFalsa()],
      otrasTablas: otrasTablasBase(bitacora, perfiles),
    });
    const clienteConAuth = conAuthFalso(cliente, {
      admin: { listUsers: vi.fn().mockResolvedValue({ data: { users: [] }, error: null }) },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(clienteConAuth);

    const resultado = await resolverInvitacionPorToken(TOKEN_VALIDO);

    // Si esta función perdiera `.schema("identidad")`, `.eq("token", …)`
    // fallaría con 42703 y `resolverInvitacionPorToken` devolvería `{estado:"error"}`.
    expect(resultado).toEqual({
      estado: "valida",
      variante: "persona_nueva",
      nombreTenant: "Courier de Prueba",
      rol: "supervisor",
      email: "invitado@example.com",
    });
  });

  it("token inexistente → inválida (no 'error' — el 42703 real quedaría como 'error', no 'invalida')", async () => {
    const { cliente } = crearClienteInvitacionesFalso({
      invitaciones: [],
      otrasTablas: () => {
        throw new Error("no debería tocar otra tabla");
      },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(conAuthFalso(cliente, {}));

    const resultado = await resolverInvitacionPorToken("no-existe");

    expect(resultado).toEqual({ estado: "invalida" });
  });
});

// `aceptarInvitacionComoPersonaNueva` (PIN del conductor) y
// `aceptarInvitacionComoPersonaExistente` (confirmación con contraseña) se
// retiraron el 2026-09-15 (F4, cutover passwordless) junto a sus pruebas: el
// conductor ya no acepta su invitación por este token (entra por WhatsApp OTP
// desde la app nativa) y ningún otro rol usaba estas dos funciones.

// =============================================================================
// F3 — passwordless: guardarBorradorInvitacion / enviarCodigoInvitacion /
// verificarCodigoInvitacion
// =============================================================================

function authFalsoListUsersVacio() {
  return { admin: { listUsers: vi.fn().mockResolvedValue({ data: { users: [] }, error: null }) } };
}

describe("guardarBorradorInvitacion (F3)", () => {
  it("token inválido → invitacion_invalida, sin guardar la cookie", async () => {
    const { cliente } = crearClienteInvitacionesFalso({ invitaciones: [] });
    vi.mocked(crearClienteServiceRole).mockReturnValue(conAuthFalso(cliente, authFalsoListUsersVacio()));

    const resultado = await guardarBorradorInvitacion("no-existe");

    expect(resultado).toEqual({ ok: false, tipo: "invitacion_invalida", mensaje: "Este enlace ya no es válido." });
    expect(guardarBorradorInvitacionCookie).not.toHaveBeenCalled();
  });

  it("🔴 token de un CONDUCTOR → invitacion_invalida (sigue con su PIN, no con este camino)", async () => {
    const bitacora: Array<Record<string, unknown>> = [];
    const perfiles: Array<Record<string, unknown>> = [];
    const { cliente } = crearClienteInvitacionesFalso({
      invitaciones: [invitacionFalsa({ tipo_usuario: "conductor", rol: "conductor", driver_id: "driver-1" })],
      otrasTablas: otrasTablasBase(bitacora, perfiles),
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(conAuthFalso(cliente, authFalsoListUsersVacio()));

    const resultado = await guardarBorradorInvitacion(TOKEN_VALIDO);

    expect(resultado).toEqual({ ok: false, tipo: "invitacion_invalida", mensaje: "Este enlace ya no es válido." });
    expect(guardarBorradorInvitacionCookie).not.toHaveBeenCalled();
  });

  it("token válido de un seller → guarda la cookie con el token y el opt-in de WhatsApp", async () => {
    const bitacora: Array<Record<string, unknown>> = [];
    const perfiles: Array<Record<string, unknown>> = [];
    const { cliente } = crearClienteInvitacionesFalso({
      invitaciones: [invitacionFalsa({ tipo_usuario: "seller", rol: "seller", seller_id: "seller-1" })],
      otrasTablas: otrasTablasBase(bitacora, perfiles),
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(conAuthFalso(cliente, authFalsoListUsersVacio()));

    const resultado = await guardarBorradorInvitacion(TOKEN_VALIDO, {
      optInWhatsApp: true,
      telefonoWhatsApp: "+56 9 1234 5678",
    });

    expect(resultado).toEqual({ ok: true });
    expect(guardarBorradorInvitacionCookie).toHaveBeenCalledWith({
      token: TOKEN_VALIDO,
      optInWhatsApp: true,
      telefonoWhatsApp: "+56 9 1234 5678",
    });
  });

  it("sin opt-in de WhatsApp (equipo interno) → guarda solo el token", async () => {
    const bitacora: Array<Record<string, unknown>> = [];
    const perfiles: Array<Record<string, unknown>> = [];
    const { cliente } = crearClienteInvitacionesFalso({
      invitaciones: [invitacionFalsa()],
      otrasTablas: otrasTablasBase(bitacora, perfiles),
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(conAuthFalso(cliente, authFalsoListUsersVacio()));

    const resultado = await guardarBorradorInvitacion(TOKEN_VALIDO);

    expect(resultado).toEqual({ ok: true });
    expect(guardarBorradorInvitacionCookie).toHaveBeenCalledWith({
      token: TOKEN_VALIDO,
      optInWhatsApp: undefined,
      telefonoWhatsApp: undefined,
    });
  });
});

describe("enviarCodigoInvitacion (F3)", () => {
  it("token inválido → ok:false, sin llamar a signInWithOtp", async () => {
    vi.mocked(buscarInvitacionPorToken).mockResolvedValue(null);
    const supa = { auth: { signInWithOtp: vi.fn() } };
    vi.mocked(createClient).mockResolvedValue(supa as never);

    const resultado = await enviarCodigoInvitacion("no-existe");

    expect(resultado.ok).toBe(false);
    expect(supa.auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it("token válido → manda el código al correo DE LA INVITACIÓN, con shouldCreateUser:true", async () => {
    vi.mocked(buscarInvitacionPorToken).mockResolvedValue({ email: "seller@ejemplo.cl", rol: "seller" });
    const supa = { auth: { signInWithOtp: vi.fn().mockResolvedValue({ error: null }) } };
    vi.mocked(createClient).mockResolvedValue(supa as never);

    const resultado = await enviarCodigoInvitacion(TOKEN_VALIDO);

    expect(supa.auth.signInWithOtp).toHaveBeenCalledWith({
      email: "seller@ejemplo.cl",
      options: { shouldCreateUser: true },
    });
    expect(resultado.ok).toBe(true);
  });

  it("Supabase falla al enviar el código → ok:false, sin filtrar el detalle técnico", async () => {
    vi.mocked(buscarInvitacionPorToken).mockResolvedValue({ email: "seller@ejemplo.cl", rol: "seller" });
    const supa = { auth: { signInWithOtp: vi.fn().mockResolvedValue({ error: { message: "boom interno" } }) } };
    vi.mocked(createClient).mockResolvedValue(supa as never);

    const resultado = await enviarCodigoInvitacion(TOKEN_VALIDO);

    expect(resultado.ok).toBe(false);
    expect(resultado.mensaje).not.toContain("boom");
  });
});

describe("verificarCodigoInvitacion (F3)", () => {
  it("token inválido → invitacion_invalida, sin verificar código", async () => {
    vi.mocked(buscarInvitacionPorToken).mockResolvedValue(null);

    const resultado = await verificarCodigoInvitacion("no-existe", "123456");

    expect(resultado).toMatchObject({ ok: false, tipo: "invitacion_invalida" });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("código inválido → codigo_invalido, sin aceptar nada", async () => {
    vi.mocked(buscarInvitacionPorToken).mockResolvedValue({ email: "seller@ejemplo.cl", rol: "seller" });
    const supa = {
      auth: { verifyOtp: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: "malo" } }) },
    };
    vi.mocked(createClient).mockResolvedValue(supa as never);

    const resultado = await verificarCodigoInvitacion(TOKEN_VALIDO, "000000");

    expect(resultado).toMatchObject({ ok: false, tipo: "codigo_invalido" });
    expect(aplicarAceptacionInvitacionPasswordless).not.toHaveBeenCalled();
  });

  it("código válido → acepta y devuelve el destino que resuelve aplicarAceptacionInvitacionPasswordless", async () => {
    vi.mocked(buscarInvitacionPorToken).mockResolvedValue({ email: "seller@ejemplo.cl", rol: "seller" });
    const supa = {
      auth: {
        verifyOtp: vi
          .fn()
          .mockResolvedValue({ data: { user: { id: "auth-seller-1", user_metadata: {} } }, error: null }),
        refreshSession: vi.fn().mockResolvedValue({ data: {}, error: null }),
        signOut: vi.fn().mockResolvedValue({ error: null }),
      },
    };
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(aplicarAceptacionInvitacionPasswordless).mockResolvedValue({
      tenantId: "t-1",
      rol: "seller",
      destino: "/portal/conectar-ml",
    });

    const resultado = await verificarCodigoInvitacion(TOKEN_VALIDO, "123456", {
      optInWhatsApp: true,
      telefonoWhatsApp: "+56 9 1234 5678",
    });

    expect(aplicarAceptacionInvitacionPasswordless).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        token: TOKEN_VALIDO,
        usuarioAuthId: "auth-seller-1",
        whatsapp: { telefono: "+56 9 1234 5678", acepta: true },
      }),
    );
    expect(supa.auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(resultado).toEqual({ ok: true, destino: "/portal/conectar-ml" });
  });

  it("🔴 el CONDUCTOR no pasa por acá: `buscarInvitacionPorToken` ya lo trata como inexistente", async () => {
    vi.mocked(buscarInvitacionPorToken).mockResolvedValue(null);

    const resultado = await verificarCodigoInvitacion("tok-conductor", "123456");

    expect(resultado).toMatchObject({ ok: false, tipo: "invitacion_invalida" });
    expect(aplicarAceptacionInvitacionPasswordless).not.toHaveBeenCalled();
  });

  it("la aceptación falla con conflicto (invitación ya no disponible) → tipo conflicto, cierra sesión", async () => {
    vi.mocked(buscarInvitacionPorToken).mockResolvedValue({ email: "seller@ejemplo.cl", rol: "seller" });
    const supa = {
      auth: {
        verifyOtp: vi
          .fn()
          .mockResolvedValue({ data: { user: { id: "auth-seller-1", user_metadata: {} } }, error: null }),
        signOut: vi.fn().mockResolvedValue({ error: null }),
      },
    };
    vi.mocked(createClient).mockResolvedValue(supa as never);
    vi.mocked(aplicarAceptacionInvitacionPasswordless).mockRejectedValue(
      new ErrorConflicto("La invitación ya no está disponible."),
    );

    const resultado = await verificarCodigoInvitacion(TOKEN_VALIDO, "123456");

    expect(resultado).toMatchObject({ ok: false, tipo: "conflicto" });
    expect(supa.auth.signOut).toHaveBeenCalledTimes(1);
  });
});
