/**
 * Job · shopify/marcarCumplido — pruebas.
 *
 * Cubre exactamente lo que pide la tarea:
 *   - no-op para `ml_flex` y `rutax_manual` (y para estados terminales que no
 *     son de entrega);
 *   - una mutación con `userErrors` NUNCA se cuenta como éxito;
 *   - una fulfillment order ya cerrada no se vuelve a cumplir;
 *   - el tracking que se manda lleva el `codigo_interno` y la URL de
 *     `/tracking/`;
 *   - resolución multi-tienda (la primera conexión no reconoce el pedido, la
 *     segunda sí).
 *
 * Mismo patrón de extracción de handler que el resto de jobs del repo
 * (`inngest.createFunction` mockeado para capturar el handler real, `step.run`
 * inyectado que ejecuta el callback directamente).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/inngest/cliente", () => ({
  inngest: {
    createFunction: vi.fn((config: unknown, handler: unknown) => ({ config, handler })),
    send: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock("@/modules/identidad/auditoria", () => ({
  registrarEnBitacora: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/modules/identidad/enlace-invitacion", () => ({
  resolverUrlBaseApp: vi.fn(() => "https://app.rutax.io"),
}));

vi.mock("../puerto", () => ({
  obtenerAccessToken: vi.fn(),
  obtenerConexionesPorSeller: vi.fn(),
}));

vi.mock("../cumplimiento", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../cumplimiento")>();
  return {
    ...actual,
    obtenerFulfillmentOrdersPedido: vi.fn(),
    crearCumplimientoConTracking: vi.fn(),
  };
});

import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { resolverUrlBaseApp } from "@/modules/identidad/enlace-invitacion";
import { obtenerAccessToken, obtenerConexionesPorSeller } from "../puerto";
import {
  obtenerFulfillmentOrdersPedido,
  crearCumplimientoConTracking,
  ErrorCumplimientoShopifyRechazado,
  type FulfillmentOrderShopify,
} from "../cumplimiento";
import { jobMarcarCumplidoShopify } from "./marcar-cumplido-shopify";
import type { ConexionShopify } from "../tipos";

type CtxHandler = {
  event: { data: Record<string, unknown> };
  step: { run: <T>(label: string, fn: () => Promise<T>) => Promise<T> };
  logger: { info: (m: string) => void; warn: (m: string) => void };
  runId: string;
};

const handler = (
  jobMarcarCumplidoShopify as unknown as { handler: (ctx: CtxHandler) => Promise<Record<string, unknown>> }
).handler;

const stepFalso = {
  run: <T>(_label: string, fn: () => Promise<T>): Promise<T> => fn(),
};
const loggerFalso = { info: vi.fn(), warn: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolverUrlBaseApp).mockReturnValue("https://app.rutax.io");
  vi.mocked(registrarEnBitacora).mockResolvedValue(undefined);
});

// =============================================================================
// Fixtures
// =============================================================================

const TENANT_A = "aaaa0000-0000-0000-0000-aaaaaaaaaaaa";
const PEDIDO_1 = "bbbb0000-0000-0000-0000-bbbbbbbbbbbb";
const SELLER_1 = "cccc0000-0000-0000-0000-cccccccccccc";
const ID_EXTERNO_1 = "gid://shopify/Order/5123456789012";
const TRACKING_TOKEN = "11111111-2222-3333-4444-555555555555";
const CODIGO_INTERNO = "RX-AB12-CD34";

const EVENTO_BASE = {
  pedidoId: PEDIDO_1,
  tenantId: TENANT_A,
  sellerId: SELLER_1,
  fuente: "shopify" as const,
  idExterno: ID_EXTERNO_1,
  estadoNuevo: "entregado" as const,
  fechaTransicion: "2026-08-16T12:00:00.000Z",
};

function conexion(over: Partial<ConexionShopify> = {}): ConexionShopify {
  return {
    id: over.id ?? "conexion-1",
    tenantId: TENANT_A,
    sellerId: SELLER_1,
    shopDomain: over.shopDomain ?? "mi-tienda.myshopify.com",
    tokenRef: null,
    scopesOtorgados: [],
    filtroEtiqueta: null,
    estadoSalud: "sana",
    ultimaSyncExitosaEn: null,
    ultimoError: null,
    alias: null,
    nombreTienda: null,
    activa: true,
    creadoEn: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

function clienteConPedido(pedido: Record<string, unknown> | null) {
  return {
    from: (_tabla: string) => ({
      select: (_cols?: string) => ({
        eq: (_c: string, _v: unknown) => ({
          eq: (_c2: string, _v2: unknown) => ({
            maybeSingle: async () => ({ data: pedido, error: null }),
          }),
        }),
      }),
    }),
  } as never;
}

// =============================================================================
// 1. No-op inmediato — fuente distinta / estado que no es de entrega
// =============================================================================

describe("marcarCumplidoShopify — no-op inmediato", () => {
  it("fuente 'ml_flex': no-op, sin tocar BD ni red", async () => {
    const resultado = await handler({
      event: { data: { ...EVENTO_BASE, fuente: "ml_flex" } },
      step: stepFalso,
      logger: loggerFalso,
      runId: "run-1",
    });

    expect(resultado).toMatchObject({ resultado: "no_op_fuente_distinta" });
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
    expect(obtenerConexionesPorSeller).not.toHaveBeenCalled();
  });

  it("fuente 'rutax_manual': no-op, sin tocar BD ni red", async () => {
    const resultado = await handler({
      event: { data: { ...EVENTO_BASE, fuente: "rutax_manual" } },
      step: stepFalso,
      logger: loggerFalso,
      runId: "run-1",
    });

    expect(resultado).toMatchObject({ resultado: "no_op_fuente_distinta" });
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });

  it("estadoNuevo 'fallido' (Shopify, pero no es entrega): no-op en la v1", async () => {
    const resultado = await handler({
      event: { data: { ...EVENTO_BASE, estadoNuevo: "fallido" } },
      step: stepFalso,
      logger: loggerFalso,
      runId: "run-1",
    });

    expect(resultado).toMatchObject({ resultado: "no_op_estado_no_es_entrega" });
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });

  it("estadoNuevo 'cancelado': no-op en la v1", async () => {
    const resultado = await handler({
      event: { data: { ...EVENTO_BASE, estadoNuevo: "cancelado" } },
      step: stepFalso,
      logger: loggerFalso,
      runId: "run-1",
    });

    expect(resultado).toMatchObject({ resultado: "no_op_estado_no_es_entrega" });
  });

  it("estadoNuevo 'devuelto': no-op en la v1", async () => {
    const resultado = await handler({
      event: { data: { ...EVENTO_BASE, estadoNuevo: "devuelto" } },
      step: stepFalso,
      logger: loggerFalso,
      runId: "run-1",
    });

    expect(resultado).toMatchObject({ resultado: "no_op_estado_no_es_entrega" });
  });
});

// =============================================================================
// 2. Datos propios del pedido
// =============================================================================

describe("marcarCumplidoShopify — datos propios del pedido", () => {
  it("pedido no encontrado: no-op, sin lanzar", async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(clienteConPedido(null));

    const resultado = await handler({
      event: { data: EVENTO_BASE },
      step: stepFalso,
      logger: loggerFalso,
      runId: "run-1",
    });

    expect(resultado).toMatchObject({ resultado: "pedido_no_encontrado" });
  });

  it("sin codigo_interno/tracking_token: no-op", async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      clienteConPedido({ id: PEDIDO_1, codigo_interno: null, tracking_token: null }),
    );

    const resultado = await handler({
      event: { data: EVENTO_BASE },
      step: stepFalso,
      logger: loggerFalso,
      runId: "run-1",
    });

    expect(resultado).toMatchObject({ resultado: "sin_datos_de_tracking" });
  });

  it("sin URL pública configurada: no-op", async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      clienteConPedido({ id: PEDIDO_1, codigo_interno: CODIGO_INTERNO, tracking_token: TRACKING_TOKEN }),
    );
    vi.mocked(resolverUrlBaseApp).mockReturnValue(null);

    const resultado = await handler({
      event: { data: EVENTO_BASE },
      step: stepFalso,
      logger: loggerFalso,
      runId: "run-1",
    });

    expect(resultado).toMatchObject({ resultado: "sin_url_publica" });
  });
});

// =============================================================================
// 3. Camino feliz — tracking correcto
// =============================================================================

describe("marcarCumplidoShopify — camino feliz", () => {
  it("cumple: manda el codigo_interno y la URL /tracking/, y registra bitácora ANTES de la mutación", async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      clienteConPedido({ id: PEDIDO_1, codigo_interno: CODIGO_INTERNO, tracking_token: TRACKING_TOKEN }),
    );
    vi.mocked(obtenerConexionesPorSeller).mockResolvedValue([conexion()]);
    vi.mocked(obtenerAccessToken).mockResolvedValue("token-secreto");
    const fulfillmentOrdersAbiertas: FulfillmentOrderShopify[] = [
      { id: "gid://shopify/FulfillmentOrder/1", status: "OPEN" },
    ];
    vi.mocked(obtenerFulfillmentOrdersPedido).mockResolvedValue(fulfillmentOrdersAbiertas);
    vi.mocked(crearCumplimientoConTracking).mockResolvedValue({ fulfillmentId: "gid://shopify/Fulfillment/1" });

    const ordenDeLlamadas: string[] = [];
    vi.mocked(registrarEnBitacora).mockImplementation(async () => {
      ordenDeLlamadas.push("bitacora");
    });
    vi.mocked(crearCumplimientoConTracking).mockImplementation(async () => {
      ordenDeLlamadas.push("mutacion");
      return { fulfillmentId: "gid://shopify/Fulfillment/1" };
    });

    const resultado = await handler({
      event: { data: EVENTO_BASE },
      step: stepFalso,
      logger: loggerFalso,
      runId: "run-1",
    });

    expect(resultado).toMatchObject({ resultado: "cumplido" });
    expect(ordenDeLlamadas).toEqual(["bitacora", "mutacion"]);

    const llamada = vi.mocked(crearCumplimientoConTracking).mock.calls[0]![0];
    expect(llamada.tracking.numero).toBe(CODIGO_INTERNO);
    expect(llamada.tracking.url).toBe(`https://app.rutax.io/tracking/${TRACKING_TOKEN}`);
    expect(llamada.fulfillmentOrderIds).toEqual(["gid://shopify/FulfillmentOrder/1"]);

    // Access token nunca viaja a la bitácora.
    const detalleBitacora = vi.mocked(registrarEnBitacora).mock.calls[0]![1].detalle;
    expect(JSON.stringify(detalleBitacora)).not.toContain("token-secreto");
  });

  it("varias fulfillment orders abiertas: se mandan TODAS en la misma mutación", async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      clienteConPedido({ id: PEDIDO_1, codigo_interno: CODIGO_INTERNO, tracking_token: TRACKING_TOKEN }),
    );
    vi.mocked(obtenerConexionesPorSeller).mockResolvedValue([conexion()]);
    vi.mocked(obtenerAccessToken).mockResolvedValue("token-secreto");
    vi.mocked(obtenerFulfillmentOrdersPedido).mockResolvedValue([
      { id: "gid://shopify/FulfillmentOrder/1", status: "OPEN" },
      { id: "gid://shopify/FulfillmentOrder/2", status: "OPEN" },
    ]);
    vi.mocked(crearCumplimientoConTracking).mockResolvedValue({ fulfillmentId: "gid://shopify/Fulfillment/1" });

    await handler({ event: { data: EVENTO_BASE }, step: stepFalso, logger: loggerFalso, runId: "run-1" });

    const llamada = vi.mocked(crearCumplimientoConTracking).mock.calls[0]![0];
    expect(llamada.fulfillmentOrderIds).toEqual([
      "gid://shopify/FulfillmentOrder/1",
      "gid://shopify/FulfillmentOrder/2",
    ]);
  });
});

// =============================================================================
// 4. Fulfillment order ya cerrada — no se vuelve a cumplir
// =============================================================================

describe("marcarCumplidoShopify — fulfillment order ya cerrada", () => {
  it("todas las fulfillment orders CLOSED: no-op, NO llama a crearCumplimientoConTracking", async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      clienteConPedido({ id: PEDIDO_1, codigo_interno: CODIGO_INTERNO, tracking_token: TRACKING_TOKEN }),
    );
    vi.mocked(obtenerConexionesPorSeller).mockResolvedValue([conexion()]);
    vi.mocked(obtenerAccessToken).mockResolvedValue("token-secreto");
    vi.mocked(obtenerFulfillmentOrdersPedido).mockResolvedValue([
      { id: "gid://shopify/FulfillmentOrder/1", status: "CLOSED" },
    ]);

    const resultado = await handler({
      event: { data: EVENTO_BASE },
      step: stepFalso,
      logger: loggerFalso,
      runId: "run-1",
    });

    expect(resultado).toMatchObject({ resultado: "ya_cumplido_en_shopify" });
    expect(crearCumplimientoConTracking).not.toHaveBeenCalled();
    expect(registrarEnBitacora).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 5. userErrors NO se cuenta como éxito
// =============================================================================

describe("marcarCumplidoShopify — Shopify rechaza la mutación (userErrors)", () => {
  it("no marca como éxito, no relanza (no reintenta un rechazo definitivo)", async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      clienteConPedido({ id: PEDIDO_1, codigo_interno: CODIGO_INTERNO, tracking_token: TRACKING_TOKEN }),
    );
    vi.mocked(obtenerConexionesPorSeller).mockResolvedValue([conexion()]);
    vi.mocked(obtenerAccessToken).mockResolvedValue("token-secreto");
    vi.mocked(obtenerFulfillmentOrdersPedido).mockResolvedValue([
      { id: "gid://shopify/FulfillmentOrder/1", status: "OPEN" },
    ]);
    vi.mocked(crearCumplimientoConTracking).mockRejectedValue(
      new ErrorCumplimientoShopifyRechazado([{ message: "Ya fue cumplida por otra vía." }]),
    );

    const resultado = await handler({
      event: { data: EVENTO_BASE },
      step: stepFalso,
      logger: loggerFalso,
      runId: "run-1",
    });

    expect(resultado).toMatchObject({ resultado: "rechazado_por_shopify" });
    expect(resultado.resultado).not.toBe("cumplido");
  });

  it("un error de red/GraphQL genérico SÍ se relanza (para que Inngest reintente)", async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      clienteConPedido({ id: PEDIDO_1, codigo_interno: CODIGO_INTERNO, tracking_token: TRACKING_TOKEN }),
    );
    vi.mocked(obtenerConexionesPorSeller).mockResolvedValue([conexion()]);
    vi.mocked(obtenerAccessToken).mockResolvedValue("token-secreto");
    vi.mocked(obtenerFulfillmentOrdersPedido).mockResolvedValue([
      { id: "gid://shopify/FulfillmentOrder/1", status: "OPEN" },
    ]);
    vi.mocked(crearCumplimientoConTracking).mockRejectedValue(new Error("Shopify respondió 503"));

    await expect(
      handler({ event: { data: EVENTO_BASE }, step: stepFalso, logger: loggerFalso, runId: "run-1" }),
    ).rejects.toThrow("Shopify respondió 503");
  });
});

// =============================================================================
// 6. Multi-tienda — resolución por prueba secuencial
// =============================================================================

describe("marcarCumplidoShopify — multi-tienda (varias conexiones del seller)", () => {
  it("la primera conexión no reconoce el pedido (order:null) — usa la segunda", async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      clienteConPedido({ id: PEDIDO_1, codigo_interno: CODIGO_INTERNO, tracking_token: TRACKING_TOKEN }),
    );
    vi.mocked(obtenerConexionesPorSeller).mockResolvedValue([
      conexion({ id: "conexion-A", shopDomain: "tienda-a.myshopify.com" }),
      conexion({ id: "conexion-B", shopDomain: "tienda-b.myshopify.com" }),
    ]);
    vi.mocked(obtenerAccessToken).mockImplementation(async (conexionId: string) => `token-${conexionId}`);
    vi.mocked(obtenerFulfillmentOrdersPedido).mockImplementation(async ({ shopDomain }) =>
      shopDomain === "tienda-b.myshopify.com" ? [{ id: "gid://shopify/FulfillmentOrder/9", status: "OPEN" }] : null,
    );
    vi.mocked(crearCumplimientoConTracking).mockResolvedValue({ fulfillmentId: "gid://shopify/Fulfillment/1" });

    const resultado = await handler({
      event: { data: EVENTO_BASE },
      step: stepFalso,
      logger: loggerFalso,
      runId: "run-1",
    });

    expect(resultado).toMatchObject({ resultado: "cumplido", shopDomain: "tienda-b.myshopify.com" });
    const llamada = vi.mocked(crearCumplimientoConTracking).mock.calls[0]![0];
    expect(llamada.shopDomain).toBe("tienda-b.myshopify.com");
    expect(llamada.accessToken).toBe("token-conexion-B");
  });

  it("ninguna conexión reconoce el pedido: no-op, sin lanzar", async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      clienteConPedido({ id: PEDIDO_1, codigo_interno: CODIGO_INTERNO, tracking_token: TRACKING_TOKEN }),
    );
    vi.mocked(obtenerConexionesPorSeller).mockResolvedValue([conexion()]);
    vi.mocked(obtenerAccessToken).mockResolvedValue("token-secreto");
    vi.mocked(obtenerFulfillmentOrdersPedido).mockResolvedValue(null);

    const resultado = await handler({
      event: { data: EVENTO_BASE },
      step: stepFalso,
      logger: loggerFalso,
      runId: "run-1",
    });

    expect(resultado).toMatchObject({ resultado: "conexion_no_resuelta" });
    expect(crearCumplimientoConTracking).not.toHaveBeenCalled();
  });
});
