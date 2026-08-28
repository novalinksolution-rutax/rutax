import { AREAS_PRODUCTO } from "@/modules/identidad/areas-producto";
/**
 * Pruebas de GET /api/conductor/retiros/bodegas.
 *
 * Molde de aislamiento (spy sobre `.eq()`, doble que FILTRA de verdad —
 * nunca un no-op) copiado de
 * `src/app/api/conductor/pedidos/[pedidoId]/entregar/route.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/autenticar-bearer", () => ({
  autenticarBearer: vi.fn(),
}));
vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: vi.fn(),
}));

import { autenticarBearer } from "@/lib/supabase/autenticar-bearer";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { GET } from "./route";

const TENANT_A = "10000000-0000-0000-0000-000000000001";
const OTRO_TENANT = "10000000-0000-0000-0000-000000000099";
const DRIVER_1 = "20000000-0000-0000-0000-000000000001";
const SELLER_1 = "60000000-0000-0000-0000-000000000001";
const BODEGA_1 = "70000000-0000-0000-0000-000000000001";
const BODEGA_AJENA = "70000000-0000-0000-0000-000000000099";

const usuarioConductor = {
  areasHabilitadas: [...AREAS_PRODUCTO],
  usuarioId: "usuario-conductor-1",
  tipoUsuario: "conductor" as const,
  driverId: DRIVER_1,
  tenantId: TENANT_A,
  sellerId: null,
  estado: "activo" as const,
  rol: "conductor" as const,
};

interface FilaFixture {
  [clave: string]: unknown;
}

/** Doble cuyo `.eq()` FILTRA de verdad — nunca un no-op. */
function crearCliente(fixtures: { seller_bodegas: FilaFixture[]; sellers: FilaFixture[] }) {
  function builder(tabla: "seller_bodegas" | "sellers") {
    const filas = fixtures[tabla];
    const filtrosEq: { columna: string; valor: unknown }[] = [];
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (columna: string, valor: unknown) => {
      filtrosEq.push({ columna, valor });
      return b;
    };
    b.in = () => b;
    b.order = () => b;
    b.then = (resolve: (r: { data: FilaFixture[]; error: null }) => void) =>
      resolve({ data: filas.filter((f) => filtrosEq.every((flt) => f[flt.columna] === flt.valor)), error: null });
    return b;
  }
  const from = vi.fn((tabla: string) => builder(tabla as "seller_bodegas" | "sellers"));
  return { from } as unknown as ReturnType<typeof crearClienteServiceRole>;
}

function req() {
  return new Request("http://localhost/api/conductor/retiros/bodegas", {
    method: "GET",
    headers: { authorization: "Bearer token-conductor" },
  }) as unknown as import("next/server").NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/conductor/retiros/bodegas — auth", () => {
  it("sin usuario autenticado -> 401, sin tocar Supabase", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(null);

    const res = await GET(req());

    expect(res.status).toBe(401);
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });

  it("conductor con cuenta inactiva -> 403", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue({ ...usuarioConductor, estado: "suspendido" });

    const res = await GET(req());

    expect(res.status).toBe(403);
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });

  it("un tipo_usuario que no es conductor -> 401", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue({ ...usuarioConductor, tipoUsuario: "interno" });

    const res = await GET(req());
    expect(res.status).toBe(401);
  });
});

describe("GET /api/conductor/retiros/bodegas — AISLAMIENTO entre couriers", () => {
  it("las bodegas de OTRO tenant nunca aparecen, aunque existan en el fixture", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    const cliente = crearCliente({
      seller_bodegas: [
        { id: BODEGA_AJENA, nombre: "Bodega ajena", comuna: "X", seller_id: SELLER_1, tenant_id: OTRO_TENANT, activa: true },
      ],
      sellers: [],
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.bodegas).toEqual([]);
  });
});

describe("GET /api/conductor/retiros/bodegas — control positivo", () => {
  it("devuelve las bodegas activas del tenant, SIN dirección ni contacto", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    const cliente = crearCliente({
      seller_bodegas: [
        {
          id: BODEGA_1,
          nombre: "Bodega Quilicura",
          comuna: "Quilicura",
          seller_id: SELLER_1,
          tenant_id: TENANT_A,
          activa: true,
          direccion: "Calle Secreta 123",
          contacto_telefono: "+56911111111",
        },
      ],
      sellers: [{ id: SELLER_1, razon_social: "Tienda Uno SpA", tenant_id: TENANT_A }],
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.bodegas).toEqual([
      { id: BODEGA_1, nombre: "Bodega Quilicura", comuna: "Quilicura", sellerId: SELLER_1, sellerNombre: "Tienda Uno SpA" },
    ]);
    expect(JSON.stringify(body)).not.toContain("Calle Secreta 123");
    expect(JSON.stringify(body)).not.toContain("+56911111111");
  });
});
