/**
 * Pruebas de los DOS caminos nuevos de `procesar-shipment.ts`:
 *
 *  1. **El envío desconocido se ingesta.** Antes, un shipment que no estaba en
 *     `operacion.pedidos` se descartaba con el comentario «puede ser de un
 *     seller no conectado». El razonamiento estaba al revés: ML solo notifica
 *     cuentas que autorizaron nuestra app. Ese descarte era la mitad del
 *     bloqueador raíz — un pedido Flex nuevo no entraba al sistema.
 *     El requisito explícito de la tarea vive aquí: **un `user_id` ajeno NO
 *     ingesta nada**, ni una llamada a ML ni una escritura.
 *
 *  2. **La cancelación se avisa, no se aplica.** `integraciones` detecta y
 *     publica `operacion/pedido.cancelado-en-ml`; mover el estado, abrir la
 *     incidencia y cerrar el cabo de dinero es del consumidor.
 *
 * Van en archivo aparte de `procesar-shipment.test.ts` porque necesitan mockear
 * el cliente de Inngest y el módulo de secretos, y esos mocks se izan a todo el
 * archivo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCrearClienteServiceRole = vi.fn();

vi.mock("@/modules/operacion", () => ({
  actualizarEstadoPedido: vi.fn(),
}));
vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: () => mockCrearClienteServiceRole(),
}));
vi.mock("@/lib/inngest/cliente", () => ({
  inngest: {
    createFunction: vi.fn((config: unknown, handler: unknown) => ({ config, handler })),
    send: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("../../secretos", () => ({
  descifrarSecreto: vi.fn().mockResolvedValue({ valor: "tok-secretisimo-de-prueba" }),
}));
vi.mock("@/modules/operacion/zonas", () => ({
  resolverZona: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/modules/operacion/ventanas-corte", () => ({
  resolverVentanaCorte: vi.fn().mockResolvedValue(null),
}));

import { inngest } from "@/lib/inngest/cliente";
import {
  ingestarShipmentDesconocido,
  jobProcesarShipmentActualizado,
  resetFnActualizarEstado,
  setFnActualizarEstado,
} from "./procesar-shipment";

const TOKEN_FIXTURE = "tok-secretisimo-de-prueba";
const NOMBRE_FIXTURE = "María Fernanda Rojas";

function respuestaFalsa(opciones: { status?: number; json?: unknown } = {}) {
  const status = opciones.status ?? 200;
  const cuerpo = opciones.json ?? {};
  const r = {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => cuerpo,
    text: async () => JSON.stringify(cuerpo),
    clone: () => r,
  };
  return r;
}

function shipmentFlex(overrides: Record<string, unknown> = {}) {
  return {
    id: 44012345678,
    status: "ready_to_ship",
    substatus: "printed",
    logistic: { mode: "me2", type: "self_service", direction: "forward" },
    order_id: 2000000001,
    destination: {
      receiver_name: NOMBRE_FIXTURE,
      shipping_address: {
        address_line: "Avenida Apoquindo 4501",
        city: { name: "Las Condes" },
      },
    },
    lead_time: { estimated_delivery_time: { date: "2026-08-13T01:30:00.000Z" } },
    ...overrides,
  };
}

function crearLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

// -----------------------------------------------------------------------------
// Doble de Supabase
// -----------------------------------------------------------------------------

interface ConfigDoble {
  /** Conexiones que devuelve la búsqueda por `ml_user_id`. */
  conexiones?: Array<Record<string, unknown>>;
  /** Filas que devuelve la búsqueda de pedidos por `ml_shipment_id`. */
  pedidos?: Array<Record<string, unknown>>;
}

