import { AREAS_PRODUCTO } from "@/modules/identidad/areas-producto";
/**
 * Pruebas de POST /api/conductor/pedidos/:pedidoId/entregar.
 *
 * ANTES de esta ronda de QA esta ruta no tenía NINGÚN archivo de pruebas.
 *
 * Hay DOS filtros que sustituyen a RLS aquí, en capas distintas:
 *
 * 1. La propia ruta (route.ts:59-64), para decidir la rama flex/same-day:
 *      cliente.from("pedidos").select("tipo_pedido")
 *        .eq("id", pedidoId)
 *        .eq("tenant_id", usuario.tenantId)   // ← SIEMPRE del token
 *        .maybeSingle();
 *    Si no hay fila (pedido de otro tenant) → 404 ANTES de llamar a ninguna
 *    función de negocio.
 *
 * 2. Dentro de `registrarPruebaEntrega` (same-day, pruebas-entrega.ts:201-228)
 *    y `registrarCierreConductor` (Flex, cierre-conductor.ts:122-140): ambas
 *    vuelven a leer el pedido por tenant Y ADEMÁS comparan
 *    `pedido.driver_id_asignado !== actor.driverId` → `ErrorValidacion` si no
 *    coincide. Esa es la barrera de aislamiento ENTRE CONDUCTORES del mismo
 *    courier.
 *
 * Estas pruebas NO mockean `registrarPruebaEntrega` / `registrarCierreConductor`:
 * las dejan correr de verdad para golpear la línea 2 tal cual — es la única
 * cobertura que existe hoy para `registrarCierreConductor` (Flex), que no
 * tiene módulo de test propio (`cierre-conductor.test.ts` no existe).
 * `registrarPruebaEntrega` sí tiene su propio `pruebas-entrega.test.ts` con la
 * barrera de asignación cubierta — aquí se re-verifica a nivel de ruta HTTP.
 *
 * Truco de "canario": en el camino de RECHAZO, la ejecución nunca llega a
 * tocar más tablas que `pedidos` (el throw ocurre antes). Para el control
 * positivo (mismo conductor) no se simula el insert/upsert completo — en su
 * lugar, cualquier tabla no prevista lanza un error reconocible
 * (`__CANARIO_TABLA_NO_MOCKEADA__`), lo que demuestra que la ejecución SÍ
 * pasó la barrera de pertenencia sin tener que reconstruir todo el camino
 * feliz (bitácora + INSERT/UPSERT + proyección de SLA).
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
  areasHabilitadas: [...AREAS_PRODUCTO],
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
 * Doble de Supabase que solo entiende `pedidos`. Deja correr la lógica REAL
 * de `registrarPruebaEntrega` / `registrarCierreConductor` /
 * `actualizarEstadoPedido` (no se mockean). Cualquier otra tabla lanza un
 * canario: en los tests de RECHAZO eso NUNCA debería alcanzarse (el throw de
 * `ErrorValidacion` ocurre antes); en el control positivo, alcanzarlo es
 * justamente la prueba de que la barrera de pertenencia se pasó.
 */
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
    areasHabilitadas: overrides.areasHabilitadas ?? [...AREAS_PRODUCTO],
  };
}

function req(body: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/conductor/pedidos/x/entregar", {
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

describe("POST /api/conductor/pedidos/:pedidoId/entregar — auth", () => {
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

describe("POST /api/conductor/pedidos/:pedidoId/entregar — RECHAZO CRUZADO ENTRE COURIERS", () => {
  it("pedidoId de OTRO TENANT → 404, nunca ejecuta el POD/cierre", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    const cliente = crearCliente({ pedido: null }); // filtrado por tenant_id: no existe para mí
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const res = await POST(req(), ctx());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: "Pedido no encontrado" });

    const fromSpy = cliente.from as unknown as ReturnType<typeof vi.fn>;
    const llamada = fromSpy.mock.results[0].value as { eq: ReturnType<typeof vi.fn> };
    expect(llamada.eq).toHaveBeenCalledWith("tenant_id", TENANT_A);
    expect(llamada.eq).not.toHaveBeenCalledWith("tenant_id", OTRO_TENANT);
    // Un único `.from()`: nunca llega a tocar pruebas_entrega/cierres_conductor.
    expect(fromSpy).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/conductor/pedidos/:pedidoId/entregar — RECHAZO CRUZADO DENTRO DEL MISMO COURIER", () => {
  it("same-day asignado a OTRO CONDUCTOR → 422, nunca se registra el POD", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    const cliente = crearCliente({
      pedido: pedidoFila({ fuente: "rutax_manual", tipo_pedido: "same_day", driver_id_asignado: OTRO_DRIVER }),
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
      pedido: pedidoFila({ fuente: "ml_flex", tipo_pedido: "flex", driver_id_asignado: OTRO_DRIVER }),
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const res = await POST(req(), ctx());
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error).toMatch(/solo puede cerrar pedidos asignados a él/);
  });
});

describe("POST /api/conductor/pedidos/:pedidoId/entregar — control positivo (pasa la barrera de pertenencia)", () => {
  it("same-day asignado al conductor autenticado → pasa la barrera y llega a tocar pruebas_entrega", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    const cliente = crearCliente({
      pedido: pedidoFila({ fuente: "rutax_manual", tipo_pedido: "same_day", driver_id_asignado: DRIVER_1 }),
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
      pedido: pedidoFila({ fuente: "ml_flex", tipo_pedido: "flex", driver_id_asignado: DRIVER_1 }),
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const res = await POST(req(), ctx());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe(`${CANARIO}:cierres_conductor`);
  });
});
