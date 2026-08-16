/**
 * Pruebas de GET /api/portal/pedidos/:pedidoId/etiqueta.
 *
 * Cubre:
 * 1. 401 sin sesión.
 * 2. 401 si el usuario no es 'seller' (o no tiene sellerId).
 * 3. 403 sin la capacidad `descargar_etiqueta_same_day`.
 * 4. 404 si el pedido no existe, o no es del tenant, o no es del seller
 *    (aislamiento por sellerId — nunca confiar en la URL).
 * 5. 400 si el pedido no es same_day.
 * 6. 200 con el PDF + bitácora de auditoría ANTES de responder, respetando
 *    ?formato=.
 * 7. Backfill perezoso: si el pedido no tiene codigo_interno, se genera vía
 *    `asegurarCodigoInterno`.
 *
 * Mocks: sesión actual, cliente service_role, generador de PDF, backfill de
 * código y bitácora — sin red real ni Supabase real.
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

vi.mock("@/modules/operacion/pedidos", () => ({
  asegurarCodigoInterno: vi.fn(),
}));

vi.mock("@/modules/operacion/etiqueta-same-day-pdf", () => ({
  generarEtiquetaSameDayPdf: vi.fn(),
}));

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { asegurarCodigoInterno } from "@/modules/operacion/pedidos";
import { generarEtiquetaSameDayPdf } from "@/modules/operacion/etiqueta-same-day-pdf";
import { GET } from "./route";
import type { SesionActual } from "@/lib/identidad/usuario-actual-servidor";
import type { UsuarioActual } from "@/modules/identidad/usuario-actual";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const OTRO_TENANT_ID = "99999999-9999-9999-9999-999999999999";
const PEDIDO_ID = "22222222-2222-2222-2222-222222222222";
const SELLER_ID = "33333333-3333-3333-3333-333333333333";
const OTRO_SELLER_ID = "88888888-8888-8888-8888-888888888888";
const USUARIO_ID = "44444444-4444-4444-4444-444444444444";
const CODIGO_INTERNO = "RX-7K2M-9QP4";

function crearUsuario(overrides: Partial<UsuarioActual> = {}): UsuarioActual {
  return {
    tenantId: TENANT_ID,
    tipoUsuario: "seller",
    sellerId: SELLER_ID,
    driverId: null,
    rol: "seller",
    estado: "activo",
    ...overrides,
  };
}

function crearSesion(overrides: Partial<UsuarioActual> = {}): SesionActual {
  return {
    usuarioId: USUARIO_ID,
    email: "seller@example.com",
    nombreCompleto: "Seller de Prueba",
    usuario: crearUsuario(overrides),
  };
}

function pedidoFila(overrides: Record<string, unknown> = {}) {
  return {
    id: PEDIDO_ID,
    tenant_id: TENANT_ID,
    seller_id: SELLER_ID,
    fuente: "rutax_manual", tipo_pedido: "same_day",
    codigo_interno: null,
    destinatario_nombre: "Juan Pérez",
    destinatario_direccion: "Av. Providencia 123",
    destinatario_comuna: "Providencia",
    destinatario_telefono: null,
    instrucciones_entrega: null,
    fecha_compromiso: "2026-07-02",
    ...overrides,
  };
}

/** Mock de `.from('pedidos').select().eq().eq().eq().maybeSingle()` y `.from('sellers')...`. */
function crearMockSupabase(opts: {
  pedido?: { data: unknown; error: unknown };
  seller?: { data: unknown; error: unknown };
}) {
  const pedidoResp = opts.pedido ?? { data: pedidoFila(), error: null };
  const sellerResp = opts.seller ?? { data: { razon_social: "Tienda Demo" }, error: null };

  return {
    from: vi.fn((tabla: string) => {
      if (tabla === "pedidos") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue(pedidoResp),
        };
      }
      if (tabla === "sellers") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue(sellerResp),
        };
      }
      throw new Error(`Tabla no mockeada: ${tabla}`);
    }),
  };
}

