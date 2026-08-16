/**
 * Pruebas del cron de ingesta Shopify (`shopify/ingestaPedidos`) y de la
 * sincronización manual.
 *
 * REGLA DEL ARCHIVO: se ejerce el CÓDIGO REAL — la rutina por conexión completa,
 * con un doble de Supabase y el cliente HTTP doblado en su frontera
 * (`peticionShopify`). Nada de espejos de la lógica bajo prueba.
 *
 * Cobertura:
 *  A. Forma del cron (expresión + zona horaria explícita) y cadencia.
 *  B. Ventana incremental: sin cursor, con cursor, y con un cursor prehistórico.
 *  C. El cursor avanza cuando la fase A termina…
 *  D. …y NO avanza si la fase A lanzó. Es la prueba que impide perder pedidos en
 *     silencio (lección de 20260813000001).
 *  E. Fase B: `cancelledAt` → evento publicado, SIN tocar el estado del pedido.
 *  F. Fase B: una orden que la tienda no devuelve NO se interpreta como cancelada.
 *  G. El botón manual corre EXACTAMENTE la misma rutina que el cron.
 *  H. Seguridad: ni token ni PII en el resumen del run ni en los logs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/inngest/cliente", () => ({
  inngest: {
    createFunction: vi.fn((config: unknown, handler: unknown) => ({ config, handler })),
    send: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock("@/lib/observabilidad", () => ({
  capturarMensaje: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../puerto", () => ({
  obtenerAccessToken: vi.fn(),
  marcarSalud: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../cliente-http", () => ({
  peticionShopify: vi.fn(),
}));

vi.mock("@/modules/operacion/zonas", () => ({
  resolverZona: vi.fn(),
}));

vi.mock("@/modules/operacion/tarifas", () => ({
  resolverTarifaVigente: vi.fn(),
}));

vi.mock("@/modules/operacion/ventanas-corte", () => ({
  evaluarVentanaCorte: vi.fn(),
}));

import { inngest } from "@/lib/inngest/cliente";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { marcarSalud, obtenerAccessToken } from "../puerto";
import { peticionShopify } from "../cliente-http";
import { resolverZona } from "@/modules/operacion/zonas";
import { resolverTarifaVigente } from "@/modules/operacion/tarifas";
import { evaluarVentanaCorte } from "@/modules/operacion/ventanas-corte";
import {
  calcularVentanaFaseA,
  COLUMNA_CURSOR,
  CRON_INGESTA_SHOPIFY,
  ESTADOS_NO_TERMINALES,
  jobIngestaPedidosShopify,
  jobSincronizarConexionShopify,
  leerConexionesParaIngesta,
  sincronizarConexionShopify,
  SOLAPAMIENTO_MS,
  VENTANA_MAXIMA_DIAS,
  type ConexionShopifyIngesta,
} from "./ingesta-pedidos-shopify";

const TOKEN_FIXTURE = "shpat-token-secretisimo-de-prueba";
const NOMBRE_FIXTURE = "María Fernanda Rojas";
const TELEFONO_FIXTURE = "+56911112222";
const CALLE_FIXTURE = "Avenida Apoquindo 4501";

const CONEXION: ConexionShopifyIngesta = {
  id: "conexion-1",
  tenantId: "tenant-1",
  sellerId: "seller-1",
  shopDomain: "mi-tienda.myshopify.com",
  filtroEtiqueta: null,
  estadoSalud: "sana",
  cursorEn: null,
};

const AHORA = new Date("2026-08-16T14:00:00.000Z");

function ordenShopify(overrides: Record<string, unknown> = {}) {
  return {
    id: "gid://shopify/Order/5001",
    name: "#1001",
    createdAt: "2026-08-16T12:00:00.000Z",
    cancelledAt: null,
    displayFulfillmentStatus: "UNFULFILLED",
    tags: [],
    note: null,
    phone: null,
    shippingAddress: {
      name: NOMBRE_FIXTURE,
      address1: CALLE_FIXTURE,
      address2: null,
      city: "Las Condes",
      province: "Región Metropolitana",
      phone: TELEFONO_FIXTURE,
      latitude: null,
      longitude: null,
    },
    ...overrides,
  };
}

// -----------------------------------------------------------------------------
// Doble de Supabase
// -----------------------------------------------------------------------------

interface ConfigDoble {
  conexiones?: Array<Record<string, unknown>>;
  /** Filas de `operacion.pedidos` que devuelve el repaso (fase B). */
  pedidosRepaso?: Array<Record<string, unknown>>;
  errorUpdateConexion?: { message: string } | null;
}

