import { AREAS_PRODUCTO } from "@/modules/identidad/areas-producto";
/**
 * Pruebas de GET /api/conductor/pedidos/:pedidoId/evidencias.
 *
 * ANTES de esta ronda de QA esta ruta no tenía NINGÚN archivo de pruebas.
 *
 * Esta ruta usa DOS capas de aislamiento distintas, y ninguna de las dos
 * tenía cobertura en ningún lado (`listarEvidenciasPorPedido` no aparece en
 * ningún `*.test.ts` antes de este archivo):
 *
 * 1. `listarEvidenciasPorPedido` (evidencias-entrega.ts:272-289) filtra en la
 *    BASE DE DATOS por tenant:
 *      .eq("pedido_id", pedidoId).eq("tenant_id", tenantId)
 *    Un `pedidoId` de OTRO TENANT nunca puede devolver filas: ninguna fila de
 *    `evidencias_entrega` tiene simultáneamente ese `pedido_id` (ajeno) y
 *    `tenant_id = miTenant` (porque cada evidencia se guarda con el
 *    `tenant_id` de su dueño real). Por diseño, no hace falta un 404 — el
 *    resultado natural es `{ total: 0, evidencias: [] }`, sin fuga.
 *
 * 2. El filtro por CONDUCTOR (route.ts:38-40) es EN MEMORIA, no en la
 *    consulta: `listarEvidenciasPorPedido` trae TODAS las evidencias del
 *    pedido (de cualquier conductor que lo haya tocado), y la ruta se queda
 *    solo con las propias:
 *      const propias = todas.filter((e) => e.conductorId === usuario.driverId);
 *    Esta es la línea que hay que probar de verdad — con evidencias de OTRO
 *    conductor presentes en la respuesta "cruda" de la BD simulada, para
 *    confirmar que el filtro en memoria de verdad las excluye (y no solo
 *    porque el doble de prueba "resultó" vacío).
 *
 * Ambas funciones (`listarEvidenciasPorPedido` y el filtro en memoria) corren
 * de verdad en estas pruebas — no se mockea nada de `evidencias-entrega.ts`.
 *
 * Molde de aislamiento (spy sobre `.eq`) adaptado de
 * `src/app/api/operaciones/[pedidoId]/etiqueta/route.test.ts`; como esta ruta
 * no responde 404 (el diseño es "lista vacía", no "recurso no encontrado"),
 * la aserción de rechazo es sobre el CONTENIDO de la respuesta, no el status.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

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
const PEDIDO_1 = "40000000-0000-0000-0000-000000000001";
const EVIDENCIA_PROPIA = "50000000-0000-0000-0000-000000000001";
const EVIDENCIA_AJENA = "50000000-0000-0000-0000-000000000002";

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

/** Doble de `evidencias_entrega` + `storage.from(...).createSignedUrls`. */
function crearCliente(opts: { evidencias: Array<Record<string, unknown>> }) {
  function builderEvidencias() {
    const b: Record<string, unknown> = {};
    const self = () => b;
    b.select = vi.fn(self);
    b.eq = vi.fn(self);
    // `.order()` es la última llamada de la cadena real (sin `.maybeSingle`).
    b.order = vi.fn(async () => ({ data: opts.evidencias, error: null }));
    return b;
  }
  const createSignedUrls = vi.fn(async (paths: string[]) => ({
    data: paths.map((path) => ({ path, signedUrl: `https://storage.example/signed/${path}` })),
    error: null,
  }));
  const from = vi.fn((tabla: string) => {
    if (tabla === "evidencias_entrega") return builderEvidencias();
    throw new Error(`Tabla no mockeada en esta prueba: ${tabla}`);
  });
  return {
    from,
    storage: { from: vi.fn(() => ({ createSignedUrls })) },
  } as unknown as ReturnType<typeof crearClienteServiceRole>;
}

function evidenciaFila(overrides: Record<string, unknown>) {
  return {
    id: EVIDENCIA_PROPIA,
    tenant_id: TENANT_A,
    pedido_id: PEDIDO_1,
    seller_id: "seller-1",
    conductor_id: DRIVER_1,
    foto_object_path: `${TENANT_A}/${PEDIDO_1}/evidencias/x.jpg`,
    nota: null,
    geo_lat: null,
    geo_long: null,
    geo_precision_m: null,
    distancia_destino_m: null,
    geocerca_resultado: "sin_referencia",
    capturado_en: "2026-08-13T12:00:00.000Z",
    subido_en: "2026-08-13T12:00:01.000Z",
    creado_en: "2026-08-13T12:00:01.000Z",
    ...overrides,
    areasHabilitadas: overrides.areasHabilitadas ?? [...AREAS_PRODUCTO],
  };
}

