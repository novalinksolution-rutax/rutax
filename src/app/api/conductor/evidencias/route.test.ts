import { AREAS_PRODUCTO } from "@/modules/identidad/areas-producto";
/**
 * Pruebas de POST /api/conductor/evidencias.
 *
 * ANTES de esta ronda de QA esta ruta no tenía NINGÚN archivo de pruebas.
 *
 * La ruta no hace NINGUNA lectura propia de `pedidos`: delega el aislamiento
 * entero en `registrarEvidenciaEntrega` (evidencias-entrega.ts:126-166), que
 * SÍ tiene su módulo de test propio (`evidencias-entrega.test.ts`) — pero ese
 * archivo solo cubre la barrera de CONDUCTOR ("conductor no asignado al
 * pedido lanza ErrorValidacion"), nunca el caso de pedido de OTRO TENANT. Por
 * eso estas pruebas NO mockean `registrarEvidenciaEntrega`: lo dejan correr
 * de verdad, para cerrar ese hueco en la capa que sí falta (tenant) y
 * re-verificar la de conductor a nivel de ruta HTTP.
 *
 * La línea que sustituye a RLS (evidencias-entrega.ts:147-166):
 *
 *   cliente.from("pedidos").select(...)
 *     .eq("id", entrada.pedidoId)
 *     .eq("tenant_id", entrada.tenantId)   // ← entrada.tenantId = usuario.tenantId (token)
 *     .maybeSingle();
 *   ...
 *   if (pedido.driver_id_asignado !== actor.driverId) throw ErrorValidacion(...)
 *
 * ⚠️ HALLAZGO MENOR (severidad BAJA, no es fuga de datos, solo inconsistencia
 * de status code — documentado, no corregido aquí): cuando el pedido no
 * existe para el tenant, `registrarEvidenciaEntrega` lanza
 * `ErrorPedidoNoEncontrado`, que NO extiende `ErrorValidacion` (extiende
 * `ErrorOperacion`, de `modules/operacion/errores.ts`). El `catch` de esta
 * ruta (route.ts:64-73) solo trata especial a `ErrorValidacion` → todo lo
 * demás cae al branch genérico con status 500. Resultado real: un pedidoId de
 * otro tenant responde **500** ("Error interno" implícito, con el mensaje
 * "El pedido 'X' no existe o no pertenece al tenant") en vez de un 404 limpio.
 * No hay fuga: el mensaje no confirma que el pedido exista en otro lado, y el
 * aislamiento SÍ se cumple (nunca se llega a crear la evidencia) — pero un
 * 500 "ensucia" cualquier tablero de errores de servidor con algo que en
 * realidad es un 404 de negocio. Vale la pena homologarlo con el patrón
 * `ErrorValidacion` en algún momento; no se toca aquí (restricción: no editar
 * `route.ts`).
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

/** Doble mínimo: solo entiende `pedidos`. Cualquier otra tabla es canario. */
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

function pedidoFila(overrides: Record<string, unknown> = {}) {
  return {
    id: PEDIDO_1,
    tenant_id: TENANT_A,
    seller_id: SELLER_1,
    driver_id_asignado: DRIVER_1,
    lat: null,
    long: null,
    geo_estado: "pendiente",
    ...overrides,
    areasHabilitadas: overrides.areasHabilitadas ?? [...AREAS_PRODUCTO],
  };
}

function req(body: Record<string, unknown>) {
  return new Request("http://localhost/api/conductor/evidencias", {
    method: "POST",
    headers: { authorization: "Bearer token-conductor", "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

const BODY_BASE = { pedidoId: PEDIDO_1, fotoObjectPath: `${TENANT_A}/${PEDIDO_1}/evidencias/x.jpg` };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/conductor/evidencias — auth", () => {
  it("sin usuario autenticado → 401, sin tocar Supabase", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(null);

    const res = await POST(req(BODY_BASE));

    expect(res.status).toBe(401);
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });

  it("conductor con cuenta inactiva → 403", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue({ ...usuarioConductor, estado: "suspendido" });

    const res = await POST(req(BODY_BASE));

    expect(res.status).toBe(403);
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });
});

describe("POST /api/conductor/evidencias — RECHAZO CRUZADO ENTRE COURIERS", () => {
  it("pedidoId de OTRO TENANT → rechazado (500 por la inconsistencia documentada arriba), NUNCA se crea la evidencia", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    const cliente = crearCliente({ pedido: null });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const res = await POST(req(BODY_BASE));
    const body = await res.json();

    // Documentado arriba: ErrorPedidoNoEncontrado no es ErrorValidacion → 500,
    // no 404. Lo que SÍ se afirma sin ambigüedad es que NO se crea nada.
    expect(res.status).toBe(500);
    expect(body.error).toMatch(/no existe o no pertenece al tenant/);

    const fromSpy = cliente.from as unknown as ReturnType<typeof vi.fn>;
    const llamada = fromSpy.mock.results[0].value as { eq: ReturnType<typeof vi.fn> };
    expect(llamada.eq).toHaveBeenCalledWith("tenant_id", TENANT_A);
    expect(llamada.eq).not.toHaveBeenCalledWith("tenant_id", OTRO_TENANT);
    expect(fromSpy).toHaveBeenCalledTimes(1); // nunca llega a evidencias_entrega
  });
});

describe("POST /api/conductor/evidencias — RECHAZO CRUZADO DENTRO DEL MISMO COURIER", () => {
  it("pedido asignado a OTRO CONDUCTOR (mismo tenant) → 422, nunca se crea la evidencia", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    const cliente = crearCliente({ pedido: pedidoFila({ driver_id_asignado: OTRO_DRIVER }) });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const res = await POST(req(BODY_BASE));
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error).toMatch(/solo puede registrar evidencias de pedidos asignados a él/);
  });
});

describe("POST /api/conductor/evidencias — control positivo (pasa la barrera de pertenencia)", () => {
  it("pedido asignado al conductor autenticado → pasa la barrera y llega a tocar evidencias_entrega", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    const cliente = crearCliente({ pedido: pedidoFila({ driver_id_asignado: DRIVER_1 }) });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const res = await POST(req(BODY_BASE));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe(`${CANARIO}:evidencias_entrega`);
  });
});
