import { AREAS_PRODUCTO } from "@/modules/identidad/areas-producto";
/**
 * Pruebas de las Server Actions de "Mi plan" (`configuracion/plan/actions.ts`).
 *
 * Foco: `exigirGestionSuscripcion()` — el preámbulo compartido — es la ÚNICA
 * puerta de entrada del courier al backstage `plataforma`. Se prueba de forma
 * ADVERSARIAL contra CADA rol/tipoUsuario que NO debe pasar (RNF-03), y que el
 * `tenantId`/`actorUsuarioId` que llegan a `superficie-courier.ts` SIEMPRE
 * salen del claim de la sesión — nunca de un parámetro que pudiera inyectar el
 * cliente (aquí no hay tal parámetro; se confirma que la función no tiene otro
 * canal de entrada para el tenant).
 *
 * `puedeGestionarSuscripcion` (capacidades.ts) NO se mockea a propósito: se
 * ejercita la matriz RBAC real (ya probada exhaustivamente en
 * `capacidades.test.ts`) para que este test cubra el ENSAMBLE completo
 * (sesión + tipoUsuario + capacidad), no solo la capacidad aislada.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/identidad/usuario-actual-servidor", () => ({
  exigirSesionActual: vi.fn(),
}));

vi.mock("@/modules/plataforma/superficie-courier", () => ({
  crearSuscripcionInicial: vi.fn(),
  iniciarEnrolamientoMandato: vi.fn(),
  cancelarMandatoAutoCobro: vi.fn(),
  cambiarPlanCourier: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { exigirSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import {
  iniciarEnrolamientoMandato,
  cancelarMandatoAutoCobro,
} from "@/modules/plataforma/superficie-courier";
// ⚠️ `crearSuscripcionInicialAction` y `solicitarCambioDePlanAction` se
// retiraron el 2026-08-28 con la cuota plana. El rechazo adversarial por rol se
// conserva ENTERO sobre la acción que queda: lo que protege no es una acción en
// particular, es que ninguna Server Action de esta pantalla acepte un tenant que
// no venga del claim.
import { activarAutoCobroAction, desactivarAutoCobroAction } from "./actions";
import type { SesionActual } from "@/lib/identidad/usuario-actual-servidor";
import type { UsuarioActual } from "@/modules/identidad/usuario-actual";
import type { Rol } from "@/modules/identidad/roles";

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const OTRO_TENANT = "99999999-9999-9999-9999-999999999999";
const USUARIO_ID = "44444444-4444-4444-4444-444444444444";

function crearUsuario(overrides: Partial<UsuarioActual> = {}): UsuarioActual {
  return {
    tenantId: TENANT_A,
    tipoUsuario: "interno",
    sellerId: null,
    driverId: null,
    rol: "dueno",
    estado: "activo",
    ...overrides,
    areasHabilitadas: overrides.areasHabilitadas ?? [...AREAS_PRODUCTO],
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

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// exigirGestionSuscripcion — rechazo adversarial por rol/tipoUsuario (RNF-03)
// =============================================================================

describe("Server Actions de plan — rechazo adversarial, cada rol/tipoUsuario NO autorizado", () => {
  it("seller: rechazado ('No autorizado.'), NUNCA llega a superficie-courier.ts", async () => {
    vi.mocked(exigirSesionActual).mockResolvedValue(
      crearSesion({ tipoUsuario: "seller", rol: "seller", sellerId: "seller-1", tenantId: TENANT_A }),
    );

    const resultado = await activarAutoCobroAction();

    expect(resultado).toEqual({ ok: false, error: "No autorizado." });
    expect(iniciarEnrolamientoMandato).not.toHaveBeenCalled();
  });

  it("conductor: rechazado ('No autorizado.')", async () => {
    vi.mocked(exigirSesionActual).mockResolvedValue(
      crearSesion({ tipoUsuario: "conductor", rol: "conductor", driverId: "driver-1", tenantId: TENANT_A }),
    );

    const resultado = await activarAutoCobroAction();

    expect(resultado).toEqual({ ok: false, error: "No autorizado." });
    expect(iniciarEnrolamientoMandato).not.toHaveBeenCalled();
  });

  it("super_admin: rechazado ('No autorizado.'), aunque intente 'gestionar' su propio tenant fantasma", async () => {
    vi.mocked(exigirSesionActual).mockResolvedValue(
      crearSesion({ tipoUsuario: "super_admin", rol: "super_admin", tenantId: null }),
    );

    const resultado = await desactivarAutoCobroAction();

    expect(resultado).toEqual({ ok: false, error: "No autorizado." });
    expect(cancelarMandatoAutoCobro).not.toHaveBeenCalled();
  });

  // Roles internos SIN la capacidad `gestionar_suscripcion` (privativa del dueño).
  const rolesInternosSinCapacidad: Rol[] = ["supervisor", "coordinador", "administracion"];
  it.each(rolesInternosSinCapacidad)(
    "interno con rol '%s' (sin gestionar_suscripcion): rechazado ('No autorizado.')",
    async (rol) => {
      vi.mocked(exigirSesionActual).mockResolvedValue(
        crearSesion({ tipoUsuario: "interno", rol, tenantId: TENANT_A }),
      );

      const resultado = await activarAutoCobroAction();

      expect(resultado).toEqual({ ok: false, error: "No autorizado." });
      expect(iniciarEnrolamientoMandato).not.toHaveBeenCalled();
    },
  );

  it("interno dueño pero SIN tenantId (borde defensivo, no debería ocurrir en prod): rechazado", async () => {
    vi.mocked(exigirSesionActual).mockResolvedValue(
      crearSesion({ tipoUsuario: "interno", rol: "dueno", tenantId: null }),
    );

    const resultado = await activarAutoCobroAction();

    expect(resultado).toEqual({ ok: false, error: "No autorizado." });
    expect(iniciarEnrolamientoMandato).not.toHaveBeenCalled();
  });

  it("usuario invitado/suspendido con rol dueno: rechazado (RNF-03 — estado de cuenta manda sobre el rol)", async () => {
    vi.mocked(exigirSesionActual).mockResolvedValue(
      crearSesion({ tipoUsuario: "interno", rol: "dueno", tenantId: TENANT_A, estado: "suspendido" }),
    );

    const resultado = await activarAutoCobroAction();

    expect(resultado).toEqual({ ok: false, error: "No autorizado." });
    expect(iniciarEnrolamientoMandato).not.toHaveBeenCalled();
  });

  it("sin sesión activa: el error de exigirSesionActual() se propaga como { ok:false }", async () => {
    vi.mocked(exigirSesionActual).mockRejectedValue(new Error("No hay una sesión activa."));

    const resultado = await activarAutoCobroAction();

    expect(resultado).toEqual({ ok: false, error: "No hay una sesión activa." });
    expect(iniciarEnrolamientoMandato).not.toHaveBeenCalled();
  });

});

// =============================================================================
// Camino feliz (rol dueno) — el tenantId/actorUsuarioId SIEMPRE salen del claim
// =============================================================================

describe("Server Actions de plan — camino feliz (dueño), tenant forzado por el claim", () => {
  it("activarAutoCobroAction: usa tenantId/actorUsuarioId del CLAIM, nunca de otro canal", async () => {
    // Lo que protege esta prueba no es la acción: es que el tenant SIEMPRE salga
    // del claim y nunca de un parámetro. Cuando se retiró el alta self-serve,
    // esta cobertura se mudó a la acción que queda en la pantalla.
    vi.mocked(exigirSesionActual).mockResolvedValue(crearSesion({ rol: "dueno", tenantId: TENANT_A }));
    vi.mocked(iniciarEnrolamientoMandato).mockResolvedValue({
      ok: true,
      urlEnrolamiento: "https://fintoc.example/enrolar",
    });

    const resultado = await activarAutoCobroAction();

    expect(resultado).toEqual({ ok: true, urlEnrolamiento: "https://fintoc.example/enrolar" });
    expect(iniciarEnrolamientoMandato).toHaveBeenCalledWith({
      tenantId: TENANT_A,
      actorUsuarioId: USUARIO_ID,
    });
    // Nunca se le pasó el tenant equivocado, sin importar qué exista "afuera".
    expect(iniciarEnrolamientoMandato).not.toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: OTRO_TENANT }),
    );
  });

  it("activarAutoCobroAction: usa tenantId/actorUsuarioId del claim", async () => {
    vi.mocked(exigirSesionActual).mockResolvedValue(crearSesion({ rol: "dueno", tenantId: TENANT_A }));
    vi.mocked(iniciarEnrolamientoMandato).mockResolvedValue({
      ok: true,
      urlEnrolamiento: "https://sandbox.fintoc.local/enrolar/x",
    });

    const resultado = await activarAutoCobroAction();

    expect(resultado).toEqual({ ok: true, urlEnrolamiento: "https://sandbox.fintoc.local/enrolar/x" });
    expect(iniciarEnrolamientoMandato).toHaveBeenCalledWith({
      tenantId: TENANT_A,
      actorUsuarioId: USUARIO_ID,
    });
  });

  it("desactivarAutoCobroAction: usa tenantId/actorUsuarioId del claim", async () => {
    vi.mocked(exigirSesionActual).mockResolvedValue(crearSesion({ rol: "dueno", tenantId: TENANT_A }));
    vi.mocked(cancelarMandatoAutoCobro).mockResolvedValue({ ok: true });

    const resultado = await desactivarAutoCobroAction();

    expect(resultado).toEqual({ ok: true });
    expect(cancelarMandatoAutoCobro).toHaveBeenCalledWith({
      tenantId: TENANT_A,
      actorUsuarioId: USUARIO_ID,
    });
  });

  it("administracion (financiero courier→seller) sigue SIN poder gestionar la suscripción a Rutax", async () => {
    // Regresión explícita del hallazgo de capacidades.ts: administración
    // gestiona facturación courier→seller, pero NO la suscripción Rutax.
    vi.mocked(exigirSesionActual).mockResolvedValue(
      crearSesion({ tipoUsuario: "interno", rol: "administracion", tenantId: TENANT_A }),
    );

    const resultado = await activarAutoCobroAction();

    expect(resultado).toEqual({ ok: false, error: "No autorizado." });
    expect(iniciarEnrolamientoMandato).not.toHaveBeenCalled();
  });

});