function crearSupabaseFalso(config: ConfigDoble = {}) {
  const registro = {
    insertPedidos: [] as Record<string, unknown>[],
    updatePedidos: [] as Record<string, unknown>[],
    updateConexiones: [] as Record<string, unknown>[],
  };
  let contadorInsert = 0;

  /* eslint-disable @typescript-eslint/no-explicit-any */
  function builder(tabla: string) {
    const cadena: any = {};
    cadena.select = vi.fn(() => cadena);
    cadena.eq = vi.fn(() => cadena);
    cadena.neq = vi.fn(() => cadena);
    cadena.not = vi.fn(() => cadena);
    cadena.in = vi.fn(() => cadena);
    cadena.gte = vi.fn(() => cadena);
    cadena.order = vi.fn(() => cadena);
    cadena.limit = vi.fn(() => cadena);

    // Awaitable: lo usan la lectura de conexiones y el repaso de la fase B.
    cadena.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
      const data =
        tabla === "conexiones_seller_shopify"
          ? (config.conexiones ?? [])
          : (config.pedidosRepaso ?? []);
      return Promise.resolve({ data, error: null }).then(res, rej);
    };

    // El alta busca por `(tenant, fuente, id_externo)`: en estas pruebas nunca
    // existe todavía, así que siempre INSERT.
    cadena.maybeSingle = vi.fn(async () => ({ data: null, error: null }));

    cadena.insert = vi.fn((valores: Record<string, unknown>) => {
      registro.insertPedidos.push(valores);
      contadorInsert += 1;
      const id = `pedido-${contadorInsert}`;
      const c: any = {};
      c.select = vi.fn(() => c);
      c.maybeSingle = vi.fn(async () => ({ data: { id }, error: null }));
      return c;
    });

    cadena.update = vi.fn((valores: Record<string, unknown>) => {
      if (tabla === "conexiones_seller_shopify") registro.updateConexiones.push(valores);
      else registro.updatePedidos.push(valores);
      const u: any = {};
      u.eq = vi.fn(() => u);
      u.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve({
          error: tabla === "conexiones_seller_shopify" ? (config.errorUpdateConexion ?? null) : null,
        }).then(res, rej);
      return u;
    });

    return cadena;
  }

  const cliente: any = {
    schema: vi.fn(() => ({ from: vi.fn((t: string) => builder(t)) })),
    from: vi.fn((t: string) => builder(t)),
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return { cliente, registro };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const comoSupabase = (c: unknown) => c as any;

function logger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** `step.run` de mentira: ejecuta el callback en el momento. */
const step = { run: async (_nombre: string, fn: () => unknown) => fn() } as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Respuesta de la fase A con las órdenes dadas y sin más páginas. */
function paginaOrdenes(nodes: unknown[]) {
  return { orders: { nodes, pageInfo: { hasNextPage: false, endCursor: null } } };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(obtenerAccessToken).mockResolvedValue(TOKEN_FIXTURE);
  vi.mocked(resolverZona).mockResolvedValue("zona-1");
  vi.mocked(resolverTarifaVigente).mockResolvedValue("tarifa-1");
  vi.mocked(evaluarVentanaCorte).mockResolvedValue({
    ventana: null,
    fechaCompromisoHora: null,
    corteRiesgo: false,
    horaEvaluada: "10:00",
  });
});

// =============================================================================
// A. Forma del cron
// =============================================================================

describe("cron", () => {
  it("corre cada 15 min entre 06:00 y 22:45, en hora de Santiago", () => {
    // La TZ explícita NO es cosmética: Chile cambia de horario dos veces al año
    // y un cron en UTC correría una hora corrida medio año.
    expect(CRON_INGESTA_SHOPIFY).toBe("TZ=America/Santiago */15 6-22 * * *");
  });

  it("el job del cron y el manual están registrados con id propio", () => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    expect((jobIngestaPedidosShopify as any).config.id).toBe("shopify/ingestaPedidos");
    expect((jobIngestaPedidosShopify as any).config.concurrency).toEqual({ limit: 1 });
    expect((jobSincronizarConexionShopify as any).config.id).toBe("shopify/sincronizarConexion");
    expect((jobSincronizarConexionShopify as any).config.triggers).toEqual([
      { event: "shopify/sincronizacion.solicitada" },
    ]);
    /* eslint-enable @typescript-eslint/no-explicit-any */
  });

  it("el repaso solo mira estados no terminales", () => {
    expect([...ESTADOS_NO_TERMINALES].sort()).toEqual(
      ["asignado", "en_ruta", "fallido", "fallido_manual", "pendiente_asignacion"].sort(),
    );
  });
});

