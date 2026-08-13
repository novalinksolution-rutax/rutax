/**
 * Pruebas de la pieza compartida de ingesta (`ingesta-pedidos.ts`).
 *
 * REGLA DE ESTE ARCHIVO (heredada de `ejecutar-backfill.test.ts`): se ejerce el
 * CÓDIGO REAL. Nada de copias espejo de la lógica bajo prueba — ese vicio ya
 * dejó pasar dos bugs de ingesta a producción.
 *
 * El foco está en lo que esta refactorización cambia de verdad:
 *  1. INSERT vs UPDATE explícitos. El `upsert` anterior escribía
 *     `estado: 'pendiente_asignacion'` también al actualizar; con una ingesta
 *     continua cada 30 min eso devolvía a la bandeja cualquier pedido ya
 *     asignado o en ruta. Es el test que más importa de todo el archivo.
 *  2. Idempotencia real ante la carrera webhook↔cron (unique_violation 23505).
 *  3. El 404 se cuenta aparte y NUNCA se interpreta como cancelación.
 *  4. Nada de PII ni de token en logs ni en el evento de geocodificación.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/inngest/cliente", () => ({
  inngest: { send: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("@/modules/operacion/zonas", () => ({
  resolverZona: vi.fn().mockResolvedValue("zona-1"),
}));

vi.mock("@/modules/operacion/ventanas-corte", () => ({
  resolverVentanaCorte: vi.fn().mockResolvedValue(null),
}));

import { inngest } from "@/lib/inngest/cliente";
import {
  guardarPedidoFlex,
  ingestarShipmentsMl,
  leerOrderIdDeShipment,
  type ContextoIngestaMl,
  type DatosShipmentMl,
  type ShipmentMl,
} from "./ingesta-pedidos";

// -----------------------------------------------------------------------------
// Dobles
// -----------------------------------------------------------------------------

const NOMBRE_FIXTURE = "María Fernanda Rojas";
const CALLE_FIXTURE = "Avenida Apoquindo 4501, depto 1203";
const TOKEN_FIXTURE = "tok-secretisimo-de-prueba";

function shipmentFlex(overrides: Partial<ShipmentMl> = {}): ShipmentMl {
  return {
    id: 44012345678,
    status: "ready_to_ship",
    substatus: "printed",
    date_created: "2026-08-10T14:00:00.000Z",
    logistic: { mode: "me2", type: "self_service", direction: "forward" },
    order_id: 2000000001,
    destination: {
      receiver_name: NOMBRE_FIXTURE,
      shipping_address: {
        address_line: CALLE_FIXTURE,
        city: { name: "Las Condes" },
        latitude: -33.4089,
        longitude: -70.5678,
      },
    },
    lead_time: { estimated_delivery_time: { date: "2026-08-13T01:30:00.000Z" } },
    ...overrides,
  };
}

function datosFlex(overrides: Partial<DatosShipmentMl> = {}): DatosShipmentMl {
  return {
    logisticType: "self_service",
    lat: -33.4089,
    long: -70.5678,
    estadoMl: "ready_to_ship",
    subestadoMl: "printed",
    fechaEntregaIso: "2026-08-13T01:30:00.000Z",
    destinatarioNombre: NOMBRE_FIXTURE,
    destinatarioDireccion: CALLE_FIXTURE,
    destinatarioComuna: "Las Condes",
    ...overrides,
  };
}

interface ConfigDoble {
  /** Pedidos que ya existen, indexados por `ml_shipment_id`. */
  existentes?: Array<Record<string, unknown>>;
  /** Error que devuelve el INSERT (p. ej. `{ code: '23505' }`). */
  errorInsert?: { message: string; code?: string } | null;
  /** Tras un 23505, la relectura sí encuentra la fila. */
  existentesTrasConflicto?: Record<string, unknown> | null;
}

