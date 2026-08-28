/**
 * Pruebas de GET /api/courier/plataforma/comprobantes/:periodoId.
 *
 * Foco (aislamiento adversarial — el caso EXPLÍCITO del prompt de QA): un
 * `periodoId` sintácticamente válido pero de OTRO tenant nunca debe filtrar
 * datos — la ruta SIEMPRE pasa el `tenantId` del claim de sesión a
 * `obtenerComprobantePago` (nunca uno que el cliente pudiera insinuar), y un
 * resultado `null` (período ajeno, inexistente, o sin pago confirmado) es
 * SIEMPRE 404, nunca una fuga de "existe pero no es tuyo".
 *
 * `puedeGestionarSuscripcion` (capacidades.ts) NO se mockea — se ejercita la
 * matriz RBAC real para cubrir el gate de rol de punta a punta (mismo criterio
 * que `actions.test.ts` de la pantalla equivalente).
 *
 * Mocks: sesión actual, `obtenerComprobantePago` (ya probado exhaustivamente
 * en `superficie-courier.test.ts`) y el generador de PDF — sin red real ni
 * Supabase real.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/identidad/usuario-actual-servidor", () => ({
  obtenerSesionActual: vi.fn(),
}));

vi.mock("@/modules/plataforma/superficie-courier", () => ({
  obtenerComprobantePago: vi.fn(),
}));

vi.mock("@/modules/plataforma/comprobante-pago-pdf", () => ({
  generarPdfComprobantePago: vi.fn(),
}));

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { obtenerComprobantePago } from "@/modules/plataforma/superficie-courier";
import { generarPdfComprobantePago } from "@/modules/plataforma/comprobante-pago-pdf";
import { GET } from "./route";
import type { SesionActual } from "@/lib/identidad/usuario-actual-servidor";
import type { UsuarioActual } from "@/modules/identidad/usuario-actual";
import { AREAS_PRODUCTO } from "@/modules/identidad/areas-producto";

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const OTRO_TENANT = "99999999-9999-9999-9999-999999999999";
const PERIODO_DE_OTRO_TENANT = "periodo-de-otro-tenant";
const USUARIO_ID = "44444444-4444-4444-4444-444444444444";

function crearUsuario(overrides: Partial<UsuarioActual> = {}): UsuarioActual {
  return {
    tenantId: TENANT_A,
    tipoUsuario: "interno",
    sellerId: null,
    driverId: null,
    rol: "dueno",
    estado: "activo",
    areasHabilitadas: [...AREAS_PRODUCTO],
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

function contexto(periodoId: string) {
  return { params: Promise.resolve({ periodoId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/courier/plataforma/comprobantes/:periodoId — auth y RBAC", () => {
  it("401 sin sesión", async () => {
    vi.mocked(obtenerSesionActual).mockResolvedValue(null);

    const respuesta = await GET({} as never, contexto("periodo-1"));

    expect(respuesta.status).toBe(401);
    expect(obtenerComprobantePago).not.toHaveBeenCalled();
  });

  it("401 si la sesión no trae tenantId (p. ej. super_admin)", async () => {
    vi.mocked(obtenerSesionActual).mockResolvedValue(
      crearSesion({ tipoUsuario: "super_admin", rol: "super_admin", tenantId: null }),
    );

    const respuesta = await GET({} as never, contexto("periodo-1"));

    expect(respuesta.status).toBe(401);
    expect(obtenerComprobantePago).not.toHaveBeenCalled();
  });

  it.each([
    ["seller", "seller"],
    ["conductor", "conductor"],
    ["supervisor", "interno"],
    ["coordinador", "interno"],
    ["administracion", "interno"],
  ] as const)("403 con rol '%s' (sin gestionar_suscripcion)", async (rol, tipoUsuario) => {
    vi.mocked(obtenerSesionActual).mockResolvedValue(
      crearSesion({ rol, tipoUsuario, sellerId: tipoUsuario === "seller" ? "seller-1" : null }),
    );

    const respuesta = await GET({} as never, contexto("periodo-1"));

    expect(respuesta.status).toBe(403);
    expect(obtenerComprobantePago).not.toHaveBeenCalled();
  });
});

describe("GET /api/courier/plataforma/comprobantes/:periodoId — aislamiento adversarial", () => {
  it("periodoId VÁLIDO de OTRO tenant → 404 (nunca expone que el período existe)", async () => {
    vi.mocked(obtenerSesionActual).mockResolvedValue(crearSesion({ tenantId: TENANT_A }));
    // `obtenerComprobantePago` ya está probado para devolver null ante un
    // período de otro tenant (superficie-courier.test.ts) — aquí se simula
    // exactamente ese contrato para probar que la ruta lo traduce a 404.
    vi.mocked(obtenerComprobantePago).mockResolvedValue(null);

    const respuesta = await GET({} as never, contexto(PERIODO_DE_OTRO_TENANT));
    const cuerpo = await respuesta.json();

    expect(respuesta.status).toBe(404);
    expect(cuerpo).toEqual({ error: "No encontramos un pago confirmado para este período." });

    // La ruta SIEMPRE pasa el tenantId del CLAIM — nunca uno que el cliente
    // pudiera insinuar (aquí solo controla el periodoId vía la URL).
    expect(obtenerComprobantePago).toHaveBeenCalledWith({
      tenantId: TENANT_A,
      periodoId: PERIODO_DE_OTRO_TENANT,
    });
    expect(obtenerComprobantePago).not.toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: OTRO_TENANT }),
    );
    expect(generarPdfComprobantePago).not.toHaveBeenCalled();
  });

  it("periodo propio sin pago confirmado (pendiente/fallido) → 404, mismo mensaje genérico", async () => {
    vi.mocked(obtenerSesionActual).mockResolvedValue(crearSesion({ tenantId: TENANT_A }));
    vi.mocked(obtenerComprobantePago).mockResolvedValue(null);

    const respuesta = await GET({} as never, contexto("periodo-propio-sin-pago"));

    expect(respuesta.status).toBe(404);
  });
});

describe("GET /api/courier/plataforma/comprobantes/:periodoId — camino feliz y errores", () => {
  const COMPROBANTE = {
    periodoId: "periodo-1",
    tenantNombre: "Courier Uno",
    planNombre: "Starter",
    periodoInicio: "2026-07-01",
    periodoFin: "2026-07-31",
    montoClp: 19990,
    metodo: "fintoc_link" as const,
    pagadoEn: "2026-07-05T00:00:00.000Z",
  };

  it("200: responde el PDF con headers correctos", async () => {
    vi.mocked(obtenerSesionActual).mockResolvedValue(crearSesion({ tenantId: TENANT_A }));
    vi.mocked(obtenerComprobantePago).mockResolvedValue(COMPROBANTE);
    vi.mocked(generarPdfComprobantePago).mockResolvedValue(Buffer.from("pdf-comprobante"));

    const respuesta = await GET({} as never, contexto("periodo-1"));
    const arrayBuffer = await respuesta.arrayBuffer();

    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get("Content-Type")).toBe("application/pdf");
    expect(respuesta.headers.get("Content-Disposition")).toContain("attachment");
    expect(Buffer.from(arrayBuffer).toString()).toBe("pdf-comprobante");
    expect(generarPdfComprobantePago).toHaveBeenCalledWith(COMPROBANTE);
  });

  it("502 si la generación del PDF falla, sin exponer detalles internos", async () => {
    vi.mocked(obtenerSesionActual).mockResolvedValue(crearSesion({ tenantId: TENANT_A }));
    vi.mocked(obtenerComprobantePago).mockResolvedValue(COMPROBANTE);
    vi.mocked(generarPdfComprobantePago).mockRejectedValue(new Error("fallo interno de render"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const respuesta = await GET({} as never, contexto("periodo-1"));
    const cuerpo = await respuesta.json();

    expect(respuesta.status).toBe(502);
    expect(JSON.stringify(cuerpo)).not.toContain("fallo interno de render");
  });

  it("502 si obtenerComprobantePago lanza (p. ej. error de BD), sin exponer detalles internos", async () => {
    vi.mocked(obtenerSesionActual).mockResolvedValue(crearSesion({ tenantId: TENANT_A }));
    vi.mocked(obtenerComprobantePago).mockRejectedValue(new Error("Error al leer el período: timeout"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const respuesta = await GET({} as never, contexto("periodo-1"));
    const cuerpo = await respuesta.json();

    expect(respuesta.status).toBe(502);
    expect(JSON.stringify(cuerpo)).not.toContain("timeout");
  });
});