function contexto(pedidoId: string = PEDIDO_ID) {
  return { params: Promise.resolve({ pedidoId }) };
}

function crearRequest(url = "http://localhost/api/portal/pedidos/x/etiqueta") {
  return { nextUrl: new URL(url) } as never;
}

describe("GET /api/portal/pedidos/:pedidoId/etiqueta", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("401 si no hay sesión", async () => {
    vi.mocked(obtenerSesionActual).mockResolvedValue(null);

    const respuesta = await GET(crearRequest(), contexto());

    expect(respuesta.status).toBe(401);
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });

  it("401 si el usuario no es seller", async () => {
    vi.mocked(obtenerSesionActual).mockResolvedValue(
      crearSesion({ tipoUsuario: "interno", rol: "coordinador", sellerId: null }),
    );

    const respuesta = await GET(crearRequest(), contexto());

    expect(respuesta.status).toBe(401);
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });

  it("401 si el seller no tiene sellerId en su sesión", async () => {
    vi.mocked(obtenerSesionActual).mockResolvedValue(
      crearSesion({ sellerId: null }),
    );

    const respuesta = await GET(crearRequest(), contexto());

    expect(respuesta.status).toBe(401);
  });

  it("403 si el usuario no tiene la capacidad descargar_etiqueta_same_day", async () => {
    // 'conductor' no tiene la capacidad, pero forzamos tipoUsuario seller con
    // rol conductor para ejercitar el gate por capacidad (no solo tipoUsuario).
    vi.mocked(obtenerSesionActual).mockResolvedValue(
      crearSesion({ rol: "conductor" as never }),
    );

    const respuesta = await GET(crearRequest(), contexto());

    expect(respuesta.status).toBe(403);
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });

  it("404 si el pedido no existe (o es de otro tenant/seller)", async () => {
    vi.mocked(obtenerSesionActual).mockResolvedValue(crearSesion());
    const mockSupabase = crearMockSupabase({ pedido: { data: null, error: null } });
    vi.mocked(crearClienteServiceRole).mockReturnValue(mockSupabase as never);

    const respuesta = await GET(crearRequest(), contexto());

    expect(respuesta.status).toBe(404);
  });

  it("el filtro de aislamiento incluye tenant_id y seller_id del usuario, no otros", async () => {
    vi.mocked(obtenerSesionActual).mockResolvedValue(crearSesion());
    const mockSupabase = crearMockSupabase({ pedido: { data: null, error: null } });
    vi.mocked(crearClienteServiceRole).mockReturnValue(mockSupabase as never);

    await GET(crearRequest(), contexto());

    const llamadaPedidos = mockSupabase.from.mock.results.find(
      (_r, i) => mockSupabase.from.mock.calls[i][0] === "pedidos",
    );
    expect(llamadaPedidos).toBeDefined();
    const eqMock = (llamadaPedidos!.value as { eq: ReturnType<typeof vi.fn> }).eq;
    expect(eqMock).toHaveBeenCalledWith("tenant_id", TENANT_ID);
    expect(eqMock).toHaveBeenCalledWith("seller_id", SELLER_ID);
    expect(eqMock).not.toHaveBeenCalledWith("tenant_id", OTRO_TENANT_ID);
    expect(eqMock).not.toHaveBeenCalledWith("seller_id", OTRO_SELLER_ID);
  });

  it("400 si la etiqueta la emite la fuente y no Rutax", async () => {
    vi.mocked(obtenerSesionActual).mockResolvedValue(crearSesion());
    const mockSupabase = crearMockSupabase({
      pedido: { data: pedidoFila({ fuente: "ml_flex", tipo_pedido: "flex" }), error: null },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(mockSupabase as never);

    const respuesta = await GET(crearRequest(), contexto());
    const cuerpo = await respuesta.json();

    expect(respuesta.status).toBe(400);
    expect(cuerpo).toEqual({
      error: "La etiqueta de este pedido la emite Mercado Libre, no Rutax.",
    });
    expect(asegurarCodigoInterno).not.toHaveBeenCalled();
  });

  it("200: genera el PDF, hace backfill del código y registra en bitácora ANTES de responder", async () => {
    vi.mocked(obtenerSesionActual).mockResolvedValue(crearSesion());
    const mockSupabase = crearMockSupabase({});
    vi.mocked(crearClienteServiceRole).mockReturnValue(mockSupabase as never);
    vi.mocked(asegurarCodigoInterno).mockResolvedValue(CODIGO_INTERNO);

    const ordenLlamadas: string[] = [];
    vi.mocked(registrarEnBitacora).mockImplementation(async () => {
      ordenLlamadas.push("bitacora");
    });
    vi.mocked(generarEtiquetaSameDayPdf).mockImplementation(async () => {
      ordenLlamadas.push("pdf");
      return Buffer.from("pdf-fake");
    });

    const respuesta = await GET(crearRequest(), contexto());
    const arrayBuffer = await respuesta.arrayBuffer();

    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get("Content-Type")).toBe("application/pdf");
    expect(respuesta.headers.get("Content-Disposition")).toBe(
      `inline; filename="etiqueta-${CODIGO_INTERNO}.pdf"`,
    );
    expect(Buffer.from(arrayBuffer).toString()).toBe("pdf-fake");

    expect(asegurarCodigoInterno).toHaveBeenCalledWith(
      mockSupabase,
      expect.objectContaining({ id: PEDIDO_ID, tenantId: TENANT_ID }),
    );

    // Bitácora ANTES de generar el PDF (invariante CLAUDE.md).
    expect(ordenLlamadas).toEqual(["bitacora", "pdf"]);

    expect(registrarEnBitacora).toHaveBeenCalledWith(
      mockSupabase,
      expect.objectContaining({
        tenantId: TENANT_ID,
        actorUsuarioId: USUARIO_ID,
        actorTipo: "usuario",
        accion: "operacion.etiqueta_same_day_descargada",
        entidadTipo: "pedido",
        entidadId: PEDIDO_ID,
        detalle: expect.objectContaining({
          codigo_interno: CODIGO_INTERNO,
          seller_id: SELLER_ID,
          formato: "termica",
        }),
      }),
    );
  });

  it("respeta ?formato=carta", async () => {
    vi.mocked(obtenerSesionActual).mockResolvedValue(crearSesion());
    const mockSupabase = crearMockSupabase({});
    vi.mocked(crearClienteServiceRole).mockReturnValue(mockSupabase as never);
    vi.mocked(asegurarCodigoInterno).mockResolvedValue(CODIGO_INTERNO);
    vi.mocked(generarEtiquetaSameDayPdf).mockResolvedValue(Buffer.from("pdf"));

    await GET(
      crearRequest("http://localhost/api/portal/pedidos/x/etiqueta?formato=carta"),
      contexto(),
    );

    expect(generarEtiquetaSameDayPdf).toHaveBeenCalledWith(
      expect.objectContaining({ formato: "carta" }),
    );
  });

  it("502 si asegurarCodigoInterno falla, sin exponer detalles internos", async () => {
    vi.mocked(obtenerSesionActual).mockResolvedValue(crearSesion());
    const mockSupabase = crearMockSupabase({});
    vi.mocked(crearClienteServiceRole).mockReturnValue(mockSupabase as never);
    vi.mocked(asegurarCodigoInterno).mockRejectedValue(new Error("fallo interno de BD"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const respuesta = await GET(crearRequest(), contexto());
    const cuerpo = await respuesta.json();

    expect(respuesta.status).toBe(502);
    expect(JSON.stringify(cuerpo)).not.toContain("fallo interno de BD");
  });
});
