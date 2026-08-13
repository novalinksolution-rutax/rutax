/**
 * Pruebas de POST /api/conductor/retiros (abrir visita).
 *
 * Molde de aislamiento copiado de
 * `src/app/api/conductor/pedidos/[pedidoId]/entregar/route.test.ts`: doble
 * de cliente cuyo `.eq()` filtra de verdad (no un no-op), y un canario de
 * "un único `.from('seller_bodegas')` antes de tocar sesiones_retiro" para
 * el camino de rechazo.
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
import { POST } from "./route";

const TENANT_A = "10000000-0000-0000-0000-000000000001";
const DRIVER_1 = "20000000-0000-0000-0000-000000000001";
const SELLER_1 = "60000000-0000-0000-0000-000000000001";
const BODEGA_1 = "70000000-0000-0000-0000-000000000001";
const BODEGA_AJENA = "70000000-0000-0000-0000-000000000099";

const usuarioConductor = {
  usuarioId: "usuario-conductor-1",
  tipoUsuario: "conductor" as const,
  driverId: DRIVER_1,
  tenantId: TENANT_A,
  sellerId: null,
  estado: "activo" as const,
  rol: "conductor" as const,
};

const CANARIO = "__CANARIO_TABLA_NO_MOCKEADA__";

/**
 * Doble que entiende `seller_bodegas` (con `.eq()` filtrando de verdad) y
 * `sellers` (necesaria para resolver el nombre antes de escribir la sesión),
 * y deja correr `abrirVisitaBodega` real. Cualquier otra tabla lanza un
 * canario: en el camino de RECHAZO (bodega no encontrada) nunca debería
 * alcanzarse ninguna.
 */
function crearCliente(opts: { bodega: Record<string, unknown> | null }) {
  function builderBodegas() {
    const filtrosEq: { columna: string; valor: unknown }[] = [];
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (columna: string, valor: unknown) => {
      filtrosEq.push({ columna, valor });
      return b;
    };
    b.maybeSingle = async () => {
      const coincide =
        opts.bodega &&
        filtrosEq.every((flt) => (opts.bodega as Record<string, unknown>)[flt.columna] === flt.valor);
      return { data: coincide ? opts.bodega : null, error: null };
    };
    return b;
  }
  function builderSellers() {
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = () => b;
    b.in = () => b;
    b.then = (resolve: (r: { data: Record<string, unknown>[]; error: null }) => void) =>
      resolve({
        data: opts.bodega ? [{ id: opts.bodega.seller_id, razon_social: "Tienda Uno SpA" }] : [],
        error: null,
      });
    return b;
  }
  const from = vi.fn((tabla: string) => {
    if (tabla === "seller_bodegas") return builderBodegas();
    if (tabla === "sellers") return builderSellers();
    throw new Error(`${CANARIO}:${tabla}`);
  });
  const cliente = { from } as unknown as ReturnType<typeof crearClienteServiceRole>;
  return { cliente, from };
}

function req(body: Record<string, unknown> = { bodegaId: BODEGA_1 }) {
  return new Request("http://localhost/api/conductor/retiros", {
    method: "POST",
    headers: { authorization: "Bearer token-conductor", "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/conductor/retiros — auth y validación", () => {
  it("sin usuario autenticado -> 401", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(null);
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });

  it("cuenta inactiva -> 403", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue({ ...usuarioConductor, estado: "suspendido" });
    const res = await POST(req());
    expect(res.status).toBe(403);
  });

  it("sin bodegaId -> 400, sin tocar Supabase", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });
});

describe("POST /api/conductor/retiros — RECHAZO CRUZADO ENTRE COURIERS", () => {
  it("bodegaId de OTRO TENANT -> 404, nunca llega a escribir sesiones_retiro", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    // El doble filtra por tenant_id = TENANT_A: una bodega de otro tenant no matchea.
    const { cliente } = crearCliente({ bodega: { id: BODEGA_AJENA, tenant_id: "otro-tenant", activa: true, seller_id: SELLER_1 } });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const res = await POST(req({ bodegaId: BODEGA_AJENA }));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toMatch(/no existe/);
  });
});

describe("POST /api/conductor/retiros — control positivo", () => {
  it("bodega válida del tenant -> pasa la barrera y llega a tocar sesiones_retiro", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    const { cliente, from } = crearCliente({
      bodega: {
        id: BODEGA_1,
        tenant_id: TENANT_A,
        activa: true,
        seller_id: SELLER_1,
        nombre: "Bodega Quilicura",
        direccion: "Camino a Melipilla 1234",
        comuna: "Quilicura",
        instrucciones_acceso: null,
        contacto_nombre: null,
        contacto_telefono: null,
      },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const res = await POST(req({ bodegaId: BODEGA_1 }));
    const body = await res.json();

    // La barrera se pasó (llegó a intentar escribir sesiones_retiro, que el
    // canario del doble hizo fallar) — pero el error INTERNO nunca se filtra
    // al cliente: la ruta responde un mensaje genérico.
    expect(res.status).toBe(500);
    expect(body.error).toBe("Error al abrir la visita de retiro");
    expect(from.mock.calls.map((c) => c[0])).toContain("sesiones_retiro");
  });
});
