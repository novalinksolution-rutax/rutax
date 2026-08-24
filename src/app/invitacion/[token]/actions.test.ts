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

import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { createClient } from "@/lib/supabase/server";
import {
  resolverInvitacionPorToken,
  aceptarInvitacionComoPersonaNueva,
  aceptarInvitacionComoPersonaExistente,
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

// =============================================================================
// aceptarInvitacionComoPersonaNueva
// =============================================================================
describe("aceptarInvitacionComoPersonaNueva", () => {
  it("REGRESIÓN 2026-08-07: crea la cuenta y deja la invitación aceptada — ejercita los DOS sitios arreglados", async () => {
    const bitacora: Array<Record<string, unknown>> = [];
    const perfiles: Array<Record<string, unknown>> = [];
    const { cliente, estado } = crearClienteInvitacionesFalso({
      invitaciones: [invitacionFalsa()],
      otrasTablas: otrasTablasBase(bitacora, perfiles),
    });
    const clienteConAuth = conAuthFalso(cliente, {
      admin: {
        createUser: vi.fn().mockResolvedValue({ data: { user: { id: "auth-nuevo-1" } }, error: null }),
      },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(clienteConAuth);

    const resultado = await aceptarInvitacionComoPersonaNueva({
      token: TOKEN_VALIDO,
      nombreCompleto: "Juan Pérez",
      contrasena: "contraseña-larga-123",
    });

    // Si el SELECT por token (local o el de `aceptarInvitacion`) perdiera su
    // `.schema("identidad")`, esto sería `{ok:false, tipo:"no_encontrado", …}`.
    expect(resultado).toEqual({ ok: true });
    expect(estado.invitaciones[0].estado).toBe("aceptada");
    expect(perfiles).toHaveLength(1);
    expect(perfiles[0]).toMatchObject({
      id: "auth-nuevo-1",
      tenant_id: TENANT_A,
      tipo_usuario: "interno",
      rol: "supervisor",
      estado: "activo",
    });
  });

  it("crea la cuenta del conductor con su PIN de 6 dígitos", async () => {
    // El conductor NO define una contraseña: define un PIN, y ese PIN **es** la
    // contraseña de Supabase. Seis dígitos son válidos porque
    // `minimum_password_length` está en 6 y `password_requirements` vacío.
    const bitacora: Array<Record<string, unknown>> = [];
    const perfiles: Array<Record<string, unknown>> = [];
    const { cliente } = crearClienteInvitacionesFalso({
      invitaciones: [invitacionFalsa({ tipo_usuario: "conductor", rol: "conductor", driver_id: "driver-1" })],
      otrasTablas: otrasTablasBase(bitacora, perfiles),
    });
    const crearUsuario = vi
      .fn()
      .mockResolvedValue({ data: { user: { id: "auth-conductor-1" } }, error: null });
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      conAuthFalso(cliente, { admin: { createUser: crearUsuario } }),
    );

    const resultado = await aceptarInvitacionComoPersonaNueva({
      token: TOKEN_VALIDO,
      nombreCompleto: "Carlos Vera",
      contrasena: "482619",
    });

    expect(resultado).toEqual({ ok: true });
    // El PIN viaja tal cual como contraseña: no se transforma ni se guarda aparte.
    expect(crearUsuario.mock.calls[0][0]).toMatchObject({ password: "482619" });
  });

  it("⚠️ el PIN débil del conductor se rechaza EN EL SERVIDOR, no solo en la pantalla", async () => {
    // Un formulario se salta; una Server Action no. Y el rol se lee **de la
    // invitación**: si viniera del cliente, cualquiera podría declararse
    // conductor para saltarse la regla de 8 caracteres.
    const bitacora: Array<Record<string, unknown>> = [];
    const perfiles: Array<Record<string, unknown>> = [];
    const { cliente } = crearClienteInvitacionesFalso({
      invitaciones: [invitacionFalsa({ tipo_usuario: "conductor", rol: "conductor", driver_id: "driver-1" })],
      otrasTablas: otrasTablasBase(bitacora, perfiles),
    });
    const crearUsuario = vi.fn();
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      conAuthFalso(cliente, { admin: { createUser: crearUsuario } }),
    );

    const resultado = await aceptarInvitacionComoPersonaNueva({
      token: TOKEN_VALIDO,
      nombreCompleto: "Carlos Vera",
      contrasena: "123456",
    });

    expect(resultado.ok).toBe(false);
    // Lo que de verdad importa: **no se creó ninguna cuenta**.
    expect(crearUsuario).not.toHaveBeenCalled();
  });

  it("⚠️ una contraseña de 6 letras NO le sirve al conductor", async () => {
    // Sin esta barrera, `minimum_password_length = 6` dejaría pasar «abcdef» y el
    // conductor tendría una credencial que su teclado numérico no puede escribir.
    const bitacora: Array<Record<string, unknown>> = [];
    const perfiles: Array<Record<string, unknown>> = [];
    const { cliente } = crearClienteInvitacionesFalso({
      invitaciones: [invitacionFalsa({ tipo_usuario: "conductor", rol: "conductor", driver_id: "driver-1" })],
      otrasTablas: otrasTablasBase(bitacora, perfiles),
    });
    const crearUsuario = vi.fn();
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      conAuthFalso(cliente, { admin: { createUser: crearUsuario } }),
    );

    const resultado = await aceptarInvitacionComoPersonaNueva({
      token: TOKEN_VALIDO,
      nombreCompleto: "Carlos Vera",
      contrasena: "abcdef",
    });

    expect(resultado.ok).toBe(false);
    expect(crearUsuario).not.toHaveBeenCalled();
  });

  it("rechaza la contraseña corta de alguien del equipo, y no crea nada", async () => {
    // ⚠️ **Antes esta prueba exigía que ni siquiera se tocara la base**, y esa
    // garantía se perdió a propósito: para saber si la regla es «6 dígitos» o «8
    // caracteres» hay que saber el rol, y el rol vive en la invitación. Se paga
    // un SELECT por token, que es barato e indexado.
    //
    // Lo que sí se conserva —y es lo que importa— es que **no se cree ninguna
    // cuenta**: eso es lo que esta prueba vigila ahora.
    const bitacora: Array<Record<string, unknown>> = [];
    const perfiles: Array<Record<string, unknown>> = [];
    const { cliente } = crearClienteInvitacionesFalso({
      invitaciones: [invitacionFalsa()],
      otrasTablas: otrasTablasBase(bitacora, perfiles),
    });
    const crearUsuario = vi.fn();
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      conAuthFalso(cliente, { admin: { createUser: crearUsuario } }),
    );

    const resultado = await aceptarInvitacionComoPersonaNueva({
      token: TOKEN_VALIDO,
      nombreCompleto: "Juan Pérez",
      contrasena: "corta",
    });

    expect(resultado.ok).toBe(false);
    expect(crearUsuario).not.toHaveBeenCalled();
    expect(perfiles).toHaveLength(0);
  });
});