// =============================================================================
// B. Ventana incremental
// =============================================================================

describe("calcularVentanaFaseA", () => {
  it("sin cursor barre la ventana máxima", () => {
    const v = calcularVentanaFaseA(null, AHORA);
    expect(v.recortada).toBe(true);
    expect(AHORA.getTime() - v.desde.getTime()).toBe(VENTANA_MAXIMA_DIAS * 24 * 60 * 60 * 1000);
  });

  it("con cursor retrocede exactamente el solapamiento", () => {
    const cursor = new Date("2026-08-16T13:30:00.000Z");
    const v = calcularVentanaFaseA(cursor, AHORA);
    expect(v.recortada).toBe(false);
    expect(v.desde.toISOString()).toBe(
      new Date(cursor.getTime() - SOLAPAMIENTO_MS).toISOString(),
    );
    expect(v.hasta).toBe(AHORA);
  });

  it("un cursor prehistórico se recorta al tope de 7 días", () => {
    // Un sistema caído una semana no puede convertir una corrida en un barrido
    // ilimitado — y además `read_orders` solo alcanza 60 días.
    const v = calcularVentanaFaseA(new Date("2020-01-01T00:00:00.000Z"), AHORA);
    expect(v.recortada).toBe(true);
    expect(AHORA.getTime() - v.desde.getTime()).toBe(VENTANA_MAXIMA_DIAS * 24 * 60 * 60 * 1000);
  });
});

// =============================================================================
// C / D. El cursor
// =============================================================================

describe("cursor de ingesta", () => {
  it("avanza a `ventana.hasta` cuando la fase A termina", async () => {
    const { cliente, registro } = crearSupabaseFalso();
    vi.mocked(peticionShopify)
      .mockResolvedValueOnce(paginaOrdenes([ordenShopify()]))
      // Fase B: no hay pedidos que repasar (el doble devuelve lista vacía).
      .mockResolvedValue({ nodes: [] });

    const resumen = await sincronizarConexionShopify(CONEXION, {
      ahora: AHORA,
      supabase: comoSupabase(cliente),
      logger: logger(),
    });

    expect(resumen.ingesta.totalInsertados).toBe(1);
    expect(resumen.cursorAvanzadoA).toBe(AHORA.toISOString());
    expect(registro.updateConexiones).toHaveLength(1);
    // Y va a SU columna, no a la marca de salud que ve el seller.
    expect(Object.keys(registro.updateConexiones[0])).toEqual([COLUMNA_CURSOR]);
    expect(registro.updateConexiones[0][COLUMNA_CURSOR]).toBe(AHORA.toISOString());
    expect(marcarSalud).toHaveBeenCalledWith("conexion-1", "tenant-1", { ok: true });
  });

  it("NO avanza si la fase A lanzó — y la conexión queda marcada en atención", async () => {
    // La prueba que impide perder pedidos en silencio: si el cursor avanzara
    // pese al fallo, esas órdenes quedarían fuera de toda ventana futura.
    const { cliente, registro } = crearSupabaseFalso();
    vi.mocked(peticionShopify).mockRejectedValue(new Error("Shopify respondió 503"));
    const log = logger();

    const resumen = await sincronizarConexionShopify(CONEXION, {
      ahora: AHORA,
      supabase: comoSupabase(cliente),
      logger: log,
    });

    expect(resumen.cursorAvanzadoA).toBeNull();
    expect(registro.updateConexiones).toHaveLength(0);
    expect(resumen.error).toContain("503");
    expect(marcarSalud).toHaveBeenCalledWith(
      "conexion-1",
      "tenant-1",
      expect.objectContaining({ ok: false }),
    );
  });

  it("tampoco avanza cuando el token no se puede descifrar (y no llama a Shopify)", async () => {
    const { cliente, registro } = crearSupabaseFalso();
    vi.mocked(obtenerAccessToken).mockRejectedValue(new Error("clave maestra rotada"));

    const resumen = await sincronizarConexionShopify(CONEXION, {
      ahora: AHORA,
      supabase: comoSupabase(cliente),
      logger: logger(),
    });

    expect(resumen.omitida).toBe("token_ilegible");
    expect(registro.updateConexiones).toHaveLength(0);
    expect(peticionShopify).not.toHaveBeenCalled();
  });

  it("una conexión desvinculada se omite sin tocar nada", async () => {
    const { cliente, registro } = crearSupabaseFalso();

    const resumen = await sincronizarConexionShopify(
      { ...CONEXION, estadoSalud: "desvinculada" },
      { ahora: AHORA, supabase: comoSupabase(cliente), logger: logger() },
    );

    expect(resumen.omitida).toBe("desvinculada");
    expect(obtenerAccessToken).not.toHaveBeenCalled();
    expect(peticionShopify).not.toHaveBeenCalled();
    expect(registro.updateConexiones).toHaveLength(0);
  });
});