function crearSupabaseFalso(config: ConfigDoble = {}) {
  const registro = {
    pedidoInsert: [] as Record<string, unknown>[],
    pedidoUpdate: [] as Record<string, unknown>[],
  };

  /* eslint-disable @typescript-eslint/no-explicit-any */
  function builder(schema: string, tabla: string) {
    const clave = `${schema}.${tabla}`;
    const cadena: any = {};
    const self = () => cadena;
    cadena.select = vi.fn(self);
    cadena.eq = vi.fn(self);
    cadena.in = vi.fn(self);
    cadena.limit = vi.fn(self);

    cadena.maybeSingle = vi.fn(async () => ({
      data:
        clave === "identidad.conexiones_seller_ml"
          ? ((config.conexiones ?? [])[0] ?? null)
          : null,
      error: null,
    }));

    cadena.insert = vi.fn((valores: Record<string, unknown>) => {
      registro.pedidoInsert.push(valores);
      const c: any = {};
      c.select = vi.fn(() => c);
      c.maybeSingle = vi.fn(async () => ({
        data: { id: `pedido-nuevo-${registro.pedidoInsert.length}` },
        error: null,
      }));
      return c;
    });

    cadena.update = vi.fn((valores: Record<string, unknown>) => {
      if (clave === "operacion.pedidos") registro.pedidoUpdate.push(valores);
      return { eq: vi.fn(async () => ({ error: null })) };
    });

    cadena.then = (
      resolver: (r: { data: unknown; error: unknown }) => unknown,
      rechazar?: (e: unknown) => unknown,
    ) => {
      const data =
        clave === "identidad.conexiones_seller_ml"
          ? (config.conexiones ?? [])
          : clave === "operacion.pedidos"
            ? (config.pedidos ?? [])
            : [];
      return Promise.resolve({ data, error: null }).then(resolver, rechazar);
    };

    return cadena;
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const cliente = {
    schema: vi.fn((s: string) => ({ from: vi.fn((t: string) => builder(s, t)) })),
  };
  return { cliente, registro };
}

const CONEXION = {
  id: "conn-1",
  tenant_id: "tenant-1",
  seller_id: "seller-1",
  ml_user_id: "ml-user-99",
  access_token_ref: "ref-token",
  estado_salud: "sana",
};

const PEDIDO_VIVO = {
  id: "pedido-1",
  tenant_id: "tenant-1",
  seller_id: "seller-1",
  ml_shipment_id: "44012345678",
  estado: "asignado",
  estado_ml: "ready_to_ship",
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const handlerJob = (jobProcesarShipmentActualizado as unknown as { handler: any }).handler as (
  ctx: {
    event: { data: Record<string, unknown> };
    step: { run: <T>(l: string, fn: () => Promise<T>) => Promise<T> };
    logger: ReturnType<typeof crearLogger>;
  },
) => Promise<Record<string, unknown>>;
/* eslint-enable @typescript-eslint/no-explicit-any */

const stepFalso = { run: <T,>(_l: string, fn: () => Promise<T>): Promise<T> => fn() };

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetFnActualizarEstado();
});

// =============================================================================
// 1 · El envío desconocido se ingesta (y solo si la cuenta es nuestra)
// =============================================================================

