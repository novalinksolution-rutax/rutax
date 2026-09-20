/**
 * Pruebas del barrido hacia atrás del `ml_order_id` (`ml/rellenarOrderId`).
 *
 * REGLA DEL ARCHIVO: se ejerce el CÓDIGO REAL —`rellenarOrderIdDeConexion`
 * completa, con la capa HTTP de verdad (`peticionMl` → `fetch` doblado) y un
 * doble de Supabase. Nada de reimplementar la lógica dentro del test: ese vicio
 * ya dejó el job de conciliación con tests en verde y el bug vivo.
 *
 * Lo que se fija acá es lo que duele si se rompe:
 *  1. El UPDATE lleva UNA sola columna (`ml_order_id`) — nunca `estado`,
 *     `origen` ni `corte_riesgo`: en PostgREST todo lo del payload se escribe.
 *  2. El UPDATE exige `ml_order_id is null` → jamás se pisa un id ya guardado.
 *  3. Un 404 se cuenta aparte y no toca nada (no es cancelación ni nada).
 *  4. Es idempotente: sin candidatos no llama a ML ni escribe.
 *  5. Ni el token ni la PII salen en el resumen o en los logs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/inngest/cliente", () => ({
  inngest: {
    createFunction: vi.fn((config: unknown, handler: unknown) => ({ config, handler })),
    send: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock("../../secretos", () => ({
  descifrarSecreto: vi.fn().mockResolvedValue({ valor: "tok-secretisimo-de-prueba" }),
}));

vi.mock("@/lib/observabilidad", () => ({
  capturarMensaje: vi.fn().mockResolvedValue(undefined),
}));

import { descifrarSecreto } from "../../secretos";
import {
  FUENTE_ML_FLEX,
  jobRellenarOrderIdMl,
  rellenarOrderIdDeConexion,
  TOPE_PEDIDOS_POR_CONEXION,
} from "./rellenar-order-id";
import type { ConexionIngesta } from "./ingesta-pedidos-ml";

const TOKEN_FIXTURE = "tok-secretisimo-de-prueba";

const CONEXION: ConexionIngesta = {
  id: "conexion-1",
  tenantId: "tenant-1",
  sellerId: "seller-1",
  mlUserId: "123456789",
  accessTokenRef: "ref-secreto",
  estadoSalud: "activa",
  cursorEn: null,
  esRepresentativaDelSeller: true,
};

// -----------------------------------------------------------------------------
// Dobles
// -----------------------------------------------------------------------------

function respuestaFalsa(opciones: { status?: number; json?: unknown; vacio?: boolean } = {}) {
  const status = opciones.status ?? 200;
  const cuerpo = opciones.json ?? [];
  const r = {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => cuerpo,
    text: async () => (opciones.vacio ? "" : JSON.stringify(cuerpo)),
    clone: () => r,
  };
  return r;
}

/** Doble de `GET /shipments/{id}/orders`. */
function stubOrdenes(porShipment: Record<string, { status?: number; cuerpo?: unknown; vacio?: boolean }>) {
  const fetchMock = vi.fn(async (url: string) => {
    const partes = String(url).split("/");
    const id = partes[partes.length - 2];
    const config = porShipment[id];
    if (!config) return respuestaFalsa({ status: 404, json: { message: "not found" } });
    return respuestaFalsa({
      status: config.status ?? 200,
      json: config.cuerpo ?? [],
      ...(config.vacio ? { vacio: true } : {}),
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

interface ConfigDoble {
  pedidos?: Array<{ id: string; ml_shipment_id: string }>;
  errorUpdate?: { message: string } | null;
}

function crearSupabaseFalso(config: ConfigDoble = {}) {
  const registro = {
    filtrosSelect: [] as Record<string, unknown>[],
    updates: [] as Record<string, unknown>[],
    updateFiltros: [] as Record<string, unknown>[],
  };

  /* eslint-disable @typescript-eslint/no-explicit-any */
  function builder() {
    const filtros: Record<string, unknown> = {};
    const cadena: any = {};
    const self = () => cadena;

    cadena.select = vi.fn(self);
    cadena.eq = vi.fn((c: string, v: unknown) => {
      filtros[c] = v;
      return cadena;
    });
    cadena.not = vi.fn((c: string, op: string, v: unknown) => {
      filtros[`not:${c}`] = `${op}.${v}`;
      return cadena;
    });
    cadena.is = vi.fn((c: string, v: unknown) => {
      filtros[`is:${c}`] = v;
      return cadena;
    });
    cadena.or = vi.fn((expr: string) => {
      filtros["or"] = expr;
      return cadena;
    });
    cadena.order = vi.fn(self);
    cadena.limit = vi.fn(async (n: number) => {
      registro.filtrosSelect.push({ ...filtros, limit: n });
      return { data: config.pedidos ?? [], error: null };
    });

    cadena.update = vi.fn((valores: Record<string, unknown>) => {
      registro.updates.push(valores);
      const destino: Record<string, unknown> = {};
      const u: any = {};
      u.eq = vi.fn((c: string, v: unknown) => {
        destino[c] = v;
        return u;
      });
      u.is = vi.fn(async (c: string, v: unknown) => {
        destino[`is:${c}`] = v;
        registro.updateFiltros.push(destino);
        return { error: config.errorUpdate ?? null };
      });
      return u;
    });

    return cadena;
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const cliente = { schema: vi.fn(() => ({ from: vi.fn(() => builder()) })) };
  return { cliente, registro };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const comoSupabase = (c: unknown) => c as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(descifrarSecreto).mockResolvedValue({
    valor: TOKEN_FIXTURE,
  } as unknown as Awaited<ReturnType<typeof descifrarSecreto>>);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// =============================================================================

describe("rellenarOrderIdDeConexion — el camino feliz", () => {
  it("resuelve el id de orden y escribe SOLO esa columna", async () => {
    const { cliente, registro } = crearSupabaseFalso({
      pedidos: [{ id: "pedido-a", ml_shipment_id: "111" }],
    });
    stubOrdenes({ "111": { cuerpo: [{ order_id: "2000017906826300", pack_id: "9" }] } });

    const resumen = await rellenarOrderIdDeConexion(CONEXION, {
      supabase: comoSupabase(cliente),
    });

    expect(resumen.resueltos).toBe(1);
    expect(resumen.candidatos).toBe(1);

    // ⚠️ UNA sola clave. `estado`, `origen` y `corte_riesgo` en el payload de un
    // UPDATE de PostgREST se ESCRIBEN — el bug que casi resetea la operación.
    expect(registro.updates).toEqual([{ ml_order_id: "2000017906826300" }]);
    expect(Object.keys(registro.updates[0])).toHaveLength(1);
  });

  it("el UPDATE exige `ml_order_id is null`: nunca pisa un id ya guardado", async () => {
    const { cliente, registro } = crearSupabaseFalso({
      pedidos: [{ id: "pedido-a", ml_shipment_id: "111" }],
    });
    stubOrdenes({ "111": { cuerpo: [{ order_id: "2000017906826300" }] } });

    await rellenarOrderIdDeConexion(CONEXION, { supabase: comoSupabase(cliente) });

    expect(registro.updateFiltros[0]).toMatchObject({
      id: "pedido-a",
      "is:ml_order_id": null,
    });
  });

  it("solo mira pedidos de la fuente ML/Flex que siguen sin id de orden", async () => {
    const { cliente, registro } = crearSupabaseFalso({ pedidos: [] });
    stubOrdenes({});

    await rellenarOrderIdDeConexion(CONEXION, { supabase: comoSupabase(cliente) });

    // La procedencia se pregunta por `fuente`, NUNCA por `tipo_pedido`.
    expect(registro.filtrosSelect[0]).toMatchObject({
      tenant_id: "tenant-1",
      seller_id: "seller-1",
      fuente: FUENTE_ML_FLEX,
      "is:ml_order_id": null,
      limit: TOPE_PEDIDOS_POR_CONEXION,
    });
    expect(registro.filtrosSelect[0]).not.toHaveProperty("tipo_pedido");
  });

  it("sin candidatos no llama a ML, no descifra el token y no escribe", async () => {
    const { cliente, registro } = crearSupabaseFalso({ pedidos: [] });
    const fetchMock = stubOrdenes({});

    const resumen = await rellenarOrderIdDeConexion(CONEXION, {
      supabase: comoSupabase(cliente),
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(descifrarSecreto).not.toHaveBeenCalled();
    expect(registro.updates).toHaveLength(0);
    expect(resumen.resueltos).toBe(0);
  });
});

describe("rellenarOrderIdDeConexion — lo que ML responde mal", () => {
  it("un 404 se cuenta aparte y NO toca el pedido", async () => {
    const { cliente, registro } = crearSupabaseFalso({
      pedidos: [{ id: "pedido-a", ml_shipment_id: "999" }],
    });
    stubOrdenes({}); // cualquier id → 404

    const resumen = await rellenarOrderIdDeConexion(CONEXION, {
      supabase: comoSupabase(cliente),
    });

    expect(resumen.noEncontrados).toEqual(["999"]);
    expect(resumen.fallidos).toBe(0);
    expect(resumen.resueltos).toBe(0);
    expect(registro.updates).toHaveLength(0);
  });

  it("204 No Content → «sin dato», no un fallo, y no escribe nada", async () => {
    const { cliente, registro } = crearSupabaseFalso({
      pedidos: [{ id: "pedido-a", ml_shipment_id: "111" }],
    });
    stubOrdenes({ "111": { status: 204, vacio: true } });

    const resumen = await rellenarOrderIdDeConexion(CONEXION, {
      supabase: comoSupabase(cliente),
    });

    expect(resumen.sinDato).toBe(1);
    expect(resumen.fallidos).toBe(0);
    expect(registro.updates).toHaveLength(0);
  });

  it("un 500 se cuenta como fallido y no arrastra al resto del lote", async () => {
    const { cliente } = crearSupabaseFalso({
      pedidos: [
        { id: "pedido-a", ml_shipment_id: "500" },
        { id: "pedido-b", ml_shipment_id: "111" },
      ],
    });
    stubOrdenes({
      "500": { status: 500, cuerpo: { message: "boom" } },
      "111": { cuerpo: [{ order_id: "2000017906826300" }] },
    });

    const resumen = await rellenarOrderIdDeConexion(CONEXION, {
      supabase: comoSupabase(cliente),
      // Sin espera entre reintentos: el 500 es reintentable y `peticionMl` hace
      // backoff. Se deja que agote y se cuente.
    });

    expect(resumen.resueltos).toBe(1);
    expect(resumen.fallidos).toBe(1);
  }, 20000);

  it("un error al escribir se cuenta y no se confunde con «resuelto»", async () => {
    const { cliente } = crearSupabaseFalso({
      pedidos: [{ id: "pedido-a", ml_shipment_id: "111" }],
      errorUpdate: { message: "RLS denied" },
    });
    stubOrdenes({ "111": { cuerpo: [{ order_id: "2000017906826300" }] } });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const resumen = await rellenarOrderIdDeConexion(CONEXION, {
      supabase: comoSupabase(cliente),
      logger,
    });

    expect(resumen.erroresPersistencia).toBe(1);
    expect(resumen.resueltos).toBe(0);
  });
});

describe("rellenarOrderIdDeConexion — conexiones que no pueden leer", () => {
  it("una conexión desvinculada se omite sin llamar a ML", async () => {
    const { cliente } = crearSupabaseFalso({
      pedidos: [{ id: "pedido-a", ml_shipment_id: "111" }],
    });
    const fetchMock = stubOrdenes({});

    const resumen = await rellenarOrderIdDeConexion(
      { ...CONEXION, estadoSalud: "desvinculada" },
      { supabase: comoSupabase(cliente) },
    );

    expect(resumen.omitida).toBe("desvinculada");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("un token ilegible se omite y su error no se propaga (podría llevar material cifrado)", async () => {
    const { cliente } = crearSupabaseFalso({
      pedidos: [{ id: "pedido-a", ml_shipment_id: "111" }],
    });
    const fetchMock = stubOrdenes({});
    vi.mocked(descifrarSecreto).mockRejectedValueOnce(new Error("clave-maestra-xyz corrupta"));
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const resumen = await rellenarOrderIdDeConexion(CONEXION, {
      supabase: comoSupabase(cliente),
      logger,
    });

    expect(resumen.omitida).toBe("token_ilegible");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logger.warn.mock.calls.flat().join(" ")).not.toContain("clave-maestra-xyz");
  });
});

describe("rellenarOrderIdDeConexion — seguridad", () => {
  it("ni el token ni el id de orden ajeno salen en el resumen o en los logs", async () => {
    const { cliente } = crearSupabaseFalso({
      pedidos: [{ id: "pedido-a", ml_shipment_id: "111" }],
    });
    const fetchMock = stubOrdenes({ "111": { cuerpo: [{ order_id: "2000017906826300" }] } });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const resumen = await rellenarOrderIdDeConexion(CONEXION, {
      supabase: comoSupabase(cliente),
      logger,
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string> },
    ];
    expect(init.headers.authorization).toBe(`Bearer ${TOKEN_FIXTURE}`);

    const todo = [
      JSON.stringify(resumen),
      ...logger.info.mock.calls.flat(),
      ...logger.warn.mock.calls.flat(),
      ...logger.error.mock.calls.flat(),
    ].join("\n");
    expect(todo).not.toContain(TOKEN_FIXTURE);
  });
});

describe("registro del job", () => {
  it("se dispara por EVENTO, no por cron — es un trabajo que se agota", () => {
    const config = (jobRellenarOrderIdMl as unknown as { config: Record<string, unknown> })
      .config;
    expect(config.id).toBe("ml/rellenarOrderId");
    expect(config.triggers).toEqual([{ event: "ml/orderId.relleno-solicitado" }]);
    expect(JSON.stringify(config.triggers)).not.toContain("cron");
  });
});
