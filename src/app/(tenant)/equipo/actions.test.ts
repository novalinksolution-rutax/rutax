/**
 * Prueba de regresión — `reenviarInvitacion` (botón "Reenviar correo" en
 * `/equipo`).
 *
 * POR QUÉ EXISTE (encargo puntual, no cobertura general de `equipo/actions.ts`):
 * este sitio es uno de los que la migración `20260807000001_identidad_invitaciones_token_privilegios`
 * rompió sin que nadie lo notara — quitó `token` de `public.invitaciones` (fuga
 * cerrada a propósito: cualquier interno podía leer tokens pendientes por
 * PostgREST), pero `reenviarInvitacion` seguía haciendo `.from("invitaciones")`
 * SIN `.schema("identidad")`, así que apuntaba a la vista recortada y el
 * SELECT de `token` fallaba con 42703. "Reenviar correo" estuvo roto del
 * 07-ago al 13-ago.
 *
 * El doble de prueba usado (`crearClienteInvitacionesFalso`) es schema-aware:
 * modela las columnas de `public.invitaciones` vs. `identidad.invitaciones`
 * tal como son hoy. Si `reenviarInvitacion` volviera a perder su
 * `.schema("identidad")`, la prueba REGRESIÓN de abajo falla — el SELECT
 * fallaría con 42703 y la acción devolvería `ok:false` en vez de `ok:true`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/identidad/usuario-actual-servidor", () => ({
  obtenerSesionActual: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: vi.fn(),
}));

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { reenviarInvitacion } from "./actions";
import type { SesionActual } from "@/lib/identidad/usuario-actual-servidor";
import type { UsuarioActual } from "@/modules/identidad/usuario-actual";
import {
  crearClienteInvitacionesFalso,
  type FilaInvitacionFalsa,
} from "@/modules/identidad/invitaciones-postgrest-falso";

const TENANT_A = "10000000-0000-0000-0000-000000000001";
const USUARIO_ID = "40000000-0000-0000-0000-000000000001";

function crearUsuario(overrides: Partial<UsuarioActual> = {}): UsuarioActual {
  return {
    tenantId: TENANT_A,
    tipoUsuario: "interno",
    sellerId: null,
    driverId: null,
    rol: "dueno",
    estado: "activo",
    ...overrides,
  };
}

function crearSesion(overrides: Partial<UsuarioActual> = {}): SesionActual {
  return {
    usuarioId: USUARIO_ID,
    email: "dueno@example.com",
    nombreCompleto: "Dueño de Prueba",
    usuario: crearUsuario(overrides),
  };
}

function invitacionInternaFalsa(overrides: Partial<FilaInvitacionFalsa> = {}): FilaInvitacionFalsa {
  return {
    id: "inv-1",
    tenant_id: TENANT_A,
    email: "supervisor.nuevo@example.com",
    tipo_usuario: "interno",
    rol: "supervisor",
    seller_id: null,
    driver_id: null,
    estado: "pendiente",
    expira_en: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    token: "token-secreto-de-reenvio",
    ...overrides,
  };
}

/**
 * `enviarEmailInvitacion` (real, sin mockear — corre en sandbox, sin red) lee
 * `tenants` y escribe en `bitacora_auditoria`. Se modelan igual que en
 * `invitaciones.test.ts` para que el doble no dependa de que esas escrituras
 * estén envueltas en un `try/catch` en producción — deben funcionar de verdad.
 */
function otrasTablasDeEnvioCorreo(tabla: string): unknown {
  if (tabla === "tenants") {
    return {
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { nombre_fantasia: "Courier de Prueba" }, error: null }) }),
      }),
    };
  }
  if (tabla === "bitacora_auditoria") {
    return { insert: async () => ({ data: null, error: null }) };
  }
  throw new Error(`Tabla inesperada en esta prueba: ${tabla}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(obtenerSesionActual).mockResolvedValue(crearSesion());
});

describe("reenviarInvitacion", () => {
  it("rechaza sin sesión activa", async () => {
    vi.mocked(obtenerSesionActual).mockResolvedValue(null);

    const resultado = await reenviarInvitacion("inv-1");

    expect(resultado).toEqual({ ok: false, tipo: "permiso", mensaje: "No hay una sesión activa." });
  });

  it("rechaza por capacidad insuficiente (coordinador no invita)", async () => {
    vi.mocked(obtenerSesionActual).mockResolvedValue(crearSesion({ rol: "coordinador" }));

    const resultado = await reenviarInvitacion("inv-1");

    expect(resultado.ok).toBe(false);
  });

  it("rechaza si la invitación ya no está pendiente", async () => {
    const { cliente } = crearClienteInvitacionesFalso({
      invitaciones: [invitacionInternaFalsa({ estado: "aceptada" })],
      otrasTablas: (tabla) => {
        throw new Error(`Tabla inesperada en esta prueba: ${tabla}`);
      },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente as never);

    const resultado = await reenviarInvitacion("inv-1");

    expect(resultado).toEqual({
      ok: false,
      tipo: "conflicto",
      mensaje: "Esta invitación ya no está pendiente — usa 'Reinvitar' para enviar una nueva.",
    });
  });

  it("REGRESIÓN 2026-08-07: reenvía sin romper — lee el token vía identidad.invitaciones, no la vista", async () => {
    const { cliente } = crearClienteInvitacionesFalso({
      invitaciones: [invitacionInternaFalsa()],
      otrasTablas: otrasTablasDeEnvioCorreo,
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente as never);

    const resultado = await reenviarInvitacion("inv-1");

    // Si `reenviarInvitacion` perdiera su `.schema("identidad")`, el SELECT de
    // `token` fallaría con 42703 y esto sería `{ ok:false, tipo:"desconocido" }`.
    expect(resultado.ok).toBe(true);
  });
});