describe("ingestarShipmentDesconocido", () => {
  it("REQUISITO: un `user_id` AJENO no ingesta nada — ni llamada a ML ni escritura", async () => {
    // Este es el caso REAL de "seller no conectado": el user_id no pertenece a
    // ninguna cuenta vinculada a nosotros.
    const { cliente, registro } = crearSupabaseFalso({ conexiones: [] });
    mockCrearClienteServiceRole.mockReturnValue(cliente);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await ingestarShipmentDesconocido(
      "999888777",
      "ml-user-AJENO",
      crearLogger(),
    );

    expect(resultado.resultado).toBe("sin_conexion");
    expect(resultado.insertados).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(registro.pedidoInsert).toHaveLength(0);
  });

  it("una conexión desvinculada tampoco ingesta: no hay token válido que usar", async () => {
    const { cliente, registro } = crearSupabaseFalso({
      conexiones: [{ ...CONEXION, estado_salud: "desvinculada" }],
    });
    mockCrearClienteServiceRole.mockReturnValue(cliente);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await ingestarShipmentDesconocido("999", "ml-user-99", crearLogger());

    expect(resultado.resultado).toBe("sin_conexion");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(registro.pedidoInsert).toHaveLength(0);
  });

  it("un `user_id` NUESTRO sí ingesta el envío desconocido", async () => {
    const { cliente, registro } = crearSupabaseFalso({ conexiones: [CONEXION] });
    mockCrearClienteServiceRole.mockReturnValue(cliente);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respuestaFalsa({ json: shipmentFlex() })),
    );

    const resultado = await ingestarShipmentDesconocido(
      "44012345678",
      "ml-user-99",
      crearLogger(),
    );

    expect(resultado.resultado).toBe("ingestado");
    expect(resultado.insertados).toBe(1);
    expect(registro.pedidoInsert[0]).toMatchObject({
      tenant_id: "tenant-1",
      seller_id: "seller-1",
      ml_user_id: "ml-user-99",
      tipo_pedido: "flex",
      origen: "ml_ingesta",
      ml_shipment_id: "44012345678",
      // El id de la orden sale del propio shipment: el webhook no lo conoce.
      ml_order_id: "2000000001",
    });
  });

  it("un envío que NO es Flex se lee pero no se ingesta (Full/Colecta los despacha ML)", async () => {
    const { cliente, registro } = crearSupabaseFalso({ conexiones: [CONEXION] });
    mockCrearClienteServiceRole.mockReturnValue(cliente);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respuestaFalsa({ json: shipmentFlex({ logistic: { type: "fulfillment" } }) }),
      ),
    );

    const resultado = await ingestarShipmentDesconocido(
      "44012345678",
      "ml-user-99",
      crearLogger(),
    );

    expect(resultado.resultado).toBe("nada_que_ingestar");
    expect(resultado.omitidosNoFlex).toBe(1);
    expect(registro.pedidoInsert).toHaveLength(0);
  });

  it("un 404 tras la propia notificación de ML se registra y NO se asume cancelación", async () => {
    const { cliente, registro } = crearSupabaseFalso({ conexiones: [CONEXION] });
    mockCrearClienteServiceRole.mockReturnValue(cliente);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respuestaFalsa({ status: 404, json: { message: "not found" } })),
    );

    const logger = crearLogger();
    const resultado = await ingestarShipmentDesconocido("44012345678", "ml-user-99", logger);

    expect(resultado.noEncontrados).toBe(1);
    expect(registro.pedidoInsert).toHaveLength(0);
    expect(logger.error.mock.calls.flat().join(" ")).toContain("No se asume cancelación");
  });

  it("la misma cuenta ML conectada por dos couriers ingesta para AMBOS tenants", async () => {
    // `ml_user_id` no es único globalmente: el UNIQUE es (seller_id, ml_user_id),
    // y el de pedidos es (tenant_id, ml_shipment_id).
    const { cliente, registro } = crearSupabaseFalso({
      conexiones: [
        CONEXION,
        { ...CONEXION, id: "conn-2", tenant_id: "tenant-2", seller_id: "seller-2" },
      ],
    });
    mockCrearClienteServiceRole.mockReturnValue(cliente);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respuestaFalsa({ json: shipmentFlex() })),
    );

    await ingestarShipmentDesconocido("44012345678", "ml-user-99", crearLogger());

    expect(registro.pedidoInsert.map((p) => p.tenant_id)).toEqual(["tenant-1", "tenant-2"]);
  });

  it("no filtra el token ni datos del destinatario en los logs", async () => {
    const { cliente } = crearSupabaseFalso({ conexiones: [CONEXION] });
    mockCrearClienteServiceRole.mockReturnValue(cliente);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respuestaFalsa({ json: shipmentFlex() })),
    );

    const logger = crearLogger();
    await ingestarShipmentDesconocido("44012345678", "ml-user-99", logger);

    const todo = [
      ...logger.info.mock.calls.flat(),
      ...logger.warn.mock.calls.flat(),
      ...logger.error.mock.calls.flat(),
    ].join("\n");
    expect(todo).not.toContain(TOKEN_FIXTURE);
    expect(todo).not.toContain(NOMBRE_FIXTURE);
  });
});

