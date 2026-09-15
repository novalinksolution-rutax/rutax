/**
 * Pruebas de la pieza compartida de aceptación PASSWORDLESS de invitación
 * (F3) — usada por `/auth/callback` (Google) y por las Server Actions de
 * `/invitacion/[token]` (código OTP).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./invitaciones", () => ({ aceptarInvitacion: vi.fn() }));
vi.mock("./onboarding", () => ({ buscarPerfilPorAuthUserId: vi.fn() }));

import { aceptarInvitacion } from "./invitaciones";
import { buscarPerfilPorAuthUserId } from "./onboarding";
import {
  aplicarAceptacionInvitacionPasswordless,
  buscarInvitacionPorToken,
  resolverDestinoTrasAceptar,
  type ClienteAdminInvitacion,
} from "./aceptacion-invitacion-passwordless";

interface OpcionesClienteFalso {
  invitaciones?: Array<{ token: string; email: string; rol: string }>;
  perfil?: { tipo_usuario: string; seller_id: string | null; tenant_id: string | null } | null;
  errorInsertWhatsapp?: { code: string; message: string } | null;
}

function clienteFalso(opciones: OpcionesClienteFalso) {
  const bitacora: Array<Record<string, unknown>> = [];
  const whatsappContactos: Array<Record<string, unknown>> = [];

  function schema(nombre: string) {
    if (nombre === "identidad") {
      return {
        from(tabla: string) {
          if (tabla === "invitaciones") {
            return {
              select: () => ({
                eq: (_campo: string, valor: string) => ({
                  maybeSingle: async () => {
                    const fila = (opciones.invitaciones ?? []).find((i) => i.token === valor);
                    return { data: fila ? { email: fila.email, rol: fila.rol } : null, error: null };
                  },
                }),
              }),
            };
          }
          if (tabla === "usuarios_perfil") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: opciones.perfil ?? null, error: null }),
                }),
              }),
            };
          }
          throw new Error(`identidad.${tabla} no soportada en este doble`);
        },
      };
    }
    if (nombre === "integraciones") {
      return {
        from(tabla: string) {
          if (tabla === "whatsapp_contactos") {
            return {
              insert: async (fila: Record<string, unknown>) => {
                if (opciones.errorInsertWhatsapp) return { data: null, error: opciones.errorInsertWhatsapp };
                whatsappContactos.push(fila);
                return { data: null, error: null };
              },
            };
          }
          throw new Error(`integraciones.${tabla} no soportada en este doble`);
        },
      };
    }
    throw new Error(`schema ${nombre} no soportado en este doble`);
  }

  function from(tabla: string) {
    if (tabla === "bitacora_auditoria") {
      return {
        insert: async (fila: Record<string, unknown>) => {
          bitacora.push(fila);
          return { data: null, error: null };
        },
      };
    }
    throw new Error(`Tabla no soportada en este doble: ${tabla}`);
  }

  const cliente = { auth: {}, from, schema } as unknown as ClienteAdminInvitacion;
  return { cliente, bitacora, whatsappContactos };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
describe("buscarInvitacionPorToken", () => {
  it("token vacío → null sin tocar la base", async () => {
    const { cliente } = clienteFalso({});
    expect(await buscarInvitacionPorToken(cliente, "   ")).toBeNull();
  });

  it("token inexistente → null", async () => {
    const { cliente } = clienteFalso({ invitaciones: [] });
    expect(await buscarInvitacionPorToken(cliente, "no-existe")).toBeNull();
  });

  it("token válido de un seller → email en minúsculas + rol", async () => {
    const { cliente } = clienteFalso({
      invitaciones: [{ token: "tok-1", email: "Seller@Ejemplo.cl", rol: "seller" }],
    });
    expect(await buscarInvitacionPorToken(cliente, "tok-1")).toEqual({
      email: "seller@ejemplo.cl",
      rol: "seller",
    });
  });

  it("🔴 token de un CONDUCTOR → null (el conductor no pasa por acá, sigue con su PIN)", async () => {
    const { cliente } = clienteFalso({
      invitaciones: [{ token: "tok-conductor", email: "conductor@ejemplo.cl", rol: "conductor" }],
    });
    expect(await buscarInvitacionPorToken(cliente, "tok-conductor")).toBeNull();
  });
});

// =============================================================================
describe("resolverDestinoTrasAceptar", () => {
  it("seller → /portal/conectar-ml", () => {
    expect(resolverDestinoTrasAceptar("seller")).toBe("/portal/conectar-ml");
  });

  it.each(["dueno", "supervisor", "coordinador", "administracion"] as const)("%s → /", (rol) => {
    expect(resolverDestinoTrasAceptar(rol)).toBe("/");
  });
});

// =============================================================================
describe("aplicarAceptacionInvitacionPasswordless", () => {
  it("sin perfil previo: llama a aceptarInvitacion y resuelve el destino según el rol devuelto", async () => {
    vi.mocked(buscarPerfilPorAuthUserId).mockResolvedValue(null);
    vi.mocked(aceptarInvitacion).mockResolvedValue({ tenantId: "t-1", usuarioId: "auth-1", rol: "seller" });
    const { cliente } = clienteFalso({});

    const resultado = await aplicarAceptacionInvitacionPasswordless(cliente, {
      token: "tok-1",
      usuarioAuthId: "auth-1",
      nombreCompleto: "Juan Pérez",
    });

    expect(aceptarInvitacion).toHaveBeenCalledWith(cliente, {
      token: "tok-1",
      usuarioAuthId: "auth-1",
      nombreCompleto: "Juan Pérez",
    });
    expect(resultado).toEqual({ tenantId: "t-1", rol: "seller", destino: "/portal/conectar-ml" });
  });

  it("🔴 idempotencia: perfil YA existe para esta identidad → NO reintenta aceptarInvitacion", async () => {
    vi.mocked(buscarPerfilPorAuthUserId).mockResolvedValue({
      tenantId: "t-1",
      tipoUsuario: "interno",
      rol: "supervisor",
      estado: "activo",
    });
    const { cliente } = clienteFalso({});

    const resultado = await aplicarAceptacionInvitacionPasswordless(cliente, {
      token: "tok-1",
      usuarioAuthId: "auth-1",
      nombreCompleto: "Juan Pérez",
    });

    expect(aceptarInvitacion).not.toHaveBeenCalled();
    expect(resultado).toEqual({ tenantId: "t-1", rol: "supervisor", destino: "/" });
  });

  it("reaplica el WhatsApp del seller cuando hay opt-in + teléfono, con bitácora", async () => {
    vi.mocked(buscarPerfilPorAuthUserId).mockResolvedValue(null);
    vi.mocked(aceptarInvitacion).mockResolvedValue({ tenantId: "t-1", usuarioId: "auth-1", rol: "seller" });
    const { cliente, whatsappContactos, bitacora } = clienteFalso({
      perfil: { tipo_usuario: "seller", seller_id: "seller-1", tenant_id: "t-1" },
    });

    await aplicarAceptacionInvitacionPasswordless(cliente, {
      token: "tok-1",
      usuarioAuthId: "auth-1",
      nombreCompleto: "María Seller",
      whatsapp: { telefono: "+56 9 1234 5678", acepta: true },
    });

    expect(whatsappContactos).toHaveLength(1);
    expect(whatsappContactos[0]).toMatchObject({
      seller_id: "seller-1",
      tenant_id: "t-1",
      origen: "perfil_seller",
      opt_in_estado: "otorgado",
    });
    expect(bitacora).toHaveLength(1);
    expect(bitacora[0]).toMatchObject({ accion: "whatsapp.consentimiento_otorgado", entidad_id: "seller-1" });
    // El teléfono NUNCA va en el detalle de la bitácora — es dato personal.
    expect(JSON.stringify(bitacora[0])).not.toContain("1234");
  });

  it("NO guarda WhatsApp si no hay opt-in, aunque venga el teléfono", async () => {
    vi.mocked(buscarPerfilPorAuthUserId).mockResolvedValue(null);
    vi.mocked(aceptarInvitacion).mockResolvedValue({ tenantId: "t-1", usuarioId: "auth-1", rol: "seller" });
    const { cliente, whatsappContactos } = clienteFalso({
      perfil: { tipo_usuario: "seller", seller_id: "seller-1", tenant_id: "t-1" },
    });

    await aplicarAceptacionInvitacionPasswordless(cliente, {
      token: "tok-1",
      usuarioAuthId: "auth-1",
      nombreCompleto: "María Seller",
      whatsapp: { telefono: "+56 9 1234 5678", acepta: false },
    });

    expect(whatsappContactos).toHaveLength(0);
  });

  it("NO guarda WhatsApp para un interno, aunque venga marcado el opt-in (defensivo)", async () => {
    vi.mocked(buscarPerfilPorAuthUserId).mockResolvedValue(null);
    vi.mocked(aceptarInvitacion).mockResolvedValue({ tenantId: "t-1", usuarioId: "auth-1", rol: "supervisor" });
    const { cliente, whatsappContactos } = clienteFalso({
      perfil: { tipo_usuario: "interno", seller_id: null, tenant_id: "t-1" },
    });

    await aplicarAceptacionInvitacionPasswordless(cliente, {
      token: "tok-1",
      usuarioAuthId: "auth-1",
      nombreCompleto: "Carlos Interno",
      whatsapp: { telefono: "+56 9 1234 5678", acepta: true },
    });

    expect(whatsappContactos).toHaveLength(0);
  });

  it("un fallo al guardar el WhatsApp NO revierte la aceptación (best-effort)", async () => {
    vi.mocked(buscarPerfilPorAuthUserId).mockResolvedValue(null);
    vi.mocked(aceptarInvitacion).mockResolvedValue({ tenantId: "t-1", usuarioId: "auth-1", rol: "seller" });
    const { cliente } = clienteFalso({
      perfil: { tipo_usuario: "seller", seller_id: "seller-1", tenant_id: "t-1" },
      errorInsertWhatsapp: { code: "23503", message: "fk violada" },
    });

    await expect(
      aplicarAceptacionInvitacionPasswordless(cliente, {
        token: "tok-1",
        usuarioAuthId: "auth-1",
        nombreCompleto: "María Seller",
        whatsapp: { telefono: "+56 9 1234 5678", acepta: true },
      }),
    ).resolves.toMatchObject({ tenantId: "t-1", rol: "seller" });
  });
});
