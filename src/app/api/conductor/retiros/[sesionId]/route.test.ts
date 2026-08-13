/**
 * Pruebas de GET /api/conductor/retiros/:sesionId (detalle de una visita).
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
const OTRO_DRIVER = "20000000-0000-0000-0000-000000000099";
const SESION_1 = "30000000-0000-0000-0000-000000000001";

const usuarioConductor = {
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

const CANARIO = "__CANARIO_TABLA_NO_MOCKEADA__";

/** Doble mínimo: solo `sesiones_retiro`, con `.eq()` filtrando de verdad. */
function crearCliente(sesion: FilaFixture | null) {
  const from = vi.fn((tabla: string) => {
    if (tabla !== "sesiones_retiro") throw new Error(`${CANARIO}:${tabla}`);
    const filtrosEq: { columna: string; valor: unknown }[] = [];
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (columna: string, valor: unknown) => {
      filtrosEq.push({ columna, valor });
      return b;
    };
    b.maybeSingle = async () => {
      const coincide = sesion && filtrosEq.every((flt) => (sesion as FilaFixture)[flt.columna] === flt.valor);
      return { data: coincide ? sesion : null, error: null };
    };
    return b;
  });
  return { from } as unknown as ReturnType<typeof crearClienteServiceRole>;
}

function req() {
  return new Request("http://localhost/api/conductor/retiros/x", {
    method: "GET",
    headers: { authorization: "Bearer token-conductor" },
  }) as unknown as import("next/server").NextRequest;
}

function ctx(sesionId = SESION_1) {
  return { params: Promise.resolve({ sesionId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/conductor/retiros/:sesionId — auth", () => {
  it("sin usuario -> 401, sin tocar Supabase", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(null);
    const res = await GET(req(), ctx());
    expect(res.status).toBe(401);
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });
});

describe("GET /api/conductor/retiros/:sesionId — RECHAZO CRUZADO ENTRE COURIERS Y CONDUCTORES", () => {
  it("sesionId de OTRO TENANT -> 404", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    const cliente = crearCliente({ id: SESION_1, tenant_id: OTRO_TENANT, conductor_id: DRIVER_1 });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const res = await GET(req(), ctx());
    expect(res.status).toBe(404);
  });

  it("sesionId de OTRO CONDUCTOR del MISMO tenant -> 404 (nunca 403)", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    const cliente = crearCliente({ id: SESION_1, tenant_id: TENANT_A, conductor_id: OTRO_DRIVER });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const res = await GET(req(), ctx());
    expect(res.status).toBe(404);
  });
});

describe("GET /api/conductor/retiros/:sesionId — control positivo", () => {
  it("sesión propia del tenant -> pasa la barrera (llega a leer bodega/bultos)", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    const cliente = crearCliente({
      id: SESION_1,
      tenant_id: TENANT_A,
      conductor_id: DRIVER_1,
      bodega_id: "bodega-x",
      seller_id: "seller-x",
      estado: "abierta",
      fecha_operacion: "2026-08-13",
      abierta_en: "2026-08-13T12:00:00.000Z",
      cerrada_en: null,
      bultos_total: null,
      bultos_resueltos: null,
      bultos_sin_resolver: null,
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const res = await GET(req(), ctx());
    const body = await res.json();

    // El canario del doble solo entiende sesiones_retiro: pasar la barrera
    // implica que obtenerSesionRetiro intentó leer OTRA tabla (bodega/bultos)
    // y ahí sí no está mockeada -> 500 genérico, nunca 404.
    expect(res.status).toBe(500);
    expect(body.error).not.toMatch(/no encontrada/);
  });
});
