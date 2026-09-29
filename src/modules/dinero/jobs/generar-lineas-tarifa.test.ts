/**
 * C1 · resolución de tarifa cuando el pedido nace sin `tarifa_aplicable_id`.
 *
 * Ejercita el HANDLER REAL de `jobGenerarLineas` (capturado desde
 * `inngest.createFunction`) con un cliente Supabase de doble — el mismo patrón que
 * `generar-lineas-handler.test.ts`. Nada de la lógica se reimplementa acá: el
 * doble solo contesta lo que la base contestaría.
 *
 * El bug que cierra (2026-09-28): la ingesta de Mercado Libre NUNCA escribe
 * `pedidos.tarifa_aplicable_id`, y C1 hacía `tarifa_id: tarifaAplicableId!` contra
 * una columna NOT NULL. Todo Flex entregado reventaba el INSERT, el job
 * reintentaba 4 veces y terminaba fallido — plata sin cobrar y sin nadie enterado.
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

vi.mock("../periodos", () => ({
  obtenerOCrearPeriodoCobroAbierto: vi.fn().mockResolvedValue("periodo-1"),
  obtenerOCrearLiquidacionAbierta: vi.fn().mockResolvedValue("liq-1"),
}));

import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { jobGenerarLineas } from "./generar-lineas";

const handler = (
  jobGenerarLineas as unknown as {
    handler: (ctx: {
      event: { data: Record<string, unknown> };
      step: { run: <T>(label: string, fn: () => Promise<T>) => Promise<T> };
      logger: { info: (m: string) => void; warn: (m: string) => void };
      runId: string;
    }) => Promise<Record<string, unknown>>;
  }
).handler;

const stepFalso = { run: <T>(_l: string, fn: () => Promise<T>): Promise<T> => fn() };
const loggerFalso = { info: vi.fn(), warn: vi.fn() };

interface ConfigCliente {
  pedido?: Record<string, unknown> | null;
  /** Fila de `identidad.tarifas` que devuelve el SELECT por id. */
  tarifa?: Record<string, unknown> | null;
  /** Lo que responde `resolver_tarifa_por_comuna` (una sola fila). */
  resolucion?: Record<string, unknown>;
  eventoConciliacionExistente?: Record<string, unknown> | null;
}

