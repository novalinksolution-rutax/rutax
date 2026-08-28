import { AREAS_PRODUCTO } from "@/modules/identidad/areas-producto";
/**
 * Pruebas de GET /api/conductor/retiros/hoy.
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
import { fechaLocalEnSantiago } from "@/lib/fecha-santiago";
import { GET } from "./route";

const HOY = fechaLocalEnSantiago(new Date());

const TENANT_A = "10000000-0000-0000-0000-000000000001";
const OTRO_TENANT = "10000000-0000-0000-0000-000000000099";
const DRIVER_1 = "20000000-0000-0000-0000-000000000001";
const OTRO_DRIVER = "20000000-0000-0000-0000-000000000099";

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

function crearCliente(sesiones: FilaFixture[]) {
  const llamadasEq: { columna: string; valor: unknown }[] = [];
  const from = vi.fn((tabla: string) => {
    if (tabla !== "sesiones_retiro") throw new Error(`Tabla no esperada: ${tabla}`);
    const filtrosEq: { columna: string; valor: unknown }[] = [];
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (columna: string, valor: unknown) => {
      filtrosEq.push({ columna, valor });
      llamadasEq.push({ columna, valor });
      return b;
    };
    b.order = () => b;
    b.then = (resolve: (r: { data: FilaFixture[]; error: null }) => void) =>
      resolve({ data: sesiones.filter((f) => filtrosEq.every((flt) => f[flt.columna] === flt.valor)), error: null });
    return b;
  });
  return { cliente: { from } as unknown as ReturnType<typeof crearClienteServiceRole>, llamadasEq };
}

function req() {
  return new Request("http://localhost/api/conductor/retiros/hoy", {
    method: "GET",
    headers: { authorization: "Bearer token-conductor" },
  }) as unknown as import("next/server").NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/conductor/retiros/hoy — auth", () => {
  it("sin usuario -> 401", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });

  it("cuenta inactiva -> 403", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue({ ...usuarioConductor, estado: "invitado" });
    const res = await GET(req());
    expect(res.status).toBe(403);
  });
});

describe("GET /api/conductor/retiros/hoy — AISLAMIENTO", () => {
  it("filtra por tenant_id Y conductor_id del token — nunca las de otro tenant/conductor", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    const { cliente, llamadasEq } = crearCliente([
      { id: "s-otro-tenant", tenant_id: OTRO_TENANT, conductor_id: DRIVER_1, fecha_operacion: HOY },
      { id: "s-otro-driver", tenant_id: TENANT_A, conductor_id: OTRO_DRIVER, fecha_operacion: HOY },
      { id: "s-mia", tenant_id: TENANT_A, conductor_id: DRIVER_1, fecha_operacion: HOY },
    ]);
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sesiones.map((s: { id: string }) => s.id)).toEqual(["s-mia"]);
    expect(llamadasEq).toContainEqual({ columna: "tenant_id", valor: TENANT_A });
    expect(llamadasEq).toContainEqual({ columna: "conductor_id", valor: DRIVER_1 });
  });
});
