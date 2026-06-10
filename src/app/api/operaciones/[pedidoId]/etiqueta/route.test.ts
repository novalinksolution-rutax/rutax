/**
 * Pruebas de GET /api/operaciones/:pedidoId/etiqueta (RF-021, item C-04).
 *
 * Cubre:
 * 1. 401 sin sesión.
 * 2. 403 sin la capacidad `asignar_y_reasignar_pedidos`.
 * 3. 404 si el pedido no existe en el tenant del usuario (incl. otro tenant).
 * 4. 400 si el pedido no tiene `ml_shipment_id`.
 * 5. 200 con el PDF + bitácora de auditoría en éxito.
 * 6. 409 si el adaptador lanza `ErrorConexionMlRequiereRevinculacion`.
 * 7. 502 ante cualquier otro error del adaptador (p. ej. `ErrorHttpMl`), sin
 *    exponer detalles internos.
 *
 * Mocks: sesión actual, cliente service_role, adaptador ML y bitácora —
 * sin red real ni Supabase real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/identidad/usuario-actual-servidor", () => ({
  obtenerSesionActual: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock("@/modules/identidad/auditoria", () => ({
  registrarEnBitacora: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/modules/integraciones/ml", async () => {
  const actual = await vi.importActual<object>("@/modules/integraciones/ml");
  return {
    ...actual,
    obtenerEtiquetaEnvio: vi.fn(),
  };
});

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import {
  obtenerEtiquetaEnvio,
  ErrorConexionMlRequiereRevinculacion,
} from "@/modules/integraciones/ml";
import { ErrorHttpMl } from "@/modules/integraciones/ml/cliente-http";
import { GET } from "./route";
import type { SesionActual } from "@/lib/identidad/usuario-actual-servidor";
import type { UsuarioActual } from "@/modules/identidad/usuario-actual";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const OTRO_TENANT_ID = "99999999-9999-9999-9999-999999999999";
const PEDIDO_ID = "22222222-2222-2222-2222-222222222222";
const SELLER_ID = "33333333-3333-3333-3333-333333333333";
const ML_SHIPMENT_ID = "555";
const USUARIO_ID = "44444444-4444-4444-4444-444444444444";

function crearUsuario(overrides: Partial<UsuarioActual> = {}): UsuarioActual {
  return {
    tenantId: TENANT_ID,
    tipoUsuario: "interno",
    sellerId: null,
    driverId: null,
    rol: "coordinador",
    estado: "activo",
    ...overrides,
  };
}

function crearSesion(overrides: Partial<UsuarioActual> = {}): SesionActual {
  return {
    usuarioId: USUARIO_ID,
    email: "coordinador@example.com",
    nombreCompleto: "Coordinador de Prueba",
    usuario: crearUsuario(overrides),
  };
}

/** Mock mínimo de `.from(...).select(...).eq(...).eq(...).maybeSingle()`. */
function crearMockSupabase(respuesta: { data: unknown; error: unknown }) {
  return {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(respuesta),
  };
}

function contexto(pedidoId: string = PEDIDO_ID) {
  return { params: Promise.resolve({ pedidoId }) };
}