// =============================================================================
// E / F. Fase B — cancelaciones
// =============================================================================

describe("fase B — repaso de cancelaciones", () => {
  const PEDIDO_VIVO = {
    id: "pedido-vivo",
    id_externo: "gid://shopify/Order/7777",
    referencia_externa: "#7777",
    estado: "asignado",
  };

  it("detecta la cancelación y PUBLICA, sin tocar el estado del pedido", async () => {
    const { cliente, registro } = crearSupabaseFalso({ pedidosRepaso: [PEDIDO_VIVO] });
    vi.mocked(peticionShopify)
      .mockResolvedValueOnce(paginaOrdenes([]))
      .mockResolvedValueOnce({
        nodes: [
          {
            id: "gid://shopify/Order/7777",
            name: "#7777",
            cancelledAt: "2026-08-16T13:00:00.000Z",
            displayFulfillmentStatus: "UNFULFILLED",
          },
        ],
      });

    const resumen = await sincronizarConexionShopify(CONEXION, {
      ahora: AHORA,
      supabase: comoSupabase(cliente),
      logger: logger(),
    });

    expect(resumen.repasados).toBe(1);
    expect(resumen.cancelacionesDetectadas).toBe(1);

    const evento = vi.mocked(inngest.send).mock.calls.at(-1)?.[0] as {
      name: string;
      id?: string;
      data: Record<string, unknown>;
    };
    expect(evento.name).toBe("operacion/pedido.cancelado-en-fuente");
    // Idempotencia: un pedido se cancela una vez, lo descubran uno o dos barridos.
    expect(evento.id).toBe("pedido-cancelado-fuente-pedido-vivo");
    expect(evento.data).toMatchObject({
      pedidoId: "pedido-vivo",
      tenantId: "tenant-1",
      fuente: "shopify",
      idExterno: "gid://shopify/Order/7777",
      estadoAnterior: "asignado",
      canceladoEnFuenteEn: "2026-08-16T13:00:00.000Z",
    });

    // `integraciones` DETECTA y AVISA: no mueve el estado del pedido.
    expect(registro.updatePedidos).toHaveLength(0);
  });

  it("una orden que la tienda NO devuelve no se interpreta como cancelada", async () => {
    // Mismo criterio que el 404 de ML: la ausencia tiene la misma forma que un
    // error transitorio o un permiso revocado. Adivinar cancelaría pedidos vivos.
    const { cliente, registro } = crearSupabaseFalso({ pedidosRepaso: [PEDIDO_VIVO] });
    vi.mocked(peticionShopify)
      .mockResolvedValueOnce(paginaOrdenes([]))
      .mockResolvedValueOnce({ nodes: [] });

    const resumen = await sincronizarConexionShopify(CONEXION, {
      ahora: AHORA,
      supabase: comoSupabase(cliente),
      logger: logger(),
    });

    expect(resumen.noEncontrados).toEqual(["gid://shopify/Order/7777"]);
    expect(resumen.cancelacionesDetectadas).toBe(0);
    expect(registro.updatePedidos).toHaveLength(0);
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it("una orden viva no dispara nada", async () => {
    const { cliente } = crearSupabaseFalso({ pedidosRepaso: [PEDIDO_VIVO] });
    vi.mocked(peticionShopify)
      .mockResolvedValueOnce(paginaOrdenes([]))
      .mockResolvedValueOnce({
        nodes: [{ id: "gid://shopify/Order/7777", name: "#7777", cancelledAt: null }],
      });

    const resumen = await sincronizarConexionShopify(CONEXION, {
      ahora: AHORA,
      supabase: comoSupabase(cliente),
      logger: logger(),
    });

    expect(resumen.repasados).toBe(1);
    expect(resumen.cancelacionesDetectadas).toBe(0);
    expect(inngest.send).not.toHaveBeenCalled();
  });
});

// =============================================================================
// G. Lectura de conexiones y el botón manual
// =============================================================================

describe("conexiones", () => {
  it("lee por el esquema `identidad` (token_ref y cursor no están en la vista public)", async () => {
    const { cliente } = crearSupabaseFalso({
      conexiones: [
        {
          id: "conexion-1",
          tenant_id: "tenant-1",
          seller_id: "seller-1",
          shop_domain: "mi-tienda.myshopify.com",
          filtro_etiqueta: "rutax",
          estado_salud: "sana",
          [COLUMNA_CURSOR]: "2026-08-16T13:00:00.000Z",
        },
      ],
    });

    const conexiones = await leerConexionesParaIngesta(comoSupabase(cliente));

    expect(cliente.schema).toHaveBeenCalledWith("identidad");
    expect(conexiones).toEqual([
      {
        id: "conexion-1",
        tenantId: "tenant-1",
        sellerId: "seller-1",
        shopDomain: "mi-tienda.myshopify.com",
        filtroEtiqueta: "rutax",
        estadoSalud: "sana",
        cursorEn: "2026-08-16T13:00:00.000Z",
      },
    ]);
  });

  it("el botón manual corre la MISMA rutina que el cron (mismo cursor, misma salud)", async () => {
    const { cliente, registro } = crearSupabaseFalso({
      conexiones: [
        {
          id: "conexion-1",
          tenant_id: "tenant-1",
          seller_id: "seller-1",
          shop_domain: "mi-tienda.myshopify.com",
          filtro_etiqueta: null,
          estado_salud: "sana",
          [COLUMNA_CURSOR]: null,
        },
      ],
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(comoSupabase(cliente));
    vi.mocked(peticionShopify)
      .mockResolvedValueOnce(paginaOrdenes([ordenShopify()]))
      .mockResolvedValue({ nodes: [] });

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const resultado = await (jobSincronizarConexionShopify as any).handler({
      event: {
        data: {
          conexionId: "conexion-1",
          sellerId: "seller-1",
          tenantId: "tenant-1",
          actorUsuarioId: "usuario-1",
        },
      },
      step,
      logger: logger(),
    });
    /* eslint-enable @typescript-eslint/no-explicit-any */

    expect(resultado.resultado).toBe("completado");
    expect(registro.insertPedidos).toHaveLength(1);
    expect(registro.updateConexiones).toHaveLength(1);
    expect(marcarSalud).toHaveBeenCalledWith("conexion-1", "tenant-1", { ok: true });
  });

  it("el botón manual sobre una conexión no sincronizable no hace nada", async () => {
    const { cliente, registro } = crearSupabaseFalso({ conexiones: [] });
    vi.mocked(crearClienteServiceRole).mockReturnValue(comoSupabase(cliente));

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const resultado = await (jobSincronizarConexionShopify as any).handler({
      event: {
        data: {
          conexionId: "conexion-fantasma",
          sellerId: "seller-1",
          tenantId: "tenant-1",
          actorUsuarioId: null,
        },
      },
      step,
      logger: logger(),
    });
    /* eslint-enable @typescript-eslint/no-explicit-any */

    expect(resultado.resultado).toBe("conexion_no_sincronizable");
    expect(peticionShopify).not.toHaveBeenCalled();
    expect(registro.updateConexiones).toHaveLength(0);
  });
});

// =============================================================================
// H. Seguridad
// =============================================================================

describe("seguridad", () => {
  it("ni el token ni los datos del comprador salen en el resumen del run ni en los logs", async () => {
    const { cliente } = crearSupabaseFalso({
      conexiones: [
        {
          id: "conexion-1",
          tenant_id: "tenant-1",
          seller_id: "seller-1",
          shop_domain: "mi-tienda.myshopify.com",
          filtro_etiqueta: null,
          estado_salud: "sana",
          [COLUMNA_CURSOR]: null,
        },
      ],
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(comoSupabase(cliente));
    vi.mocked(peticionShopify)
      .mockResolvedValueOnce(paginaOrdenes([ordenShopify()]))
      .mockResolvedValue({ nodes: [] });

    const log = logger();
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const resultado = await (jobIngestaPedidosShopify as any).handler({ step, logger: log });
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const textoResumen = JSON.stringify(resultado);
    const textoLogs = [...log.info.mock.calls, ...log.warn.mock.calls, ...log.error.mock.calls]
      .flat()
      .join(" | ");

    for (const secreto of [TOKEN_FIXTURE, NOMBRE_FIXTURE, TELEFONO_FIXTURE, CALLE_FIXTURE]) {
      expect(textoResumen).not.toContain(secreto);
      expect(textoLogs).not.toContain(secreto);
    }

    expect(resultado.insertados).toBe(1);
  });
});
