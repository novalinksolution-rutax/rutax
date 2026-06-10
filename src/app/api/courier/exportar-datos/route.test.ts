/**
 * Pruebas de GET /api/courier/exportar-datos (RNF-13, item H-07).
 *
 * Cubre:
 * 1. 401 sin sesión.
 * 2. 403 sin la capacidad `ver_bitacora_auditoria` (p. ej. rol supervisor).
 * 3. 200 con la capacidad (rol dueno y rol administracion).
 * 4. Headers `Content-Type` / `Content-Disposition`.
 * 5. El JSON resultante NO contiene claves relacionadas a tokens/certificados.
 * 6. Bitácora registrada con conteos por tabla (sin contenido).
 * 7. Una tabla que falla no rompe el export — se registra en `_errores` y las
 *    demás continúan.
 *
 * Mocks: sesión actual, cliente service_role y bitácora — sin red real ni
 * Supabase real.
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

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { GET } from "./route";
import type { SesionActual } from "@/lib/identidad/usuario-actual-servidor";
import type { UsuarioActual } from "@/modules/identidad/usuario-actual";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const USUARIO_ID = "44444444-4444-4444-4444-444444444444";

function crearUsuario(overrides: Partial<UsuarioActual> = {}): UsuarioActual {
  return {
    tenantId: TENANT_ID,
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

/**
 * Mock de `.from(tabla).select(cols).eq(col, valor)` que resuelve
 * directamente a `{ data, error }` — patrón usado en otros tests del módulo
 * `dinero` (ver `src/modules/dinero/acciones.test.ts`).
 *
 * `respuestasPorTabla` mapea el nombre de tabla a la respuesta a devolver.
 * Si una tabla no está en el mapa, devuelve `{ data: [], error: null }`.
 */
function crearMockSupabase(
  respuestasPorTabla: Record<string, { data: unknown; error: unknown } | undefined> = {},
) {
  const from = vi.fn((tabla: string) => {
    const respuesta = respuestasPorTabla[tabla] ?? { data: [], error: null };
    return {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue(respuesta),
      }),
    };
  });

  return { from };
}