describe("GET /api/operaciones/:pedidoId/etiqueta (RF-021)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("401 si no hay sesión", async () => {
    vi.mocked(obtenerSesionActual).mockResolvedValue(null);

    const respuesta = await GET({} as never, contexto());

    expect(respuesta.status).toBe(401);
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });

  it("403 si el usuario no tiene la capacidad de asignar/reasignar pedidos", async () => {
    // 'seller' no tiene 'asignar_y_reasignar_pedidos' en la matriz.
    vi.mocked(obtenerSesionActual).mockResolvedValue(
      crearSesion({ tipoUsuario: "seller", rol: "seller", sellerId: SELLER_ID }),
    );

    const respuesta = await GET({} as never, contexto());

    expect(respuesta.status).toBe(403);
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });

  it("404 si el pedido no existe en el tenant del usuario (incluye pedidos de otro tenant)", async () => {
    vi.mocked(obtenerSesionActual).mockResolvedValue(crearSesion({ tenantId: TENANT_ID }));

    const mockSupabase = crearMockSupabase({ data: null, error: null });
    vi.mocked(crearClienteServiceRole).mockReturnValue(mockSupabase as never);

    const respuesta = await GET({} as never, contexto());

    expect(respuesta.status).toBe(404);
    // Verificar que el filtro de aislamiento incluye el tenant del usuario.
    expect(mockSupabase.eq).toHaveBeenCalledWith("tenant_id", TENANT_ID);
    expect(mockSupabase.eq).not.toHaveBeenCalledWith("tenant_id", OTRO_TENANT_ID);
  });

  it("400 si el pedido no tiene ml_shipment_id asociado", async () => {
    vi.mocked(obtenerSesionActual).mockResolvedValue(crearSesion());

    const mockSupabase = crearMockSupabase({
      data: { id: PEDIDO_ID, seller_id: SELLER_ID, ml_shipment_id: null },
      error: null,
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(mockSupabase as never);

    const respuesta = await GET({} as never, contexto());
    const cuerpo = await respuesta.json();

    expect(respuesta.status).toBe(400);
    expect(cuerpo).toEqual({
      error: "Este pedido no tiene un envío de Mercado Libre asociado.",
    });
    expect(obtenerEtiquetaEnvio).not.toHaveBeenCalled();
  });

  it("200: responde el PDF y registra en bitácora de auditoría", async () => {
    vi.mocked(obtenerSesionActual).mockResolvedValue(crearSesion());

    const mockSupabase = crearMockSupabase({
      data: { id: PEDIDO_ID, seller_id: SELLER_ID, ml_shipment_id: ML_SHIPMENT_ID },
      error: null,
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(mockSupabase as never);

    const buffer = new ArrayBuffer(8);
    vi.mocked(obtenerEtiquetaEnvio).mockResolvedValue({
      contenido: buffer,
      contentType: "application/pdf",
    });

    const respuesta = await GET({} as never, contexto());
    const arrayBuffer = await respuesta.arrayBuffer();

    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get("Content-Type")).toBe("application/pdf");
    expect(respuesta.headers.get("Content-Disposition")).toBe(
      `inline; filename="etiqueta-${ML_SHIPMENT_ID}.pdf"`,
    );
    expect(arrayBuffer.byteLength).toBe(8);

    expect(obtenerEtiquetaEnvio).toHaveBeenCalledWith({
      sellerId: SELLER_ID,
      mlShipmentId: ML_SHIPMENT_ID,
    });

    expect(registrarEnBitacora).toHaveBeenCalledWith(
      mockSupabase,
      expect.objectContaining({
        tenantId: TENANT_ID,
        actorUsuarioId: USUARIO_ID,
        actorTipo: "usuario",
        accion: "operacion.etiqueta_descargada",
        entidadTipo: "pedido",
        entidadId: PEDIDO_ID,
        detalle: { ml_shipment_id: ML_SHIPMENT_ID, seller_id: SELLER_ID },
      }),
    );
  });

  it("409 si la conexión ML del seller requiere revinculación", async () => {
    vi.mocked(obtenerSesionActual).mockResolvedValue(crearSesion());

    const mockSupabase = crearMockSupabase({
      data: { id: PEDIDO_ID, seller_id: SELLER_ID, ml_shipment_id: ML_SHIPMENT_ID },
      error: null,
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(mockSupabase as never);

    vi.mocked(obtenerEtiquetaEnvio).mockRejectedValue(
      new ErrorConexionMlRequiereRevinculacion(SELLER_ID, "conexion-de-prueba"),
    );

    const respuesta = await GET({} as never, contexto());
    const cuerpo = await respuesta.json();

    expect(respuesta.status).toBe(409);
    expect(cuerpo).toEqual({
      error:
        "La conexión de Mercado Libre del seller requiere reconexión. No se puede obtener la etiqueta.",
    });
    expect(registrarEnBitacora).not.toHaveBeenCalled();
  });

  it("502 ante cualquier otro error del adaptador (p. ej. ErrorHttpMl), sin exponer detalles", async () => {
    vi.mocked(obtenerSesionActual).mockResolvedValue(crearSesion());

    const mockSupabase = crearMockSupabase({
      data: { id: PEDIDO_ID, seller_id: SELLER_ID, ml_shipment_id: ML_SHIPMENT_ID },
      error: null,
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(mockSupabase as never);

    vi.mocked(obtenerEtiquetaEnvio).mockRejectedValue(
      new ErrorHttpMl("Shipment not found", 404, { message: "Shipment not found" }),
    );

    vi.spyOn(console, "error").mockImplementation(() => {});

    const respuesta = await GET({} as never, contexto());
    const cuerpo = await respuesta.json();

    expect(respuesta.status).toBe(502);
    expect(cuerpo).toEqual({
      error: "No se pudo obtener la etiqueta desde Mercado Libre. Intenta nuevamente más tarde.",
    });
    expect(registrarEnBitacora).not.toHaveBeenCalled();
  });
});
