/**
 * Pruebas del cron de ingesta continua (`ml/ingestaPedidos`) y de la
 * sincronización manual.
 *
 * REGLA DEL ARCHIVO: se ejerce el CÓDIGO REAL — la rutina por conexión completa,
 * con la capa HTTP de verdad (`peticionMl` → `fetch` doblado) y un doble de
 * Supabase. Nada de espejos: el bug histórico de este módulo fue justamente un
 * test que mockeaba el mismo campo inexistente que leía el código.
 *
 * Cobertura:
 *  A. Forma del cron (expresión + zona horaria explícita).
 *  B. Ventana incremental: sin cursor, con cursor, y con un cursor prehistórico.
 *  C. Fase A: no vuelve a pedir el envío de una orden que ya tenemos.
 *  D. Fase B: cancelación → evento, sin tocar el estado; y el 404 NO es cancelación.
 *  E. Degradación cuando la migración del cursor todavía no está aplicada.
 *  F. Seguridad: ni token ni PII en resúmenes ni en logs.
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

vi.mock("@/modules/operacion/zonas", () => ({
  resolverZona: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/modules/operacion/ventanas-corte", () => ({
  resolverVentanaCorte: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/observabilidad", () => ({
  capturarMensaje: vi.fn().mockResolvedValue(undefined),
}));

import { inngest } from "@/lib/inngest/cliente";
import { capturarMensaje } from "@/lib/observabilidad";
import {
  calcularVentanaFaseA,
  COLUMNA_CURSOR,
  CRON_INGESTA_ML,
  ESTADOS_NO_TERMINALES,
  FRESCURA_MINUTOS,
  jobIngestaPedidosMl,
  jobSincronizarConexionMl,
  leerConexionesParaIngesta,
  sincronizarConexionMl,
  SOLAPAMIENTO_MS,
  type ConexionIngesta,
} from "./ingesta-pedidos-ml";

const TOKEN_FIXTURE = "tok-secretisimo-de-prueba";
const NOMBRE_FIXTURE = "María Fernanda Rojas";
const CALLE_FIXTURE = "Avenida Apoquindo 4501, depto 1203";

// -----------------------------------------------------------------------------
// Dobles HTTP
// -----------------------------------------------------------------------------

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
    date_created: "2026-08-10T14:00:00.000Z",
    logistic: { mode: "me2", type: "self_service", direction: "forward" },
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

/** Doble de `/orders/search` + `/shipments/{id}`. */
function stubMl(
  paginas: Array<{ results: unknown[]; total: number }>,
  shipments: Record<string, unknown>,
) {
  let indice = 0;
  const fetchMock = vi.fn(async (url: string) => {
    const texto = String(url);
    if (texto.includes("/orders/search")) {
      const pagina = paginas[Math.min(indice, paginas.length - 1)] ?? { results: [], total: 0 };
      indice += 1;
      return respuestaFalsa({
        json: { results: pagina.results, paging: { total: pagina.total, offset: 0, limit: 50 } },
      });
    }
    const id = texto.split("/").pop() as string;
    const s = shipments[id];
    if (!s) return respuestaFalsa({ status: 404, json: { message: "not found" } });
    return respuestaFalsa({ json: s });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// -----------------------------------------------------------------------------
// Doble de Supabase
// -----------------------------------------------------------------------------

interface ConfigDoble {
  /** `ml_shipment_id` de pedidos que ya existen (fase A los debe saltar). */
  shipmentsConocidos?: string[];
  /** Filas que devuelve la consulta de repaso de la fase B. */
  pedidosRepaso?: Array<Record<string, unknown>>;
  /** Conexiones que devuelve `identidad.conexiones_seller_ml`. */
  conexiones?: Array<Record<string, unknown>>;
  /** Simula que la columna del cursor todavía no existe. */
  sinColumnaCursor?: boolean;
}

function crearSupabaseFalso(config: ConfigDoble = {}) {
  const registro = {
    pedidoInsert: [] as Record<string, unknown>[],
    pedidoUpdate: [] as Record<string, unknown>[],
    conexionUpdate: [] as Record<string, unknown>[],
    selectsPedidos: [] as string[],
  };

  /* eslint-disable @typescript-eslint/no-explicit-any */
  function builder(schema: string, tabla: string) {
    const clave = `${schema}.${tabla}`;
    const filtros: Record<string, unknown> = {};
    let columnas = "";
    const cadena: any = {};
    const self = () => cadena;

    cadena.select = vi.fn((cols?: string) => {
      columnas = cols ?? "";
      if (clave === "operacion.pedidos") registro.selectsPedidos.push(columnas);
      return cadena;
    });
    cadena.eq = vi.fn((c: string, v: unknown) => {
      filtros[c] = v;
      return cadena;
    });
    cadena.neq = vi.fn(self);
    cadena.not = vi.fn(self);
    cadena.gte = vi.fn(self);
    cadena.or = vi.fn(self);
    cadena.order = vi.fn(self);

    cadena.in = vi.fn((c: string, vals: unknown[]) => {
      if (clave === "operacion.pedidos" && c === "ml_shipment_id") {
        const conocidos = new Set(config.shipmentsConocidos ?? []);
        const data = (vals as string[])
          .filter((v) => conocidos.has(String(v)))
          .map((v) => ({ ml_shipment_id: v }));
        return Promise.resolve({ data, error: null });
      }
      filtros[c] = vals;
      return cadena;
    });

    cadena.limit = vi.fn(async () => {
      if (clave === "operacion.pedidos") {
        return { data: config.pedidosRepaso ?? [], error: null };
      }
      return { data: [], error: null };
    });

    cadena.maybeSingle = vi.fn(async () => {
      if (clave === "operacion.pedidos") {
        const id = String(filtros["ml_shipment_id"] ?? "");
        const existe = (config.shipmentsConocidos ?? []).includes(id);
        return {
          data: existe ? { id: `pedido-${id}`, ml_order_id: null, geo_estado: "pendiente" } : null,
          error: null,
        };
      }
      return { data: null, error: null };
    });

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
      if (clave === "identidad.conexiones_seller_ml") registro.conexionUpdate.push(valores);
      if (clave === "operacion.pedidos") registro.pedidoUpdate.push(valores);
      return {
        eq: vi.fn(async () => ({ error: null })),
        in: vi.fn(async () => ({ error: null })),
      };
    });

    // Sin `.limit()` ni `.maybeSingle()`, la consulta de conexiones resuelve
    // como thenable (es lo que hace supabase-js).
    cadena.then = (
      resolver: (r: { data: unknown; error: unknown }) => unknown,
      rechazar?: (e: unknown) => unknown,
    ) => {
      if (clave !== "identidad.conexiones_seller_ml") {
        return Promise.resolve({ data: [], error: null }).then(resolver, rechazar);
      }
      if (config.sinColumnaCursor && columnas.includes(COLUMNA_CURSOR)) {
        return Promise.resolve({
          data: null,
          error: {
            code: "42703",
            message: `column conexiones_seller_ml.${COLUMNA_CURSOR} does not exist`,
          },
        }).then(resolver, rechazar);
      }
      return Promise.resolve({ data: config.conexiones ?? [], error: null }).then(
        resolver,
        rechazar,
      );
    };

    return cadena;
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const cliente = {
    schema: vi.fn((s: string) => ({ from: vi.fn((t: string) => builder(s, t)) })),
  };
  return { cliente, registro };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const comoSupabase = (c: unknown) => c as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

const CONEXION: ConexionIngesta = {
  id: "conn-1",
  tenantId: "tenant-1",
  sellerId: "seller-1",
  mlUserId: "ml-user-99",
  accessTokenRef: "ref-token",
  estadoSalud: "sana",
  cursorEn: null,
  esRepresentativaDelSeller: true,
};

function crearLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// =============================================================================
// A · Forma del cron
// =============================================================================

describe("cron de ingesta — forma y zona horaria", () => {
  it("lleva zona horaria EXPLÍCITA: Chile cambia de hora dos veces al año", () => {
    // Sin `TZ=`, medio año la ventana arrancaría a las 05:00 o a las 07:00
    // locales en vez de a las 06:00.
    expect(CRON_INGESTA_ML.startsWith("TZ=America/Santiago ")).toBe(true);
  });

  it("cada 30 minutos, de 06:00 a 22:30 — el intervalo [06:00, 23:00)", () => {
    const [, minuto, hora] = CRON_INGESTA_ML.split(" ");
    expect(minuto).toBe("*/30");
    expect(hora).toBe("6-22"); // 6-23 dispararía también a las 23:30, fuera de la ventana
  });

  it("el job registrado usa esa expresión y limita la concurrencia a 1", () => {
    const config = (jobIngestaPedidosMl as unknown as { config: Record<string, unknown> }).config;
    expect(config.triggers).toEqual([{ cron: CRON_INGESTA_ML }]);
    expect(config.concurrency).toEqual({ limit: 1 });
  });

  it("la sincronización manual se dispara por evento y se serializa por conexión", () => {
    const config = (jobSincronizarConexionMl as unknown as { config: Record<string, unknown> })
      .config;
    expect(config.triggers).toEqual([{ event: "ml/sincronizacion.solicitada" }]);
    expect(config.concurrency).toEqual({ key: "event.data.conexionId", limit: 1 });
  });

  it("los estados no terminales excluyen los cuatro terminales", () => {
    for (const terminal of ["entregado", "entregado_manual", "cancelado", "devuelto"]) {
      expect(ESTADOS_NO_TERMINALES).not.toContain(terminal);
    }
    expect(ESTADOS_NO_TERMINALES).toContain("pendiente_asignacion");
    expect(ESTADOS_NO_TERMINALES).toContain("fallido");
  });
});

// =============================================================================
// B · Ventana incremental
// =============================================================================

describe("calcularVentanaFaseA", () => {
  const ahora = new Date("2026-08-13T14:20:00.000Z");

  it("sin cursor barre la ventana máxima de 7 días (primera corrida de la conexión)", () => {
    const v = calcularVentanaFaseA(null, ahora);
    expect(v.recortada).toBe(true);
    expect((v.hasta.getTime() - v.desde.getTime()) / 86_400_000).toBeCloseTo(7, 5);
  });

  it("con cursor retrocede una hora y la trunca al inicio de la hora", () => {
    // ML redondea los filtros de fecha a la hora; el solapamiento se hace
    // explícito para que nuestro límite coincida con el suyo.
    const v = calcularVentanaFaseA(new Date("2026-08-13T13:47:00.000Z"), ahora);
    expect(v.recortada).toBe(false);
    expect(v.desde.toISOString()).toBe("2026-08-13T12:00:00.000Z");
    expect(v.hasta).toEqual(ahora);
  });

  it("el solapamiento configurado es de una hora", () => {
    expect(SOLAPAMIENTO_MS).toBe(60 * 60 * 1000);
  });

  it("un cursor prehistórico se recorta a 7 días (una corrida no barre un año)", () => {
    const v = calcularVentanaFaseA(new Date("2025-01-01T00:00:00.000Z"), ahora);
    expect(v.recortada).toBe(true);
    expect((v.hasta.getTime() - v.desde.getTime()) / 86_400_000).toBeCloseTo(7, 5);
  });

  it("un cursor corrupto se trata como ausente en vez de reventar", () => {
    const v = calcularVentanaFaseA(new Date("no-es-fecha"), ahora);
    expect(v.recortada).toBe(true);
  });
});

// =============================================================================
// C · Fase A — órdenes nuevas
// =============================================================================

describe("fase A — órdenes nuevas", () => {
  it("ingiere el pedido Flex nuevo y avanza el cursor de esa conexión", async () => {
    const { cliente, registro } = crearSupabaseFalso();
    stubMl(
      [
        {
          results: [
            { id: 2000001, shipping: { id: 111 }, date_created: "2026-08-13T10:00:00.000Z" },
          ],
          total: 1,
        },
      ],
      { "111": shipmentFlex() },
    );

    const resumen = await sincronizarConexionMl(CONEXION, {
      supabase: comoSupabase(cliente),
      logger: crearLogger(),
      ahora: new Date("2026-08-13T14:20:00.000Z"),
    });

    expect(resumen.insertados).toBe(1);
    expect(registro.pedidoInsert[0].ml_shipment_id).toBe("111");
    expect(registro.pedidoInsert[0].origen).toBe("ml_ingesta");
    expect(registro.conexionUpdate[0][COLUMNA_CURSOR]).toBe("2026-08-13T14:20:00.000Z");
    expect(resumen.cursorAvanzadoA).toBe("2026-08-13T14:20:00.000Z");
  });

  it("NO vuelve a pedir el envío de una orden que ya tenemos", async () => {
    // El backfill pedía el detalle de las 110 órdenes de la ventana y usaba 39.
    // Repetir ese patrón cada 30 min multiplicaría el gasto por nada.
    const { cliente } = crearSupabaseFalso({ shipmentsConocidos: ["111"] });
    const fetchMock = stubMl(
      [
        {
          results: [
            { id: 1, shipping: { id: 111 }, date_created: "2026-08-13T10:00:00.000Z" },
            { id: 2, shipping: { id: 222 }, date_created: "2026-08-13T10:05:00.000Z" },
          ],
          total: 2,
        },
      ],
      { "111": shipmentFlex(), "222": shipmentFlex({ id: 222 }) },
    );

    const resumen = await sincronizarConexionMl(CONEXION, {
      supabase: comoSupabase(cliente),
      logger: crearLogger(),
      ahora: new Date("2026-08-13T14:20:00.000Z"),
    });

    const urlsEnvios = fetchMock.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.includes("/shipments/"));
    expect(urlsEnvios).toEqual(["https://api.mercadolibre.com/shipments/222"]);
    expect(resumen.ordenesYaConocidas).toBe(1);
    expect(resumen.insertados).toBe(1);
  });

  it("una orden sin envío creado (`shipping.id` null) se cuenta y no es error", async () => {
    const { cliente } = crearSupabaseFalso();
    stubMl([{ results: [{ id: 1, shipping: { id: null } }], total: 1 }], {});

    const resumen = await sincronizarConexionMl(CONEXION, {
      supabase: comoSupabase(cliente),
      logger: crearLogger(),
    });

    expect(resumen.ordenesSinEnvio).toBe(1);
    expect(resumen.insertados).toBe(0);
  });

  it("NO le manda `x-format-new` a /orders/search, y sí a cada shipment", async () => {
    const { cliente } = crearSupabaseFalso();
    const fetchMock = stubMl(
      [{ results: [{ id: 1, shipping: { id: 111 } }], total: 1 }],
      { "111": shipmentFlex() },
    );

    await sincronizarConexionMl(CONEXION, {
      supabase: comoSupabase(cliente),
      logger: crearLogger(),
    });

    const [urlOrdenes, initOrdenes] = fetchMock.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string> },
    ];
    expect(urlOrdenes).toContain("/orders/search");
    expect(initOrdenes.headers["x-format-new"]).toBeUndefined();

    const envio = fetchMock.mock.calls.find((c) => String(c[0]).includes("/shipments/"))!;
    const initEnvio = (envio as unknown as [string, { headers: Record<string, string> }])[1];
    expect(initEnvio.headers["x-format-new"]).toBe("true");
  });

  it("una conexión desvinculada se omite sin llamar a ML", async () => {
    const { cliente } = crearSupabaseFalso();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const resumen = await sincronizarConexionMl(
      { ...CONEXION, estadoSalud: "desvinculada" },
      { supabase: comoSupabase(cliente), logger: crearLogger() },
    );

    expect(resumen.omitida).toBe("desvinculada");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// =============================================================================
// D · Fase B — repaso de estados
// =============================================================================

describe("fase B — repaso de estados", () => {
  const pedidoVivo = {
    id: "pedido-1",
    ml_shipment_id: "111",
    estado: "asignado",
    estado_ml: "ready_to_ship",
    ultima_sync_ml_en: null,
  };

  it("detecta la cancelación y AVISA: no mueve el estado ni escribe estado_ml", async () => {
    const { cliente, registro } = crearSupabaseFalso({ pedidosRepaso: [pedidoVivo] });
    stubMl([{ results: [], total: 0 }], {
      "111": shipmentFlex({ status: "cancelled", substatus: "buyer_cancelled" }),
    });

    const resumen = await sincronizarConexionMl(CONEXION, {
      supabase: comoSupabase(cliente),
      logger: crearLogger(),
    });

    expect(resumen.cancelacionesDetectadas).toBe(1);
    expect(inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "operacion/pedido.cancelado-en-ml",
        id: "pedido-cancelado-ml-pedido-1",
        data: expect.objectContaining({
          pedidoId: "pedido-1",
          mlShipmentId: "111",
          estadoAnterior: "asignado",
          substatusMl: "buyer_cancelled",
        }),
      }),
    );
    // Ni un UPDATE sobre el pedido: aplicar la cancelación es del consumidor.
    expect(registro.pedidoUpdate).toHaveLength(0);
  });

  it("un 404 NO se interpreta como cancelación: se registra y el estado queda intacto", async () => {
    // La doc de ML no dice qué devuelve para un envío cancelado. Adivinarlo
    // significaría cancelar pedidos vivos ante un error transitorio.
    const { cliente, registro } = crearSupabaseFalso({ pedidosRepaso: [pedidoVivo] });
    stubMl([{ results: [], total: 0 }], {}); // el shipment 111 devuelve 404

    const logger = crearLogger();
    const resumen = await sincronizarConexionMl(CONEXION, {
      supabase: comoSupabase(cliente),
      logger,
    });

    expect(resumen.noEncontrados).toEqual(["111"]);
    expect(resumen.cancelacionesDetectadas).toBe(0);
    expect(registro.pedidoUpdate).toHaveLength(0);
    const nombresEventos = vi
      .mocked(inngest.send)
      .mock.calls.map((c) => (c[0] as { name: string }).name);
    expect(nombresEventos).not.toContain("operacion/pedido.cancelado-en-ml");
  });

  it("un cambio de estado que NO es cancelación se delega al Job 3 (dueño de la máquina)", async () => {
    const { cliente, registro } = crearSupabaseFalso({ pedidosRepaso: [pedidoVivo] });
    stubMl([{ results: [], total: 0 }], { "111": shipmentFlex({ status: "shipped" }) });

    const resumen = await sincronizarConexionMl(CONEXION, {
      supabase: comoSupabase(cliente),
      logger: crearLogger(),
    });

    expect(resumen.transicionesPublicadas).toBe(1);
    expect(inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "ml/shipment.actualizado",
        data: expect.objectContaining({ shipmentId: "111", userId: "ml-user-99" }),
      }),
    );
    // No se escribe `estado_ml` aquí: si se escribiera sin haber aplicado la
    // transición, el polling de 15 min dejaría de ver diferencia.
    expect(registro.pedidoUpdate).toHaveLength(0);
  });

  it("sin novedad se marca la sincronización (y nada más)", async () => {
    const { cliente, registro } = crearSupabaseFalso({ pedidosRepaso: [pedidoVivo] });
    stubMl([{ results: [], total: 0 }], { "111": shipmentFlex({ status: "ready_to_ship" }) });

    const resumen = await sincronizarConexionMl(CONEXION, {
      supabase: comoSupabase(cliente),
      logger: crearLogger(),
    });

    expect(resumen.repasados).toBe(1);
    expect(resumen.transicionesPublicadas).toBe(0);
    expect(registro.pedidoUpdate).toEqual([
      { ultima_sync_ml_en: expect.any(String) },
    ]);
  });

  // ===========================================================================
  // El cuarto agujero (bug de facturación Flex, ago-2026): un pedido histórico
  // con `estado_ml` YA correcto (no cambia en este ciclo) pero `estado` interno
  // congelado en 'pendiente_asignacion' — antes el repaso no veía diferencia
  // (`estado_ml === estado_ml`) y nunca disparaba la corrección.
  // ===========================================================================

  it("detecta la INCOHERENCIA histórica (estado_ml correcto, estado interno congelado) y dispara igual, aunque estado_ml no haya cambiado", async () => {
    const pedidoHistoricoIncoherente = {
      id: "pedido-2",
      ml_shipment_id: "111",
      // `estado` NUNCA se tradujo al ingestar (bug ya cerrado) — se quedó en
      // el default de la ingesta pese a que `estado_ml` ya decía 'delivered'.
      estado: "pendiente_asignacion",
      estado_ml: "delivered",
      ultima_sync_ml_en: null,
    };
    const { cliente, registro } = crearSupabaseFalso({ pedidosRepaso: [pedidoHistoricoIncoherente] });
    // ML reporta EXACTAMENTE lo mismo que ya teníamos guardado — sin esto el
    // chequeo viejo (`datos.estadoMl !== pedido.estado_ml`) jamás dispararía.
    stubMl([{ results: [], total: 0 }], { "111": shipmentFlex({ status: "delivered" }) });

    const resumen = await sincronizarConexionMl(CONEXION, {
      supabase: comoSupabase(cliente),
      logger: crearLogger(),
    });

    expect(resumen.transicionesPublicadas).toBe(1);
    expect(inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "ml/shipment.actualizado",
        data: expect.objectContaining({ shipmentId: "111", userId: "ml-user-99" }),
      }),
    );
    // Mismo invariante que el cambio "normal": no se escribe `estado_ml` aquí
    // — lo aplica el Job 3, dueño de la máquina de estados.
    expect(registro.pedidoUpdate).toHaveLength(0);
  });

  it("NO marca como incoherente un pedido 'ready_to_ship' que sigue sin traducción (nada que corregir)", async () => {
    const pedidoPendienteLegitimo = {
      id: "pedido-3",
      ml_shipment_id: "111",
      estado: "pendiente_asignacion",
      estado_ml: "ready_to_ship",
      ultima_sync_ml_en: null,
    };
    const { cliente, registro } = crearSupabaseFalso({ pedidosRepaso: [pedidoPendienteLegitimo] });
    stubMl([{ results: [], total: 0 }], { "111": shipmentFlex({ status: "ready_to_ship" }) });

    const resumen = await sincronizarConexionMl(CONEXION, {
      supabase: comoSupabase(cliente),
      logger: crearLogger(),
    });

    expect(resumen.transicionesPublicadas).toBe(0);
    expect(registro.pedidoUpdate).toEqual([{ ultima_sync_ml_en: expect.any(String) }]);
  });

  it("NO marca como incoherente un pedido 'fallido_manual' (corrección humana deliberada) aunque nunca vaya a traducir igual a un estado de ML", async () => {
    // Guarda de falso positivo: 'fallido_manual' es un estado propio de Rutax
    // que la API de ML JAMÁS produce — sin este acotamiento (a
    // 'pendiente_asignacion') el repaso lo marcaría "incoherente" en cada
    // ciclo, para siempre, gastando una llamada a ML por nada.
    const pedidoCorreccionManual = {
      id: "pedido-4",
      ml_shipment_id: "111",
      estado: "fallido_manual",
      estado_ml: "not_delivered",
      ultima_sync_ml_en: null,
    };
    const { cliente, registro } = crearSupabaseFalso({ pedidosRepaso: [pedidoCorreccionManual] });
    stubMl([{ results: [], total: 0 }], {
      "111": shipmentFlex({ status: "not_delivered", substatus: "receiver_absent" }),
    });

    const resumen = await sincronizarConexionMl(CONEXION, {
      supabase: comoSupabase(cliente),
      logger: crearLogger(),
    });

    expect(resumen.transicionesPublicadas).toBe(0);
    expect(registro.pedidoUpdate).toEqual([{ ultima_sync_ml_en: expect.any(String) }]);
  });

  it("no vuelve a preguntar por un envío consultado hace menos de la ventana de frescura", async () => {
    const ahora = new Date("2026-08-13T14:20:00.000Z");
    const hace10min = new Date(ahora.getTime() - 10 * 60 * 1000).toISOString();
    const { cliente } = crearSupabaseFalso({
      pedidosRepaso: [{ ...pedidoVivo, ultima_sync_ml_en: hace10min }],
    });
    const fetchMock = stubMl([{ results: [], total: 0 }], { "111": shipmentFlex() });

    const resumen = await sincronizarConexionMl(CONEXION, {
      supabase: comoSupabase(cliente),
      logger: crearLogger(),
      ahora,
    });

    expect(FRESCURA_MINUTOS).toBe(25);
    expect(resumen.repasados).toBe(0);
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("/shipments/"))).toHaveLength(
      0,
    );
  });

  it("no vuelve a pedir en la fase B un envío que la fase A acaba de traer", async () => {
    const { cliente } = crearSupabaseFalso({
      // El pedido que la fase B leería es justamente el que la A acaba de crear.
      pedidosRepaso: [{ ...pedidoVivo, ml_shipment_id: "222" }],
    });
    const fetchMock = stubMl(
      [{ results: [{ id: 1, shipping: { id: 222 } }], total: 1 }],
      { "222": shipmentFlex({ id: 222 }) },
    );

    const resumen = await sincronizarConexionMl(CONEXION, {
      supabase: comoSupabase(cliente),
      logger: crearLogger(),
    });

    const llamadasAlEnvio = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("/shipments/222"),
    );
    expect(llamadasAlEnvio).toHaveLength(1);
    expect(resumen.insertados).toBe(1);
    expect(resumen.repasados).toBe(0);
  });

  it("un `ml_user_id` no numérico NO se interpola en el filtro `or` de PostgREST", async () => {
    // `.or()` recibe un string que PostgREST parsea: ahí no hay parámetro
    // ligado. Con una cuenta de forma rara se cae al `.eq()` parametrizado.
    const { cliente } = crearSupabaseFalso({ pedidosRepaso: [] });
    const capturado: string[] = [];
    const clienteEspia = {
      ...cliente,
      schema: vi.fn((s: string) => {
        const real = cliente.schema(s);
        return {
          from: vi.fn((t: string) => {
            const cadena = real.from(t);
            const orOriginal = cadena.or;
            cadena.or = vi.fn((expr: string) => {
              capturado.push(expr);
              return orOriginal(expr);
            });
            return cadena;
          }),
        };
      }),
    };
    stubMl([{ results: [], total: 0 }], {});

    await sincronizarConexionMl(
      { ...CONEXION, mlUserId: "1,ml_user_id.is.null),(x" },
      { supabase: comoSupabase(clienteEspia), logger: crearLogger() },
    );

    expect(capturado).toEqual([]);
  });

  it("sí lo repasa cuando la última consulta ya quedó rancia", async () => {
    const ahora = new Date("2026-08-13T14:20:00.000Z");
    const hace40min = new Date(ahora.getTime() - 40 * 60 * 1000).toISOString();
    const { cliente } = crearSupabaseFalso({
      pedidosRepaso: [{ ...pedidoVivo, ultima_sync_ml_en: hace40min }],
    });
    stubMl([{ results: [], total: 0 }], { "111": shipmentFlex() });

    const resumen = await sincronizarConexionMl(CONEXION, {
      supabase: comoSupabase(cliente),
      logger: crearLogger(),
      ahora,
    });

    expect(resumen.repasados).toBe(1);
  });
});

