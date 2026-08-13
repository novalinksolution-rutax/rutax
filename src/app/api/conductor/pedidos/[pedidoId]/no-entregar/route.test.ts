/**
 * Pruebas de POST /api/conductor/pedidos/:pedidoId/no-entregar.
 *
 * ANTES de esta ronda de QA esta ruta no tenía NINGÚN archivo de pruebas.
 *
 * Mismo patrón de dos capas que `entregar/route.test.ts` (ver ese archivo
 * para el detalle completo del razonamiento; aquí solo el resumen):
 *
 * 1. La propia ruta (route.ts:65-70) filtra `pedidos` por
 *    `.eq("id", pedidoId).eq("tenant_id", usuario.tenantId)` — id ajeno o de
 *    otro tenant → `null` → 404, ANTES de tocar `registrarPruebaEntrega` /
 *    `registrarCierreConductor`.
 * 2. Dentro de esas dos funciones (pruebas-entrega.ts:224-228,
 *    cierre-conductor.ts:136-140): `pedido.driver_id_asignado !==
 *    actor.driverId` → `ErrorValidacion` (422) — aislamiento ENTRE
 *    CONDUCTORES del mismo courier.
 *
 * Igual que en `entregar`, estas pruebas NO mockean `registrarPruebaEntrega` /
 * `registrarCierreConductor`: corren de verdad. Para `no-entregar` el
 * `tipoResultado` es `'fallido'`, así que el paso de idempotencia de
 * `registrarPruebaEntrega` (que solo aplica a `'entregado'`) se salta — el
 * primer INSERT real cae directo en `pruebas_entrega`. El truco de "canario"
 * (`__CANARIO_TABLA_NO_MOCKEADA__`) es el mismo: prueba que la ejecución pasó
 * la barrera de pertenencia sin reconstruir el camino feliz completo.
 *
 * Molde de aislamiento (spy sobre `.eq`, `data: null` = "no es tuyo") copiado
 * de `src/app/api/operaciones/[pedidoId]/etiqueta/route.test.ts`.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/autenticar-bearer", () => ({
  autenticarBearer: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock("@/modules/identidad/auditoria", () => ({
  registrarEnBitacora: vi.fn().mockResolvedValue(undefined),
}));

import { autenticarBearer } from "@/lib/supabase/autenticar-bearer";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { POST } from "./route";

const TENANT_A = "10000000-0000-0000-0000-000000000001";
const OTRO_TENANT = "10000000-0000-0000-0000-000000000099";
const DRIVER_1 = "20000000-0000-0000-0000-000000000001";
const OTRO_DRIVER = "20000000-0000-0000-0000-000000000099";
const PEDIDO_1 = "40000000-0000-0000-0000-000000000001";
const SELLER_1 = "60000000-0000-0000-0000-000000000001";

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

/** Ver `entregar/route.test.ts` — mismo doble, solo entiende `pedidos`. */
function crearCliente(opts: { pedido: Record<string, unknown> | null }) {
  function builderPedidos() {
    const b: Record<string, unknown> = {};
    const self = () => b;
    b.select = vi.fn(self);
    b.eq = vi.fn(self);
    b.maybeSingle = vi.fn(async () => ({ data: opts.pedido, error: null }));
    return b;
  }
  const from = vi.fn((tabla: string) => {
    if (tabla === "pedidos") return builderPedidos();
    throw new Error(`${CANARIO}:${tabla}`);
  });
  return { from } as unknown as ReturnType<typeof crearClienteServiceRole>;
}

function pedidoFila(overrides: Record<string, unknown>) {
  return {
    id: PEDIDO_1,
    tenant_id: TENANT_A,
    seller_id: SELLER_1,
    driver_id_asignado: DRIVER_1,
    lat: null,
    long: null,
    geo_estado: "pendiente",
    estado: "en_ruta",
    ...overrides,
  };
}

function req(body: Record<string, unknown> = { tipoIncidencia: "direccion_erronea" }) {
  return new Request("http://localhost/api/conductor/pedidos/x/no-entregar", {
    method: "POST",
    headers: { authorization: "Bearer token-conductor", "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

function ctx(pedidoId: string = PEDIDO_1) {
  return { params: Promise.resolve({ pedidoId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/conductor/pedidos/:pedidoId/no-entregar — auth", () => {
  it("sin usuario autenticado → 401, sin tocar Supabase", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(null);

    const res = await POST(req(), ctx());

    expect(res.status).toBe(401);
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });

  it("conductor con cuenta inactiva → 403", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue({ ...usuarioConductor, estado: "suspendido" });

    const res = await POST(req(), ctx());

    expect(res.status).toBe(403);
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });
});

describe("POST /api/conductor/pedidos/:pedidoId/no-entregar — RECHAZO CRUZADO ENTRE COURIERS", () => {
  it("pedidoId de OTRO TENANT → 404, nunca ejecuta el POD/cierre", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    const cliente = crearCliente({ pedido: null });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const res = await POST(req(), ctx());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: "Pedido no encontrado" });

    const fromSpy = cliente.from as unknown as ReturnType<typeof vi.fn>;
    const llamada = fromSpy.mock.results[0].value as { eq: ReturnType<typeof vi.fn> };
    expect(llamada.eq).toHaveBeenCalledWith("tenant_id", TENANT_A);
    expect(llamada.eq).not.toHaveBeenCalledWith("tenant_id", OTRO_TENANT);
    expect(fromSpy).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/conductor/pedidos/:pedidoId/no-entregar — RECHAZO CRUZADO DENTRO DEL MISMO COURIER", () => {
  it("same-day asignado a OTRO CONDUCTOR → 422, nunca se registra el POD de fallo", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    const cliente = crearCliente({
      pedido: pedidoFila({ tipo_pedido: "same_day", driver_id_asignado: OTRO_DRIVER }),
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const res = await POST(req(), ctx());
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error).toMatch(/solo puede registrar evidencias de pedidos asignados a él/);
  });

  it("Flex asignado a OTRO CONDUCTOR → 422, nunca se registra el cierre operativo", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    const cliente = crearCliente({
      pedido: pedidoFila({ tipo_pedido: "flex", driver_id_asignado: OTRO_DRIVER }),
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const res = await POST(req(), ctx());
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error).toMatch(/solo puede cerrar pedidos asignados a él/);
  });
});

describe("POST /api/conductor/pedidos/:pedidoId/no-entregar — control positivo (pasa la barrera de pertenencia)", () => {
  it("same-day asignado al conductor autenticado → pasa la barrera y llega a tocar pruebas_entrega", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    const cliente = crearCliente({
      pedido: pedidoFila({ tipo_pedido: "same_day", driver_id_asignado: DRIVER_1 }),
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const res = await POST(req(), ctx());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe(`${CANARIO}:pruebas_entrega`);
  });

  it("Flex asignado al conductor autenticado → pasa la barrera y llega a tocar cierres_conductor", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    const cliente = crearCliente({
      pedido: pedidoFila({ tipo_pedido: "flex", driver_id_asignado: DRIVER_1 }),
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const res = await POST(req(), ctx());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe(`${CANARIO}:cierres_conductor`);
  });
});

describe("POST /api/conductor/pedidos/:pedidoId/no-entregar — validación de body", () => {
  it("sin tipoIncidencia → 400, ni siquiera consulta Supabase", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);

    const res = await POST(req({}), ctx());

    expect(res.status).toBe(400);
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });
});