// =============================================================================
// aceptarInvitacionComoPersonaExistente
// =============================================================================
describe("aceptarInvitacionComoPersonaExistente", () => {
  it("REGRESIÓN 2026-08-07: confirma con la sesión activa del mismo correo — ejercita los DOS sitios arreglados", async () => {
    const bitacora: Array<Record<string, unknown>> = [];
    const perfiles: Array<Record<string, unknown>> = [];
    const { cliente, estado } = crearClienteInvitacionesFalso({
      invitaciones: [invitacionFalsa({ tipo_usuario: "seller", rol: "seller", seller_id: "seller-1", email: "seller@example.com" })],
      otrasTablas: otrasTablasBase(bitacora, perfiles),
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(conAuthFalso(cliente, {}));
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "auth-existente-1", email: "seller@example.com", user_metadata: {} } },
        }),
      },
    } as never);

    const resultado = await aceptarInvitacionComoPersonaExistente({ token: TOKEN_VALIDO });

    // Si el SELECT por token (local o el de `aceptarInvitacion`) perdiera su
    // `.schema("identidad")`, esto sería `{ok:false, tipo:"no_encontrado", …}`.
    expect(resultado).toEqual({ ok: true });
    expect(estado.invitaciones[0].estado).toBe("aceptada");
    expect(perfiles[0]).toMatchObject({ id: "auth-existente-1", seller_id: "seller-1", rol: "seller" });
  });

  it("pide iniciar sesión cuando el correo de la sesión no coincide con el de la invitación", async () => {
    const bitacora: Array<Record<string, unknown>> = [];
    const perfiles: Array<Record<string, unknown>> = [];
    const { cliente } = crearClienteInvitacionesFalso({
      invitaciones: [invitacionFalsa()],
      otrasTablas: otrasTablasBase(bitacora, perfiles),
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(conAuthFalso(cliente, {}));
    vi.mocked(createClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    } as never);

    const resultado = await aceptarInvitacionComoPersonaExistente({ token: TOKEN_VALIDO });

    expect(resultado).toMatchObject({ ok: false, tipo: "requiere_inicio_sesion" });
  });
});
