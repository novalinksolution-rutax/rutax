/**
 * Pruebas de `POST /api/conductor/aceptar-invitacion` (F4.a).
 *
 * Foco:
 *   - Sin Bearer válido → 401, sin llamar al módulo de dominio.
 *   - El teléfono SIEMPRE sale del token (`autenticarBearerSoloAuth`), nunca
 *     del body — no hay ni forma de mandarlo por ahí.
 *   - `sin_invitacion` / `seleccionar_courier` / éxito se traducen 1:1 al
 *     shape de respuesta acordado.
 *   - Falta el nombre completo en el body → 400, sin tocar el módulo de dominio.
 *
 * Molde: `src/app/api/conductor/manifiesto/iniciar/route.test.ts` (`vi.mock`
 * de `autenticar-bearer` y `service-role`, `Request` crudo como `NextRequest`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/autenticar-bearer", () => ({
  autenticarBearerSoloAuth: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: vi.fn(() => ({})),
}));

vi.mock("@/modules/identidad/invitaciones", () => ({
  aceptarInvitacionPorTelefono: vi.fn(),
}));

import { autenticarBearerSoloAuth } from "@/lib/supabase/autenticar-bearer";
import { aceptarInvitacionPorTelefono } from "@/modules/identidad/invitaciones";
import { POST } from "./route";

function crearRequest(body: unknown, headers: Record<string, string> = { authorization: "Bearer token-otp" }) {
  return new Request("http://localhost/api/conductor/aceptar-invitacion", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/conductor/aceptar-invitacion", () => {
  it("rechaza sin Bearer válido, sin llamar al módulo de dominio", async () => {
    vi.mocked(autenticarBearerSoloAuth).mockResolvedValue(null);

    const respuesta = await POST(crearRequest({ nombreCompleto: "Pedro Conductor" }));

    expect(respuesta.status).toBe(401);
    expect(aceptarInvitacionPorTelefono).not.toHaveBeenCalled();
  });

  it("rechaza si el usuario de Auth no tiene teléfono verificado utilizable", async () => {
    vi.mocked(autenticarBearerSoloAuth).mockResolvedValue({ usuarioId: "auth-1", telefono: null });

    const respuesta = await POST(crearRequest({ nombreCompleto: "Pedro Conductor" }));

    expect(respuesta.status).toBe(400);
    expect(aceptarInvitacionPorTelefono).not.toHaveBeenCalled();
  });

  it("rechaza sin nombreCompleto en el body, sin llamar al módulo de dominio", async () => {
    vi.mocked(autenticarBearerSoloAuth).mockResolvedValue({ usuarioId: "auth-1", telefono: "56911111111" });

    const respuesta = await POST(crearRequest({}));

    expect(respuesta.status).toBe(400);
    expect(aceptarInvitacionPorTelefono).not.toHaveBeenCalled();
  });

  it("el teléfono viaja SIEMPRE desde el token, nunca desde el body", async () => {
    vi.mocked(autenticarBearerSoloAuth).mockResolvedValue({ usuarioId: "auth-1", telefono: "56911111111" });
    vi.mocked(aceptarInvitacionPorTelefono).mockResolvedValue({
      ok: true,
      tenantId: "tenant-1",
      usuarioId: "auth-1",
      rol: "conductor",
    });

    // Un teléfono distinto en el body se IGNORA por completo.
    await POST(crearRequest({ nombreCompleto: "Pedro Conductor", telefonoE164: "56999999999" }));

    expect(aceptarInvitacionPorTelefono).toHaveBeenCalledTimes(1);
    const [, argumentos] = vi.mocked(aceptarInvitacionPorTelefono).mock.calls[0];
    expect(argumentos).toMatchObject({ telefonoE164: "56911111111", usuarioAuthId: "auth-1" });
  });

  it("éxito: responde {ok:true, destino:'/'}", async () => {
    vi.mocked(autenticarBearerSoloAuth).mockResolvedValue({ usuarioId: "auth-1", telefono: "56911111111" });
    vi.mocked(aceptarInvitacionPorTelefono).mockResolvedValue({
      ok: true,
      tenantId: "tenant-1",
      usuarioId: "auth-1",
      rol: "conductor",
    });

    const respuesta = await POST(crearRequest({ nombreCompleto: "Pedro Conductor" }));
    const cuerpo = await respuesta.json();

    expect(cuerpo).toEqual({ ok: true, destino: "/" });
  });

  it("sin_invitacion: responde {ok:false, motivo:'sin_invitacion'}", async () => {
    vi.mocked(autenticarBearerSoloAuth).mockResolvedValue({ usuarioId: "auth-1", telefono: "56911111111" });
    vi.mocked(aceptarInvitacionPorTelefono).mockResolvedValue({ ok: false, motivo: "sin_invitacion" });

    const respuesta = await POST(crearRequest({ nombreCompleto: "Pedro Conductor" }));
    const cuerpo = await respuesta.json();

    expect(cuerpo).toEqual({ ok: false, motivo: "sin_invitacion" });
  });

  it("seleccionar_courier: responde {ok:false, motivo:'seleccionar_courier', couriers:[...]}", async () => {
    vi.mocked(autenticarBearerSoloAuth).mockResolvedValue({ usuarioId: "auth-1", telefono: "56911111111" });
    vi.mocked(aceptarInvitacionPorTelefono).mockResolvedValue({
      ok: false,
      motivo: "seleccionar_courier",
      couriers: [{ tenantId: "tenant-1", nombreCourier: "Despachos del Centro" }],
    });

    const respuesta = await POST(crearRequest({ nombreCompleto: "Pedro Conductor" }));
    const cuerpo = await respuesta.json();

    expect(cuerpo).toEqual({
      ok: false,
      motivo: "seleccionar_courier",
      couriers: [{ tenantId: "tenant-1", nombreCourier: "Despachos del Centro" }],
    });
  });

  it("pasa el tenantId del body cuando viene, para desambiguar el selector", async () => {
    vi.mocked(autenticarBearerSoloAuth).mockResolvedValue({ usuarioId: "auth-1", telefono: "56911111111" });
    vi.mocked(aceptarInvitacionPorTelefono).mockResolvedValue({
      ok: true,
      tenantId: "tenant-2",
      usuarioId: "auth-1",
      rol: "conductor",
    });

    await POST(crearRequest({ nombreCompleto: "Pedro Conductor", tenantId: "tenant-2" }));

    const [, argumentos] = vi.mocked(aceptarInvitacionPorTelefono).mock.calls[0];
    expect(argumentos).toMatchObject({ tenantId: "tenant-2" });
  });

  it("un error inesperado del módulo de dominio responde 500 sin filtrar detalles internos", async () => {
    vi.mocked(autenticarBearerSoloAuth).mockResolvedValue({ usuarioId: "auth-1", telefono: "56911111111" });
    vi.mocked(aceptarInvitacionPorTelefono).mockRejectedValue(new Error("fallo de base simulado"));

    const respuesta = await POST(crearRequest({ nombreCompleto: "Pedro Conductor" }));
    const cuerpo = await respuesta.json();

    expect(respuesta.status).toBe(500);
    expect(JSON.stringify(cuerpo)).not.toContain("fallo de base simulado");
  });
});