describe("jobProcesarShipmentActualizado — envío que no está en BD", () => {
  it("el handler enruta al camino de ingesta en vez de descartar en silencio", async () => {
    const { cliente, registro } = crearSupabaseFalso({
      pedidos: [], // el shipment no existe en operacion.pedidos
      conexiones: [CONEXION],
    });
    mockCrearClienteServiceRole.mockReturnValue(cliente);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respuestaFalsa({ json: shipmentFlex() })),
    );

    const resultado = await handlerJob({
      event: { data: { shipmentId: "44012345678", userId: "ml-user-99", timestamp: "x" } },
      step: stepFalso,
      logger: crearLogger(),
    });

    expect(resultado.resultado).toBe("shipment_desconocido_ingestado");
    expect(registro.pedidoInsert).toHaveLength(1);
  });

  it("con `user_id` ajeno el handler termina sin ingestar ni consultar a ML", async () => {
    const { cliente, registro } = crearSupabaseFalso({ pedidos: [], conexiones: [] });
    mockCrearClienteServiceRole.mockReturnValue(cliente);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await handlerJob({
      event: { data: { shipmentId: "44012345678", userId: "ml-user-AJENO", timestamp: "x" } },
      step: stepFalso,
      logger: crearLogger(),
    });

    expect(resultado.resultado).toBe("shipment_desconocido_sin_conexion");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(registro.pedidoInsert).toHaveLength(0);
  });
});

// =============================================================================
// 2 · La cancelación se avisa, no se aplica
// =============================================================================

describe("jobProcesarShipmentActualizado — cancelación reportada por ML", () => {
  it("publica `operacion/pedido.cancelado-en-ml` y NO mueve el estado del pedido", async () => {
    const { cliente, registro } = crearSupabaseFalso({
      pedidos: [PEDIDO_VIVO],
      conexiones: [CONEXION],
    });
    mockCrearClienteServiceRole.mockReturnValue(cliente);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respuestaFalsa({
          json: { id: 44012345678, status: "cancelled", substatus: "buyer_cancelled" },
        }),
      ),
    );

    const fnActualizar = vi.fn();
    setFnActualizarEstado(fnActualizar);

    const resultado = await handlerJob({
      event: { data: { shipmentId: "44012345678", userId: "ml-user-99", timestamp: "x" } },
      step: stepFalso,
      logger: crearLogger(),
    });

    expect(resultado.resultado).toBe("cancelacion_publicada");
    // El adaptador NO aplica la cancelación: eso es del consumidor del evento.
    expect(fnActualizar).not.toHaveBeenCalled();
    expect(registro.pedidoUpdate).toHaveLength(0);
    expect(inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "operacion/pedido.cancelado-en-ml",
        id: "pedido-cancelado-ml-pedido-1",
        data: expect.objectContaining({
          pedidoId: "pedido-1",
          tenantId: "tenant-1",
          sellerId: "seller-1",
          mlShipmentId: "44012345678",
          estadoAnterior: "asignado",
          substatusMl: "buyer_cancelled",
        }),
      }),
    );
  });

  it("una transición que NO es cancelación se sigue aplicando como siempre", async () => {
    const { cliente } = crearSupabaseFalso({ pedidos: [PEDIDO_VIVO], conexiones: [CONEXION] });
    mockCrearClienteServiceRole.mockReturnValue(cliente);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respuestaFalsa({ json: { id: 1, status: "shipped", substatus: null } })),
    );

    const fnActualizar = vi.fn().mockResolvedValue(undefined);
    setFnActualizarEstado(fnActualizar);

    const resultado = await handlerJob({
      event: { data: { shipmentId: "44012345678", userId: "ml-user-99", timestamp: "x" } },
      step: stepFalso,
      logger: crearLogger(),
    });

    expect(resultado.resultado).toBe("actualizado");
    expect(fnActualizar).toHaveBeenCalledWith(
      expect.objectContaining({ estadoNuevo: "en_ruta", estadoEsperado: "asignado" }),
    );
  });

  it("un pedido YA cancelado no vuelve a publicar el evento (no-op idempotente)", async () => {
    const { cliente } = crearSupabaseFalso({
      pedidos: [{ ...PEDIDO_VIVO, estado: "cancelado" }],
      conexiones: [CONEXION],
    });
    mockCrearClienteServiceRole.mockReturnValue(cliente);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respuestaFalsa({ json: { id: 1, status: "cancelled", substatus: null } }),
      ),
    );

    const resultado = await handlerJob({
      event: { data: { shipmentId: "44012345678", userId: "ml-user-99", timestamp: "x" } },
      step: stepFalso,
      logger: crearLogger(),
    });

    expect(resultado.resultado).toBe("ya_en_estado");
    const nombres = vi.mocked(inngest.send).mock.calls.map((c) => (c[0] as { name: string }).name);
    expect(nombres).not.toContain("operacion/pedido.cancelado-en-ml");
  });
});