// =============================================================================
// E · Degradación sin la migración del cursor
// =============================================================================

describe("leerConexionesParaIngesta", () => {
  const filaConexion = {
    id: "conn-1",
    tenant_id: "tenant-1",
    seller_id: "seller-1",
    ml_user_id: "ml-user-99",
    access_token_ref: "ref-token",
    estado_salud: "sana",
    [COLUMNA_CURSOR]: "2026-08-13T13:00:00.000Z",
  };

  it("lee el cursor cuando la columna existe", async () => {
    const { cliente } = crearSupabaseFalso({ conexiones: [filaConexion] });
    const { conexiones, cursorDisponible } = await leerConexionesParaIngesta(
      comoSupabase(cliente),
      crearLogger(),
    );

    expect(cursorDisponible).toBe(true);
    expect(conexiones[0].cursorEn).toBe("2026-08-13T13:00:00.000Z");
  });

  it("si la migración no está aplicada, avisa y sigue funcionando sin cursor", async () => {
    // El código se despliega antes que la migración con más frecuencia de la
    // que a nadie le gustaría. Que el cron entero muera cada 30 min por eso
    // sería peor que barrer 7 días.
    const { cliente } = crearSupabaseFalso({
      conexiones: [filaConexion],
      sinColumnaCursor: true,
    });
    const logger = crearLogger();

    const { conexiones, cursorDisponible } = await leerConexionesParaIngesta(
      comoSupabase(cliente),
      logger,
    );

    expect(cursorDisponible).toBe(false);
    expect(conexiones[0].cursorEn).toBeNull();
    expect(logger.warn.mock.calls.flat().join(" ")).toContain("20260813000001");
  });

  it("marca UNA sola conexión por seller como representativa (pedidos legacy sin cuenta)", async () => {
    const { cliente } = crearSupabaseFalso({
      conexiones: [
        { ...filaConexion, id: "conn-b", ml_user_id: "ml-2" },
        { ...filaConexion, id: "conn-a", ml_user_id: "ml-1" },
      ],
    });
    const { conexiones } = await leerConexionesParaIngesta(comoSupabase(cliente), crearLogger());

    expect(conexiones.filter((c) => c.esRepresentativaDelSeller)).toHaveLength(1);
    expect(conexiones.find((c) => c.esRepresentativaDelSeller)?.id).toBe("conn-a");
  });
});