function crearSupabaseFalso(config: ConfigDoble = {}) {
  const registro = {
    insert: [] as Record<string, unknown>[],
    update: [] as Record<string, unknown>[],
    updateIds: [] as unknown[],
  };
  let lecturas = 0;

  /* eslint-disable @typescript-eslint/no-explicit-any */
  function builder() {
    const filtros: Record<string, unknown> = {};
    const cadena: any = {};
    cadena.select = vi.fn(() => cadena);
    cadena.eq = vi.fn((c: string, v: unknown) => {
      filtros[c] = v;
      return cadena;
    });
    cadena.maybeSingle = vi.fn(async () => {
      lecturas += 1;
      const id = String(filtros["ml_shipment_id"] ?? "");
      if (lecturas > 1 && config.existentesTrasConflicto) {
        return { data: config.existentesTrasConflicto, error: null };
      }
      const fila = (config.existentes ?? []).find((p) => String(p.ml_shipment_id) === id);
      return { data: fila ?? null, error: null };
    });
    cadena.insert = vi.fn((valores: Record<string, unknown>) => {
      registro.insert.push(valores);
      const c: any = {};
      c.select = vi.fn(() => c);
      c.maybeSingle = vi.fn(async () =>
        config.errorInsert
          ? { data: null, error: config.errorInsert }
          : { data: { id: `pedido-${registro.insert.length}` }, error: null },
      );
      return c;
    });
    cadena.update = vi.fn((valores: Record<string, unknown>) => {
      registro.update.push(valores);
      return {
        eq: vi.fn(async (_c: string, v: unknown) => {
          registro.updateIds.push(v);
          return { error: null };
        }),
      };
    });
    return cadena;
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const cliente = { schema: vi.fn(() => ({ from: vi.fn(() => builder()) })) };
  return { cliente, registro };
}

const CTX: ContextoIngestaMl = {
  tenantId: "tenant-1",
  sellerId: "seller-1",
  mlUserId: "ml-user-99",
  origen: "ml_ingesta",
};

interface OpcionesRespuesta {
  status?: number;
  json?: unknown;
}

function respuestaFalsa(opciones: OpcionesRespuesta = {}) {
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

function stubShipments(porId: Record<string, unknown>) {
  const fetchMock = vi.fn(async (url: string) => {
    const id = String(url).split("/").pop() as string;
    const s = porId[id];
    if (!s) return respuestaFalsa({ status: 404, json: { message: "not found" } });
    return respuestaFalsa({ json: s });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const comoSupabase = (c: unknown) => c as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// =============================================================================
// leerOrderIdDeShipment
// =============================================================================

describe("leerOrderIdDeShipment — el webhook solo conoce el shipment", () => {
  it("lee `order_id` plano", () => {
    expect(leerOrderIdDeShipment({ order_id: 2000000001 })).toBe("2000000001");
  });

  it("lee `orders[0].id` cuando no hay plano", () => {
    expect(leerOrderIdDeShipment({ orders: [{ id: "777" }] })).toBe("777");
  });

  it("devuelve null si ML no lo trae (NO se inventa un id)", () => {
    expect(leerOrderIdDeShipment({})).toBeNull();
    expect(leerOrderIdDeShipment({ order_id: null })).toBeNull();
    expect(leerOrderIdDeShipment({ orders: [] })).toBeNull();
    expect(leerOrderIdDeShipment(null)).toBeNull();
  });
});

// =============================================================================
// INSERT — pedido nuevo
// =============================================================================

describe("guardarPedidoFlex — INSERT de un pedido nuevo", () => {
  it("inserta con los datos del envío y publica el evento de geocodificación", async () => {
    const { cliente, registro } = crearSupabaseFalso();

    const resultado = await guardarPedidoFlex(
      comoSupabase(cliente),
      CTX,
      { shipmentId: "44012345678", mlOrderId: "2000000001", ordenCreadaIso: "2026-08-10T14:00:00.000Z" },
      datosFlex(),
      null,
    );

    expect(resultado).toEqual({ estado: "insertado", pedidoId: "pedido-1" });
    expect(registro.insert).toHaveLength(1);
    const fila = registro.insert[0];
    expect(fila.tipo_pedido).toBe("flex");
    expect(fila.origen).toBe("ml_ingesta");
    expect(fila.ml_user_id).toBe("ml-user-99");
    expect(fila.ml_order_id).toBe("2000000001");
    expect(fila.estado_ml).toBe("ready_to_ship");
    // 01:30 UTC del 13 = 21:30 del 12 en Santiago (invierno, UTC-4).
    expect(fila.fecha_compromiso).toBe("2026-08-12");
    expect(fila.geo_estado).toBe("resuelto");

    expect(inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "operacion/pedido.ingestado",
        id: "pedido-ingestado-pedido-1",
      }),
    );
  });

  it("NO manda `estado` en el INSERT: lo pone el default de la columna", async () => {
    // Si `estado` viajara en el payload, viajaría también en el UPDATE del
    // upsert anterior — que es exactamente el bug que se está cerrando.
    const { cliente, registro } = crearSupabaseFalso();
    await guardarPedidoFlex(comoSupabase(cliente), CTX, { shipmentId: "1" }, datosFlex(), null);
    expect(Object.keys(registro.insert[0])).not.toContain("estado");
  });

  it("el evento de geocodificación NO lleva nombre ni teléfono del destinatario", async () => {
    const { cliente } = crearSupabaseFalso();
    await guardarPedidoFlex(comoSupabase(cliente), CTX, { shipmentId: "1" }, datosFlex(), null);

    const enviado = vi.mocked(inngest.send).mock.calls[0][0];
    const serializado = JSON.stringify(enviado);
    expect(serializado).not.toContain(NOMBRE_FIXTURE);
    expect(serializado).toContain(CALLE_FIXTURE); // la dirección sí: es lo que se geocodifica
  });

  it("sin coordenada de ML no se escribe geo: el pedido va a la cola de geocoding", async () => {
    const { cliente, registro } = crearSupabaseFalso();
    await guardarPedidoFlex(
      comoSupabase(cliente),
      CTX,
      { shipmentId: "1" },
      datosFlex({ lat: null, long: null }),
      null,
    );
    expect(registro.insert[0]).not.toHaveProperty("geo_estado");
    expect(registro.insert[0]).not.toHaveProperty("lat");
  });

  it("un fallo del evento Inngest no rompe la ingesta (el pedido ya está guardado)", async () => {
    vi.mocked(inngest.send).mockRejectedValueOnce(new Error("Inngest caído"));
    const { cliente } = crearSupabaseFalso();

    const resultado = await guardarPedidoFlex(
      comoSupabase(cliente),
      CTX,
      { shipmentId: "1" },
      datosFlex(),
      null,
    );
    expect(resultado.estado).toBe("insertado");
  });
});

// =============================================================================
// UPDATE — el bug que se está cerrando
// =============================================================================

describe("guardarPedidoFlex — UPDATE de un pedido que ya existe", () => {
  const existente = {
    id: "pedido-viejo",
    ml_shipment_id: "44012345678",
    ml_order_id: "2000000001",
    geo_estado: "resuelto",
  };

  it("REGRESIÓN: no toca `estado` — un pedido asignado no vuelve a la bandeja", async () => {
    // El `upsert` anterior mandaba `estado: 'pendiente_asignacion'` en cada
    // pasada. Con el backfill (una vez al reconectar) no se notaba; con la
    // ingesta continua cada 30 min habría reseteado la operación del día.
    const { cliente, registro } = crearSupabaseFalso({ existentes: [existente] });

    const resultado = await guardarPedidoFlex(
      comoSupabase(cliente),
      CTX,
      { shipmentId: "44012345678" },
      datosFlex({ estadoMl: "shipped", subestadoMl: null }),
      null,
    );

    expect(resultado).toEqual({ estado: "actualizado", pedidoId: "pedido-viejo" });
    expect(registro.insert).toHaveLength(0);
    expect(registro.update).toHaveLength(1);
    const cambios = registro.update[0];
    expect(cambios).not.toHaveProperty("estado");
    expect(cambios.estado_ml).toBe("shipped");
    expect(registro.updateIds).toEqual(["pedido-viejo"]);
  });

  it("tampoco toca `origen` ni `corte_riesgo` (describen el momento del alta)", async () => {
    const { cliente, registro } = crearSupabaseFalso({ existentes: [existente] });
    await guardarPedidoFlex(
      comoSupabase(cliente),
      CTX,
      { shipmentId: "44012345678" },
      datosFlex(),
      null,
    );
    expect(registro.update[0]).not.toHaveProperty("origen");
    expect(registro.update[0]).not.toHaveProperty("corte_riesgo");
  });

  it("no pisa un `ml_order_id` conocido con un null del webhook", async () => {
    const { cliente, registro } = crearSupabaseFalso({ existentes: [existente] });
    await guardarPedidoFlex(
      comoSupabase(cliente),
      CTX,
      { shipmentId: "44012345678" }, // el webhook no conoce la orden
      datosFlex(),
      null,
    );
    expect(registro.update[0]).not.toHaveProperty("ml_order_id");
  });

  it("sí rellena `ml_order_id` cuando faltaba", async () => {
    const { cliente, registro } = crearSupabaseFalso({
      existentes: [{ ...existente, ml_order_id: null }],
    });
    await guardarPedidoFlex(
      comoSupabase(cliente),
      CTX,
      { shipmentId: "44012345678" },
      datosFlex(),
      "2000000009",
    );
    expect(registro.update[0].ml_order_id).toBe("2000000009");
  });

  it("refresca la dirección cuando ML la revela (se oculta hasta el pago confirmado)", async () => {
    const { cliente, registro } = crearSupabaseFalso({ existentes: [existente] });
    await guardarPedidoFlex(
      comoSupabase(cliente),
      CTX,
      { shipmentId: "44012345678" },
      datosFlex({ destinatarioDireccion: "Calle Nueva 123", destinatarioComuna: "Ñuñoa" }),
      null,
    );
    expect(registro.update[0].destinatario_direccion).toBe("Calle Nueva 123");
    expect(registro.update[0].destinatario_comuna).toBe("Ñuñoa");
  });

  it("NO escribe 'Dirección pendiente' encima de una dirección real", async () => {
    const { cliente, registro } = crearSupabaseFalso({ existentes: [existente] });
    await guardarPedidoFlex(
      comoSupabase(cliente),
      CTX,
      { shipmentId: "44012345678" },
      datosFlex({ destinatarioDireccion: null, destinatarioComuna: null, destinatarioNombre: null }),
      null,
    );
    expect(registro.update[0]).not.toHaveProperty("destinatario_direccion");
    expect(registro.update[0]).not.toHaveProperty("destinatario_comuna");
    expect(registro.update[0]).not.toHaveProperty("destinatario_nombre");
  });

  it("no re-escribe la geo si ya estaba resuelta (geocodificado_en no miente)", async () => {
    const { cliente, registro } = crearSupabaseFalso({ existentes: [existente] });
    await guardarPedidoFlex(
      comoSupabase(cliente),
      CTX,
      { shipmentId: "44012345678" },
      datosFlex(),
      null,
    );
    expect(registro.update[0]).not.toHaveProperty("geocodificado_en");
  });

  it("sí rellena la geo si el pedido seguía pendiente", async () => {
    const { cliente, registro } = crearSupabaseFalso({
      existentes: [{ ...existente, geo_estado: "pendiente" }],
    });
    await guardarPedidoFlex(
      comoSupabase(cliente),
      CTX,
      { shipmentId: "44012345678" },
      datosFlex(),
      null,
    );
    expect(registro.update[0].geo_estado).toBe("resuelto");
    expect(registro.update[0].lat).toBe(-33.4089);
  });

  it("no publica el evento de geocodificación en un UPDATE", async () => {
    const { cliente } = crearSupabaseFalso({ existentes: [existente] });
    await guardarPedidoFlex(
      comoSupabase(cliente),
      CTX,
      { shipmentId: "44012345678" },
      datosFlex(),
      null,
    );
    expect(inngest.send).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Carrera webhook ↔ cron
// =============================================================================

describe("guardarPedidoFlex — carrera entre webhook y cron", () => {
  it("un 23505 del INSERT se resuelve releyendo y actualizando (idempotente)", async () => {
    const { cliente, registro } = crearSupabaseFalso({
      errorInsert: { message: "duplicate key value", code: "23505" },
      existentesTrasConflicto: {
        id: "pedido-del-otro",
        ml_order_id: null,
        geo_estado: "pendiente",
      },
    });

    const resultado = await guardarPedidoFlex(
      comoSupabase(cliente),
      CTX,
      { shipmentId: "44012345678" },
      datosFlex(),
      null,
    );

    expect(resultado).toEqual({ estado: "actualizado", pedidoId: "pedido-del-otro" });
    expect(registro.update).toHaveLength(1);
  });

  it("un error de INSERT que NO es 23505 se reporta como error (no se traga)", async () => {
    const { cliente } = crearSupabaseFalso({
      errorInsert: { message: 'column "fecha_compromiso" does not exist', code: "42703" },
    });

    const resultado = await guardarPedidoFlex(
      comoSupabase(cliente),
      CTX,
      { shipmentId: "1" },
      datosFlex(),
      null,
    );

    expect(resultado.estado).toBe("error");
    expect(resultado).toMatchObject({ mensaje: expect.stringContaining("fecha_compromiso") });
  });
});

// =============================================================================
// ingestarShipmentsMl — lote completo contra la capa HTTP real
// =============================================================================

describe("ingestarShipmentsMl — lote", () => {
  it("ingiere solo Flex y cuenta el resto por separado", async () => {
    const { cliente, registro } = crearSupabaseFalso();
    stubShipments({
      "111": shipmentFlex(),
      "222": shipmentFlex({ logistic: { type: "fulfillment" } }),
      // "333" no existe → 404
    });

    const resumen = await ingestarShipmentsMl(
      comoSupabase(cliente),
      [{ shipmentId: "111" }, { shipmentId: "222" }, { shipmentId: "333" }],
      CTX,
      TOKEN_FIXTURE,
    );

    expect(resumen.insertados).toBe(1);
    expect(resumen.omitidosNoFlex).toBe(1);
    // El 404 va a su propio contador: NO se asume cancelación y no es "ilegible".
    expect(resumen.noEncontrados).toEqual(["333"]);
    expect(resumen.ilegibles).toBe(0);
    expect(registro.insert).toHaveLength(1);
  });

  it("un shipment sin logistic_type NUNCA se ingiere como Flex por descarte", async () => {
    const { cliente, registro } = crearSupabaseFalso();
    stubShipments({ "111": shipmentFlex({ logistic: null, logistic_type: null }) });

    const resumen = await ingestarShipmentsMl(
      comoSupabase(cliente),
      [{ shipmentId: "111" }],
      CTX,
      TOKEN_FIXTURE,
    );

    expect(resumen.insertados).toBe(0);
    expect(resumen.omitidosNoFlex).toBe(1);
    expect(registro.insert).toHaveLength(0);
  });

  it("el token va en el header y no aparece en el resumen ni en los logs", async () => {
    const { cliente } = crearSupabaseFalso();
    const fetchMock = stubShipments({ "111": shipmentFlex() });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const resumen = await ingestarShipmentsMl(
      comoSupabase(cliente),
      [{ shipmentId: "111" }],
      CTX,
      TOKEN_FIXTURE,
      { logger },
    );

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(init.headers.authorization).toBe(`Bearer ${TOKEN_FIXTURE}`);
    expect(init.headers["x-format-new"]).toBe("true");

    const todo = [
      JSON.stringify(resumen),
      ...logger.info.mock.calls.flat(),
      ...logger.warn.mock.calls.flat(),
      ...logger.error.mock.calls.flat(),
    ].join("\n");
    expect(todo).not.toContain(TOKEN_FIXTURE);
    expect(todo).not.toContain(NOMBRE_FIXTURE);
    expect(todo).not.toContain(CALLE_FIXTURE);
  });

  it("un error de persistencia se cuenta y no interrumpe el resto del lote", async () => {
    const { cliente } = crearSupabaseFalso({
      errorInsert: { message: "RLS denied", code: "42501" },
    });
    stubShipments({ "111": shipmentFlex(), "222": shipmentFlex() });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const resumen = await ingestarShipmentsMl(
      comoSupabase(cliente),
      [{ shipmentId: "111" }, { shipmentId: "222" }],
      CTX,
      TOKEN_FIXTURE,
      { logger },
    );

    expect(resumen.erroresPersistencia).toBe(2);
    expect(resumen.primerErrorPersistencia).toContain("RLS denied");
    expect(resumen.procesados).toBe(0);
    expect(logger.error).toHaveBeenCalledTimes(2);
  });

  it("lote vacío → no llama a ML ni escribe nada", async () => {
    const { cliente, registro } = crearSupabaseFalso();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const resumen = await ingestarShipmentsMl(comoSupabase(cliente), [], CTX, TOKEN_FIXTURE);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(registro.insert).toHaveLength(0);
    expect(resumen.procesados).toBe(0);
  });
});