describe("GET /api/courier/exportar-datos (RNF-13, H-07)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("401 si no hay sesión", async () => {
    vi.mocked(obtenerSesionActual).mockResolvedValue(null);

    const respuesta = await GET({} as never);

    expect(respuesta.status).toBe(401);
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });

  it("403 si el usuario no tiene la capacidad ver_bitacora_auditoria (p. ej. supervisor)", async () => {
    vi.mocked(obtenerSesionActual).mockResolvedValue(crearSesion({ rol: "supervisor" }));

    const respuesta = await GET({} as never);

    expect(respuesta.status).toBe(403);
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });

  it("200 con rol dueno: exporta datos, headers correctos, bitácora registrada", async () => {
    vi.mocked(obtenerSesionActual).mockResolvedValue(crearSesion({ rol: "dueno" }));

    const mockSupabase = crearMockSupabase({
      tenants: {
        data: [
          {
            id: TENANT_ID,
            nombre_fantasia: "Courier Demo",
            razon_social: "Courier Demo SpA",
            rut: "76543210-K",
            estado: "activo",
            plan_id: "estandar",
            zona_horaria: "America/Santiago",
            creado_en: "2026-01-01T00:00:00Z",
            actualizado_en: "2026-01-01T00:00:00Z",
          },
        ],
        error: null,
      },
      sellers: {
        data: [
          {
            id: "seller-1",
            razon_social: "Tienda X",
            rut: "11111111-1",
            nombre_contacto: "Ana",
            email_contacto: "ana@tiendax.cl",
            estado: "activo",
            creado_en: "2026-01-01T00:00:00Z",
            actualizado_en: "2026-01-01T00:00:00Z",
          },
        ],
        error: null,
      },
      pedidos: {
        data: [{ id: "pedido-1", seller_id: "seller-1", estado: "entregado" }],
        error: null,
      },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(mockSupabase as never);

    const respuesta = await GET({} as never);

    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get("Content-Type")).toBe("application/json");

    const disposition = respuesta.headers.get("Content-Disposition") ?? "";
    expect(disposition).toMatch(/^attachment; filename="export-datos-/);
    expect(disposition).toContain(TENANT_ID);
    expect(disposition).toMatch(/\d{4}-\d{2}-\d{2}\.json"$/);

    const cuerpo = await respuesta.json();

    expect(cuerpo.tenant_id).toBe(TENANT_ID);
    expect(typeof cuerpo.generado_en).toBe("string");
    expect(cuerpo.datos.tenants).toHaveLength(1);
    expect(cuerpo.datos.sellers).toHaveLength(1);
    expect(cuerpo.datos.pedidos).toHaveLength(1);

    // Todas las tablas declaradas aparecen en `datos` (las no mockeadas
    // resuelven a arreglo vacío).
    expect(Object.keys(cuerpo.datos)).toEqual(
      expect.arrayContaining([
        "tenants",
        "sellers",
        "conductores",
        "pedidos",
        "manifiestos",
        "asignaciones_pedido",
        "incidencias",
        "periodos_cobro",
        "lineas_cobro",
        "liquidaciones",
        "documentos_dte",
        "eventos_conciliacion",
      ]),
    );

    expect(cuerpo._errores).toBeUndefined();

    // Verificación de aislamiento: el filtro de tenant se aplicó.
    const llamadasFrom = mockSupabase.from.mock.calls.map((c) => c[0]);
    expect(llamadasFrom).toContain("tenants");
    expect(llamadasFrom).toContain("sellers");

    expect(registrarEnBitacora).toHaveBeenCalledWith(
      mockSupabase,
      expect.objectContaining({
        tenantId: TENANT_ID,
        actorUsuarioId: USUARIO_ID,
        actorTipo: "usuario",
        accion: "identidad.datos_courier_exportados",
        entidadTipo: "tenant",
        entidadId: TENANT_ID,
        detalle: expect.objectContaining({
          conteos_por_tabla: expect.objectContaining({
            tenants: 1,
            sellers: 1,
            pedidos: 1,
          }),
        }),
      }),
    );
  });

  it("200 con rol administracion", async () => {
    vi.mocked(obtenerSesionActual).mockResolvedValue(crearSesion({ rol: "administracion" }));

    const mockSupabase = crearMockSupabase();
    vi.mocked(crearClienteServiceRole).mockReturnValue(mockSupabase as never);

    const respuesta = await GET({} as never);

    expect(respuesta.status).toBe(200);
    expect(registrarEnBitacora).toHaveBeenCalled();
  });

  it("el JSON exportado no contiene claves relacionadas a tokens/certificados", async () => {
    vi.mocked(obtenerSesionActual).mockResolvedValue(crearSesion({ rol: "dueno" }));

    const mockSupabase = crearMockSupabase({
      tenants: {
        data: [
          {
            id: TENANT_ID,
            nombre_fantasia: "Courier Demo",
            razon_social: "Courier Demo SpA",
            rut: "76543210-K",
            estado: "activo",
            plan_id: "estandar",
            zona_horaria: "America/Santiago",
            creado_en: "2026-01-01T00:00:00Z",
            actualizado_en: "2026-01-01T00:00:00Z",
          },
        ],
        error: null,
      },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(mockSupabase as never);

    const respuesta = await GET({} as never);
    const textoCompleto = JSON.stringify(await respuesta.json()).toLowerCase();

    const patronesProhibidos = [
      "token",
      "access_token",
      "refresh_token",
      "certificado",
      "secreto",
      "secret",
      "password",
      "contrasena",
      "credenciales",
      "conexiones_seller_ml",
    ];

    for (const patron of patronesProhibidos) {
      expect(textoCompleto).not.toContain(patron);
    }

    // Las tablas excluidas tampoco aparecen como claves de `datos`.
    const cuerpo = JSON.parse(textoCompleto);
    expect(Object.keys(cuerpo.datos)).not.toContain("conexiones_seller_ml");
  });

  it("una tabla que falla se registra en _errores y no rompe el export", async () => {
    vi.mocked(obtenerSesionActual).mockResolvedValue(crearSesion({ rol: "dueno" }));

    const mockSupabase = crearMockSupabase({
      pedidos: { data: null, error: { message: "relation does not exist" } },
      sellers: { data: [{ id: "seller-1" }], error: null },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(mockSupabase as never);

    vi.spyOn(console, "error").mockImplementation(() => {});

    const respuesta = await GET({} as never);
    const cuerpo = await respuesta.json();

    expect(respuesta.status).toBe(200);
    expect(cuerpo._errores).toBeDefined();
    expect(cuerpo._errores.pedidos).toBe("relation does not exist");
    expect(cuerpo.datos.pedidos).toBeUndefined();

    // Las demás tablas siguen presentes.
    expect(cuerpo.datos.sellers).toHaveLength(1);

    expect(registrarEnBitacora).toHaveBeenCalledWith(
      mockSupabase,
      expect.objectContaining({
        detalle: expect.objectContaining({
          tablas_con_error: expect.arrayContaining(["pedidos"]),
        }),
      }),
    );
  });
});