function req() {
  return new Request("http://localhost/api/conductor/pedidos/x/evidencias", {
    headers: { authorization: "Bearer token-conductor" },
  }) as unknown as import("next/server").NextRequest;
}

function ctx(pedidoId: string = PEDIDO_1) {
  return { params: Promise.resolve({ pedidoId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/conductor/pedidos/:pedidoId/evidencias — auth", () => {
  it("sin usuario autenticado → 401, sin tocar Supabase", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(null);

    const res = await GET(req(), ctx());

    expect(res.status).toBe(401);
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });

  it("conductor con cuenta inactiva → 403", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue({ ...usuarioConductor, estado: "suspendido" });

    const res = await GET(req(), ctx());

    expect(res.status).toBe(403);
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });
});

describe("GET /api/conductor/pedidos/:pedidoId/evidencias — RECHAZO CRUZADO ENTRE COURIERS", () => {
  it("pedidoId de OTRO TENANT → 200 con lista VACÍA (nunca 500 ni fuga; el filtro de BD ya lo garantiza)", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    // Ninguna fila de `evidencias_entrega` puede tener a la vez pedido_id
    // ajeno y tenant_id propio — se simula el resultado natural: vacío.
    const cliente = crearCliente({ evidencias: [] });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const res = await GET(req(), ctx());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ total: 0, evidencias: [] });

    const fromSpy = cliente.from as unknown as ReturnType<typeof vi.fn>;
    const llamada = fromSpy.mock.results[0].value as { eq: ReturnType<typeof vi.fn> };
    expect(llamada.eq).toHaveBeenCalledWith("tenant_id", TENANT_A);
    expect(llamada.eq).not.toHaveBeenCalledWith("tenant_id", OTRO_TENANT);
  });
});

describe("GET /api/conductor/pedidos/:pedidoId/evidencias — RECHAZO CRUZADO DENTRO DEL MISMO COURIER", () => {
  it("el pedido tiene evidencias de OTRO CONDUCTOR (mismo tenant, p. ej. reasignación) → esas NUNCA aparecen", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    const cliente = crearCliente({
      evidencias: [
        evidenciaFila({ id: EVIDENCIA_AJENA, conductor_id: OTRO_DRIVER }),
      ],
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const res = await GET(req(), ctx());
    const body = await res.json();

    // La consulta SÍ trajo la fila (viene del mismo pedido/tenant) — lo que
    // se prueba es que el filtro en memoria por conductor_id la descarta.
    expect(res.status).toBe(200);
    expect(body).toEqual({ total: 0, evidencias: [] });
  });

  it("mezcla de evidencias propias y ajenas en el mismo pedido → solo las propias aparecen, con su URL firmada", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    const cliente = crearCliente({
      evidencias: [
        evidenciaFila({ id: EVIDENCIA_PROPIA, conductor_id: DRIVER_1 }),
        evidenciaFila({
          id: EVIDENCIA_AJENA,
          conductor_id: OTRO_DRIVER,
          foto_object_path: `${TENANT_A}/${PEDIDO_1}/evidencias/ajena.jpg`,
        }),
      ],
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const res = await GET(req(), ctx());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.evidencias).toHaveLength(1);
    expect(body.evidencias[0].id).toBe(EVIDENCIA_PROPIA);
    expect(body.evidencias[0].fotoUrl).toContain("https://storage.example/signed/");

    // Ni siquiera se pide URL firmada para la foto ajena.
    const createSignedUrls = (cliente.storage.from as unknown as ReturnType<typeof vi.fn>).mock
      .results[0].value.createSignedUrls as ReturnType<typeof vi.fn>;
    const pathsPedidos = createSignedUrls.mock.calls[0][0] as string[];
    expect(pathsPedidos).toEqual([`${TENANT_A}/${PEDIDO_1}/evidencias/x.jpg`]);
  });
});

describe("GET /api/conductor/pedidos/:pedidoId/evidencias — control positivo", () => {
  it("solo evidencias propias → aparecen todas, con total correcto", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    const cliente = crearCliente({
      evidencias: [evidenciaFila({ id: EVIDENCIA_PROPIA, conductor_id: DRIVER_1 })],
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const res = await GET(req(), ctx());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.evidencias[0].id).toBe(EVIDENCIA_PROPIA);
  });
});