// =============================================================================
// F · Seguridad y visibilidad
// =============================================================================

describe("ingesta continua — seguridad y visibilidad", () => {
  it("ni el token ni los datos del destinatario salen en el resumen ni en los logs", async () => {
    const { cliente } = crearSupabaseFalso({
      pedidosRepaso: [
        {
          id: "pedido-1",
          ml_shipment_id: "111",
          estado: "asignado",
          estado_ml: "ready_to_ship",
          ultima_sync_ml_en: null,
        },
      ],
    });
    stubMl(
      [{ results: [{ id: 1, shipping: { id: 222 } }], total: 1 }],
      { "111": shipmentFlex(), "222": shipmentFlex({ id: 222 }) },
    );

    const logger = crearLogger();
    const resumen = await sincronizarConexionMl(CONEXION, {
      supabase: comoSupabase(cliente),
      logger,
    });

    const todo = [
      JSON.stringify(resumen),
      ...logger.info.mock.calls.flat(),
      ...logger.warn.mock.calls.flat(),
      ...logger.error.mock.calls.flat(),
    ].join("\n");

    expect(todo).not.toContain(TOKEN_FIXTURE);
    expect(todo).not.toContain("Bearer");
    expect(todo).not.toContain(NOMBRE_FIXTURE);
    expect(todo).not.toContain(CALLE_FIXTURE);
    expect(todo).not.toContain("Las Condes");
  });

  it("el cron deja los 404 a la vista: log, observabilidad y resumen del run", async () => {
    const { cliente } = crearSupabaseFalso({
      conexiones: [
        {
          id: "conn-1",
          tenant_id: "tenant-1",
          seller_id: "seller-1",
          ml_user_id: "ml-user-99",
          access_token_ref: "ref-token",
          estado_salud: "sana",
          [COLUMNA_CURSOR]: null,
        },
      ],
      pedidosRepaso: [
        {
          id: "pedido-1",
          ml_shipment_id: "111",
          estado: "asignado",
          estado_ml: "ready_to_ship",
          ultima_sync_ml_en: null,
        },
      ],
    });
    const { crearClienteServiceRole } = await import("@/lib/supabase/service-role");
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      comoSupabase(cliente) as ReturnType<typeof crearClienteServiceRole>,
    );
    stubMl([{ results: [], total: 0 }], {}); // shipment 111 → 404

    const logger = crearLogger();
    const handler = (
      jobIngestaPedidosMl as unknown as {
        handler: (ctx: {
          step: { run: <T>(l: string, fn: () => Promise<T>) => Promise<T> };
          logger: ReturnType<typeof crearLogger>;
        }) => Promise<Record<string, unknown>>;
      }
    ).handler;

    const resultado = await handler({
      step: { run: <T,>(_l: string, fn: () => Promise<T>) => fn() },
      logger,
    });

    expect(resultado.totalNoEncontrados).toBe(1);
    expect(resultado.noEncontrados).toEqual(["111"]);
    expect(logger.error.mock.calls.flat().join(" ")).toContain("404");
    expect(capturarMensaje).toHaveBeenCalledWith(
      expect.stringContaining("404"),
      "warning",
      expect.objectContaining({ origen: "job:ml/ingestaPedidos" }),
    );
  });
});
