/**
 * Pruebas de POST /api/conductor/retiros/:sesionId/cerrar.
 *
 * `cerrarSesionRetiro` (la orquestación: bitácora + RPC) se mockea —
 * `sesiones.test.ts` ya prueba su lógica interna (orden bitácora-antes-que-RPC).
 * Aquí lo que importa es el canario de aislamiento de la RUTA: un único
 * `.from('sesiones_retiro')` antes de invocar nada más.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/autenticar-bearer", () => ({
  autenticarBearer: vi.fn(),
}));
vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: vi.fn(),
}));
vi.mock("@/modules/operacion/retiro/sesiones", () => ({
  cerrarSesionRetiro: vi.fn(),
}));

import { autenticarBearer } from "@/lib/supabase/autenticar-bearer";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { cerrarSesionRetiro } from "@/modules/operacion/retiro/sesiones";
import { POST } from "./route";

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

function crearCliente(sesion: FilaFixture | null) {
  function builderSesiones() {
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
  }
  const from = vi.fn((tabla: string) => {
    if (tabla === "sesiones_retiro") return builderSesiones();
    throw new Error(`Tabla no esperada en el doble: ${tabla}`);
  });
  return { from } as unknown as ReturnType<typeof crearClienteServiceRole>;
}

function req() {
  return new Request("http://localhost/api/conductor/retiros/x/cerrar", {
    method: "POST",
    headers: { authorization: "Bearer token-conductor" },
  }) as unknown as import("next/server").NextRequest;
}

function ctx(sesionId = SESION_1) {
  return { params: Promise.resolve({ sesionId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/conductor/retiros/:sesionId/cerrar — auth", () => {
  it("sin usuario -> 401, sin tocar Supabase ni cerrarSesionRetiro", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(null);
    const res = await POST(req(), ctx());
    expect(res.status).toBe(401);
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
    expect(cerrarSesionRetiro).not.toHaveBeenCalled();
  });
});

describe("POST /api/conductor/retiros/:sesionId/cerrar — RECHAZO CRUZADO", () => {
  it("sesionId de OTRO TENANT -> 404, NUNCA llama a cerrarSesionRetiro (ni escribe bitácora)", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    const cliente = crearCliente({ id: SESION_1, tenant_id: OTRO_TENANT, conductor_id: DRIVER_1 });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const res = await POST(req(), ctx());

    expect(res.status).toBe(404);
    expect(cerrarSesionRetiro).not.toHaveBeenCalled();
  });

  it("sesionId de OTRO CONDUCTOR del mismo tenant -> 404, nunca 403", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    const cliente = crearCliente({ id: SESION_1, tenant_id: TENANT_A, conductor_id: OTRO_DRIVER });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const res = await POST(req(), ctx());

    expect(res.status).toBe(404);
    expect(cerrarSesionRetiro).not.toHaveBeenCalled();
  });
});

describe("POST /api/conductor/retiros/:sesionId/cerrar — control positivo", () => {
  it("sesión propia: llama a cerrarSesionRetiro con actorUsuarioId = usuarioId (AUTH), NUNCA driverId", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    const cliente = crearCliente({ id: SESION_1, tenant_id: TENANT_A, conductor_id: DRIVER_1 });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);
    vi.mocked(cerrarSesionRetiro).mockResolvedValue({
      sesionId: SESION_1,
      estado: "cerrada",
      bultosTotal: 5,
      bultosResueltos: 4,
      bultosSinResolver: 1,
      cerradaEn: "2026-08-13T20:00:00.000Z",
      yaEstabaCerrada: false,
      pedidosMarcados: 4,
    });

    const res = await POST(req(), ctx());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.estado).toBe("cerrada");
    expect(cerrarSesionRetiro).toHaveBeenCalledWith(cliente, {
      tenantId: TENANT_A,
      sesionId: SESION_1,
      conductorId: DRIVER_1,
      actorUsuarioId: usuarioConductor.usuarioId,
    });
  });
});