function crearCliente(config: ConfigCliente) {
  const spies = {
    rpc: vi.fn(),
    insertLineaCobro: vi.fn(),
    insertLineaLiquidacion: vi.fn(),
    insertEvento: vi.fn(),
    updatePedido: vi.fn(),
  };

  function datosPara(key: string): { data: unknown; error: null } {
    switch (key) {
      case "operacion.pedidos":
        return { data: config.pedido ?? null, error: null };
      case "identidad.tarifas":
        return { data: config.tarifa ?? null, error: null };
      case "dinero.eventos_conciliacion":
        return { data: config.eventoConciliacionExistente ?? null, error: null };
      default:
        return { data: null, error: null };
    }
  }

  function builder(schema: string, tabla: string) {
    const key = `${schema}.${tabla}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {};
    const self = () => chain;
    for (const m of ["select", "eq", "in", "order", "limit", "is"]) chain[m] = vi.fn(self);
    chain.maybeSingle = vi.fn(async () => datosPara(key));

    chain.insert = vi.fn((valores: Record<string, unknown>) => {
      if (key === "dinero.lineas_cobro") spies.insertLineaCobro(valores);
      if (key === "dinero.lineas_liquidacion") spies.insertLineaLiquidacion(valores);
      if (key === "dinero.eventos_conciliacion") {
        spies.insertEvento(valores);
        return { error: null };
      }
      // INSERT ... .select('id').maybeSingle() → la fila nueva.
      return { select: () => ({ maybeSingle: async () => ({ data: { id: `nueva-${tabla}` }, error: null }) }) };
    });

    chain.update = vi.fn((valores: Record<string, unknown>) => {
      if (key === "operacion.pedidos") spies.updatePedido(valores);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const upd: any = {};
      upd.eq = vi.fn(() => upd);
      upd.is = vi.fn(() => upd);
      upd.then = (resolve: (r: { error: null }) => void) => resolve({ error: null });
      return upd;
    });

    return chain;
  }

  const cliente = {
    schema: vi.fn((schemaName: string) => ({
      from: vi.fn((tabla: string) => builder(schemaName, tabla)),
      rpc: vi.fn(async (fn: string, args: unknown) => {
        spies.rpc(fn, args);
        return {
          data: [
            {
              tarifa_id: null,
              zona_id: null,
              zona_por_respaldo: false,
              por_seller: false,
              por_fuente: false,
              por_regimen: false,
              por_zona: false,
              ...config.resolucion,
            },
          ],
          error: null,
        };
      }),
    })),
  };

  return { cliente, spies };
}

const EVENTO_FLEX_ENTREGADO = {
  pedidoId: "pedido-flex-1",
  tenantId: "tenant-1",
  sellerId: "seller-1",
  driverIdAsignado: "driver-1",
  estadoNuevo: "entregado",
  estadoAnterior: "en_ruta",
  // 2026-09-28 21:30 en Santiago (UTC-3) → 2026-09-29 00:30Z: prueba que la
  // fecha del hecho es la LOCAL, no la del reloj UTC.
  fechaTransicion: "2026-09-29T00:30:00.000Z",
  tipoPedido: "flex" as const,
  tarifaAplicableId: null as string | null,
};

const PEDIDO_FLEX = { destinatario_comuna: "Providencia", fuente: "ml_flex" };

const TARIFA_FLEX = {
  monto_clp: 1800,
  monto_conductor_clp: 1200,
  tipo_entrega: null,
  fuente: "ml_flex",
  modo_calculo: "monto_fijo",
  zona: null,
  zona_id: null,
  vigente_desde: "2026-01-01",
  vigente_hasta: null,
  estado: "activa",
  minimo_retiro_clp: null,
  minimo_facturacion_clp: null,
  recargo_reprogramacion_clp: null,
};

async function correr(cliente: unknown, data: Record<string, unknown> = EVENTO_FLEX_ENTREGADO) {
  vi.mocked(crearClienteServiceRole).mockReturnValue(
    cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
  );
  return handler({ event: { data }, step: stepFalso, logger: loggerFalso, runId: "run-1" });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("C1 — Flex entregado SIN tarifa_aplicable_id (el bug latente)", () => {
  it("resuelve la tarifa con fuente, régimen, comuna y la fecha LOCAL del hecho, y genera cobro y liquidación con monto > 0", async () => {
    const { cliente, spies } = crearCliente({
      pedido: PEDIDO_FLEX,
      tarifa: TARIFA_FLEX,
      resolucion: { tarifa_id: "tarifa-flex", por_seller: true, por_fuente: true },
    });

    const resultado = await correr(cliente);

    expect(spies.rpc).toHaveBeenCalledWith("resolver_tarifa_por_comuna", {
      p_tenant: "tenant-1",
      p_seller: "seller-1",
      p_fuente: "ml_flex",
      p_tipo_pedido: "flex",
      p_comuna: "Providencia",
      p_fecha: "2026-09-28",
    });

    expect(spies.insertLineaCobro).toHaveBeenCalledOnce();
    const cobro = spies.insertLineaCobro.mock.calls[0][0] as Record<string, unknown>;
    // La columna NOT NULL recibe el id resuelto, no `undefined`.
    expect(cobro.tarifa_id).toBe("tarifa-flex");
    expect(cobro.monto_base_clp).toBe(1800);
    expect(cobro.monto_base_clp as number).toBeGreaterThan(0);

    expect(spies.insertLineaLiquidacion).toHaveBeenCalledOnce();
    expect((spies.insertLineaLiquidacion.mock.calls[0][0] as Record<string, unknown>).monto_base_clp).toBe(1200);

    expect(spies.insertEvento).not.toHaveBeenCalled();
    expect(resultado).toMatchObject({ generaCobro: true, lineaCobroId: "nueva-lineas_cobro" });
    expect(resultado.sinTarifa).toBeUndefined();
  });

  it("el snapshot queda en v2 con la fuente del pedido y por qué ganó la tarifa", async () => {
    const { cliente, spies } = crearCliente({
      pedido: PEDIDO_FLEX,
      tarifa: TARIFA_FLEX,
      resolucion: { tarifa_id: "tarifa-flex", por_seller: true, por_fuente: true, por_zona: false },
    });

    await correr(cliente);

    const snapshot = (spies.insertLineaCobro.mock.calls[0][0] as { snapshot_regla: Record<string, unknown> })
      .snapshot_regla;
    expect(snapshot.version).toBe(2);
    expect(snapshot.tarifa).toMatchObject({
      tarifa_id: "tarifa-flex",
      tipo_entrega: null,
      fuente_pedido_tarifa: "ml_flex",
      resolucion: { por_seller: true, por_fuente: true, por_regimen: false, por_zona: false },
    });
    expect(snapshot.estado_pedido).toMatchObject({ fuente: "ml_flex", tipo_pedido: "flex" });
    expect(snapshot.zona).toMatchObject({ por_respaldo: false });
  });

  it("comuna sin zona: se cobra por la zona de respaldo y el snapshot lo deja registrado", async () => {
    const { cliente, spies } = crearCliente({
      pedido: { destinatario_comuna: "Curacaví", fuente: "ml_flex" },
      tarifa: { ...TARIFA_FLEX, zona_id: "zona-periferia", zona: "Periferia" },
      resolucion: {
        tarifa_id: "tarifa-periferia",
        zona_id: "zona-periferia",
        zona_por_respaldo: true,
        por_zona: true,
      },
    });

    await correr(cliente);

    expect(spies.insertLineaCobro).toHaveBeenCalledOnce();
    const snapshot = (spies.insertLineaCobro.mock.calls[0][0] as { snapshot_regla: Record<string, unknown> })
      .snapshot_regla;
    expect(snapshot.zona).toMatchObject({ zona_pedido_id: "zona-periferia", por_respaldo: true });
  });
});

describe("C1 — sin tarifa alguna NO tumba el job", () => {
  it("no lanza, no inventa una línea en $0, y deja excepciones bloqueantes en la bandeja", async () => {
    const { cliente, spies } = crearCliente({
      pedido: PEDIDO_FLEX,
      resolucion: { tarifa_id: null },
    });

    const resultado = await correr(cliente);

    expect(spies.insertLineaCobro).not.toHaveBeenCalled();
    expect(spies.insertLineaLiquidacion).not.toHaveBeenCalled();

    const eventos = spies.insertEvento.mock.calls.map((c) => c[0] as Record<string, unknown>);
    const cobro = eventos.find((e) => e.tipo_diferencia === "pedido_entregado_sin_linea_cobro");
    const liq = eventos.find((e) => e.tipo_diferencia === "pedido_entregado_sin_linea_liquidacion");
    expect(cobro).toMatchObject({
      pedido_id: "pedido-flex-1",
      seller_id: "seller-1",
      bloquea_facturacion: true,
      bloquea_pago: false,
      estado: "pendiente",
    });
    expect(cobro?.motivo_bloqueo).toEqual(expect.stringContaining("sin tarifa aplicable"));
    expect(liq).toMatchObject({ driver_id: "driver-1", bloquea_pago: true, bloquea_facturacion: false });

    // No se marca el pedido como cobrado: la UI y C6 leen esos flags.
    expect(spies.updatePedido).not.toHaveBeenCalled();
    expect(resultado).toMatchObject({ sinTarifa: true, lineaCobroId: null, lineaLiquidacionId: null });
  });

  it("bitácora ANTES del INSERT de la excepción, con el id del evento", async () => {
    const { cliente, spies } = crearCliente({ pedido: PEDIDO_FLEX, resolucion: { tarifa_id: null } });

    await correr(cliente);

    const entradas = vi.mocked(registrarEnBitacora).mock.calls.map((c) => c[1]);
    const idx = entradas.findIndex((e) => e.accion === "dinero.linea_no_generada_sin_tarifa");
    expect(idx).toBeGreaterThanOrEqual(0);

    const ordenBitacora = vi.mocked(registrarEnBitacora).mock.invocationCallOrder[idx];
    const ordenInsert = spies.insertEvento.mock.invocationCallOrder[0];
    expect(ordenBitacora).toBeLessThan(ordenInsert);

    const idEvento = (spies.insertEvento.mock.calls[0][0] as Record<string, unknown>).id;
    expect((entradas[idx].detalle as Record<string, unknown>).evento_conciliacion_id).toBe(idEvento);
  });

  it("un reintento sobre el mismo hallazgo vigente no duplica la excepción", async () => {
    const { cliente, spies } = crearCliente({
      pedido: PEDIDO_FLEX,
      resolucion: { tarifa_id: null },
      eventoConciliacionExistente: { id: "evento-previo" },
    });

    await correr(cliente);

    expect(spies.insertEvento).not.toHaveBeenCalled();
  });
});

describe("C1 — cuándo NO se resuelve", () => {
  it("si el pedido ya trae tarifa_aplicable_id se respeta y no se consulta la función", async () => {
    const { cliente, spies } = crearCliente({ pedido: PEDIDO_FLEX, tarifa: TARIFA_FLEX });

    await correr(cliente, { ...EVENTO_FLEX_ENTREGADO, tarifaAplicableId: "tarifa-fijada" });

    expect(spies.rpc).not.toHaveBeenCalled();
    expect((spies.insertLineaCobro.mock.calls[0][0] as Record<string, unknown>).tarifa_id).toBe("tarifa-fijada");
  });

  it("cancelado/devuelto solo anulan: no hay nada que tarifar", async () => {
    const { cliente, spies } = crearCliente({ pedido: PEDIDO_FLEX });

    await correr(cliente, { ...EVENTO_FLEX_ENTREGADO, estadoNuevo: "cancelado" });

    expect(spies.rpc).not.toHaveBeenCalled();
    expect(spies.insertEvento).not.toHaveBeenCalled();
  });
});
