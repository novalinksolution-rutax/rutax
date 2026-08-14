/**
 * Prueba de regresión — `obtenerInvitacionPendienteSeller` ("Copiar enlace"
 * en `/sellers`).
 *
 * POR QUÉ EXISTE (encargo puntual, no cobertura general de `sellers/actions.ts`):
 * este sitio es uno de los que la migración `20260807000001_identidad_invitaciones_token_privilegios`
 * rompió sin que nadie lo notara — quitó `token` de `public.invitaciones` (fuga
 * cerrada a propósito: cualquier interno podía leer tokens pendientes por
 * PostgREST), pero `obtenerInvitacionPendienteSeller` seguía haciendo
 * `.from("invitaciones")` SIN `.schema("identidad")`, así que apuntaba a la
 * vista recortada y el SELECT de `token` fallaba con 42703. "Copiar enlace"
 * del seller estuvo roto del 07-ago al 13-ago.
 *
 * El doble de prueba usado (`crearClienteInvitacionesFalso`) es schema-aware:
 * modela las columnas de `public.invitaciones` vs. `identidad.invitaciones`
 * tal como son hoy. Si `obtenerInvitacionPendienteSeller` volviera a perder su
 * `.schema("identidad")`, "entrega el token…" abajo falla con el mismo 42703
 * real — no hace falta acordarse de nada.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/identidad/usuario-actual-servidor", () => ({
  obtenerSesionActual: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock("@/modules/identidad/auditoria", () => ({
  registrarEnBitacora: vi.fn(),
}));

// `solicitarSincronizacionMlSeller` (la otra acción de este archivo) importa
// el puerto ML — se mockea para que este archivo no arrastre esa integración,
// que es ajena a esta prueba de regresión.
vi.mock("@/modules/integraciones/ml", () => ({
  solicitarSincronizacionMl: vi.fn(),
}));

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { obtenerInvitacionPendienteSeller } from "./actions";
import type { SesionActual } from "@/lib/identidad/usuario-actual-servidor";
import type { UsuarioActual } from "@/modules/identidad/usuario-actual";
import {
  crearClienteInvitacionesFalso,
  type FilaInvitacionFalsa,
} from "@/modules/identidad/invitaciones-postgrest-falso";

const TENANT_A = "10000000-0000-0000-0000-000000000001";
const OTRO_TENANT = "20000000-0000-0000-0000-000000000002";
const SELLER_A = "30000000-0000-0000-0000-000000000001";
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

function invitacionSellerFalsa(overrides: Partial<FilaInvitacionFalsa> = {}): FilaInvitacionFalsa {
  return {
    id: "inv-1",
    tenant_id: TENANT_A,
    email: "seller@example.com",
    tipo_usuario: "seller",
    rol: "seller",
    seller_id: SELLER_A,
    driver_id: null,
    estado: "pendiente",
    expira_en: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    token: "token-secreto-no-debe-ir-a-bitacora",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(obtenerSesionActual).mockResolvedValue(crearSesion());
});

describe("obtenerInvitacionPendienteSeller", () => {
  it("rechaza sin sesión activa", async () => {
    vi.mocked(obtenerSesionActual).mockResolvedValue(null);

    const resultado = await obtenerInvitacionPendienteSeller(SELLER_A);

    expect(resultado).toEqual({ ok: false, mensaje: "No hay una sesión activa." });
    expect(registrarEnBitacora).not.toHaveBeenCalled();
  });

  it("rechaza por capacidad insuficiente (coordinador no invita)", async () => {
    vi.mocked(obtenerSesionActual).mockResolvedValue(crearSesion({ rol: "coordinador" }));
    const { cliente } = crearClienteInvitacionesFalso();
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente as never);

    const resultado = await obtenerInvitacionPendienteSeller(SELLER_A);

    expect(resultado.ok).toBe(false);
    expect(registrarEnBitacora).not.toHaveBeenCalled();
  });

  it("CRUCE DE TENANT: no devuelve el token de una invitación de otro courier", async () => {
    const { cliente } = crearClienteInvitacionesFalso({
      invitaciones: [invitacionSellerFalsa({ tenant_id: OTRO_TENANT })],
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente as never);

    const resultado = await obtenerInvitacionPendienteSeller(SELLER_A);

    expect(resultado).toEqual({
      ok: false,
      mensaje: "Este seller ya no tiene una invitación pendiente — puede que ya haya entrado.",
    });
    expect(registrarEnBitacora).not.toHaveBeenCalled();
  });

  it("dice que venció cuando la invitación pendiente ya pasó su fecha", async () => {
    const { cliente } = crearClienteInvitacionesFalso({
      invitaciones: [
        invitacionSellerFalsa({ expira_en: new Date(Date.now() - 60_000).toISOString() }),
      ],
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente as never);

    const resultado = await obtenerInvitacionPendienteSeller(SELLER_A);

    expect(resultado).toEqual({
      ok: false,
      mensaje: "Esta invitación venció. Vuelve a invitar al seller para generar una nueva.",
    });
  });

  it("REGRESIÓN 2026-08-07: entrega el token (vía identidad.invitaciones, no la vista) y audita sin él", async () => {
    const semilla = invitacionSellerFalsa();
    const { cliente } = crearClienteInvitacionesFalso({
      invitaciones: [semilla],
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente as never);

    const resultado = await obtenerInvitacionPendienteSeller(SELLER_A);

    expect(resultado).toEqual({
      ok: true,
      token: "token-secreto-no-debe-ir-a-bitacora",
      email: "seller@example.com",
      expiraEn: semilla.expira_en,
    });

    expect(registrarEnBitacora).toHaveBeenCalledTimes(1);
    const [, entrada] = vi.mocked(registrarEnBitacora).mock.calls[0];
    expect(entrada).toMatchObject({
      tenantId: TENANT_A,
      actorUsuarioId: USUARIO_ID,
      actorTipo: "usuario",
      accion: "invitacion.enlace_entregado",
      entidadTipo: "invitacion",
      entidadId: "inv-1",
    });
    // El token JAMÁS viaja al detalle de la bitácora.
    expect(JSON.stringify(entrada.detalle)).not.toContain("token-secreto-no-debe-ir-a-bitacora");
  });
});
