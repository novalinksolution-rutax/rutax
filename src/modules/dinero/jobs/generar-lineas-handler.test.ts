/**
 * Pruebas END-TO-END del HANDLER completo del job C1 (`jobGenerarLineas`).
 *
 * `generar-lineas.test.ts` prueba `evaluarElegibilidad` y
 * `levantarExcepcionLineaNoAnulable` de forma AISLADA — nunca el `step.run`
 * completo (`anular-lineas-si-devolucion`) que las conecta. Este archivo
 * ejercita el HANDLER real capturado desde `inngest.createFunction`, con
 * `step.run(label, fn)` ejecutando el callback directamente (mismo patrón que
 * `geocodificar-pedido.test.ts`) y un cliente Supabase chainable por
 * `schema().from()`.
 *
 * Foco (encargo QA, puntos 1 y 2):
 *
 * 1. §2.2 del doc de arquitectura — el ciclo que demuestra que un pedido en
 *    `pendiente_asignacion` puede tener línea viva: cuando el pedido
 *    finalmente se cancela y su línea de cobro/liquidación está en un
 *    período/liquidación MUTABLE, el job la anula con
 *    `motivo_anulacion='cancelacion'` (nunca 'devolucion', el bug de
 *    `f689c94`) y la acción de bitácora `dinero.lineas_anuladas_por_cancelacion`.
 *
 * 2. §2.3/§2.4 (H2/D-A2) — cuando el período YA está `facturado` (o la
 *    liquidación `pagada`), la línea NO se toca y se levanta una excepción
 *    BLOQUEANTE de conciliación (`bloquea_facturacion` / `bloquea_pago`). Y
 *    que reejecutar el job (reintento de Inngest) NO duplica el evento.
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

import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { jobGenerarLineas } from "./generar-lineas";

// El handler real, capturado por el mock de createFunction.
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

const stepFalso = {
  run: <T>(_label: string, fn: () => Promise<T>): Promise<T> => fn(),
};
const loggerFalso = { info: vi.fn(), warn: vi.fn() };

// ---------------------------------------------------------------------------
// Doble de prueba del cliente Supabase — chainable por schema().from(tabla).
// ---------------------------------------------------------------------------

interface ConfigCliente {
  tarifa?: Record<string, unknown> | null;
  incidencia?: Record<string, unknown> | null;
  tenant?: Record<string, unknown> | null;
  pedidoComuna?: Record<string, unknown> | null;
  lineaCobro?: Record<string, unknown> | null;
  periodoCobro?: Record<string, unknown> | null;
  lineaLiquidacion?: Record<string, unknown> | null;
  liquidacion?: Record<string, unknown> | null;
  eventoConciliacionExistente?: Record<string, unknown> | null;
}

function crearClienteDinero(config: ConfigCliente) {
  const spies = {
    updateLineaCobro: vi.fn(),
    updatePedidoCobroFlag: vi.fn(),
    updateLineaLiquidacion: vi.fn(),
    updatePedidoLiquidacionFlag: vi.fn(),
    insertEventoConciliacion: vi.fn(),
  };

  function datosPara(key: string): { data: unknown; error: null } {
    switch (key) {
      case "identidad.tarifas":
        return { data: config.tarifa ?? null, error: null };
      case "operacion.incidencias":
        return { data: config.incidencia ?? null, error: null };
      case "identidad.tenants":
        return { data: config.tenant ?? null, error: null };
      case "operacion.pedidos":
        return { data: config.pedidoComuna ?? null, error: null };
      case "dinero.lineas_cobro":
        return { data: config.lineaCobro ?? null, error: null };
      case "dinero.periodos_cobro":
        return { data: config.periodoCobro ?? null, error: null };
      case "dinero.lineas_liquidacion":
        return { data: config.lineaLiquidacion ?? null, error: null };
      case "dinero.liquidaciones":
        return { data: config.liquidacion ?? null, error: null };
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
    chain.select = vi.fn(self);
    chain.eq = vi.fn(self);
    chain.in = vi.fn(self);
    chain.order = vi.fn(self);
    chain.limit = vi.fn(self);
    chain.is = vi.fn(self);
    chain.maybeSingle = vi.fn(async () => datosPara(key));

    chain.update = vi.fn((valores: Record<string, unknown>) => {
      if (key === "dinero.lineas_cobro") spies.updateLineaCobro(valores);
      if (key === "dinero.lineas_liquidacion") spies.updateLineaLiquidacion(valores);
      if (key === "operacion.pedidos") {
        if ("cobro_generado" in valores) spies.updatePedidoCobroFlag(valores);
        if ("liquidacion_generada" in valores) spies.updatePedidoLiquidacionFlag(valores);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updChain: any = {};
      updChain.eq = vi.fn(() => updChain);
      return updChain;
    });

    chain.insert = vi.fn((valores: Record<string, unknown>) => {
      if (key === "dinero.eventos_conciliacion") spies.insertEventoConciliacion(valores);
      return { error: null };
    });

    return chain;
  }

  const cliente = {
    schema: vi.fn((schemaName: string) => ({
      from: vi.fn((tabla: string) => builder(schemaName, tabla)),
    })),
  };

  return { cliente, spies };
}

const EVENTO_BASE = {
  pedidoId: "pedido-1",
  tenantId: "tenant-1",
  sellerId: "seller-1",
  driverIdAsignado: null as string | null,
  estadoNuevo: "cancelado",
  estadoAnterior: "pendiente_asignacion",
  fechaTransicion: "2026-08-11T15:00:00.000Z",
  tipoPedido: "same_day" as const,
  tarifaAplicableId: null as string | null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// Escenario §2.2 — línea viva sobreviviendo el ciclo pendiente_asignacion →
// asignado → fallido_manual → asignado → pendiente_asignacion, y ahora se
// cancela. Período/liquidación MUTABLES → anulación automática con motivo
// FIEL (H1, `f689c94`) — nunca 'devolucion'.
// =============================================================================
describe("jobGenerarLineas — §2.2: cancelar con línea viva en período 'abierto' / liquidación 'borrador'", () => {
  it("anula la línea de COBRO con motivo_anulacion='cancelacion' y bitácora 'dinero.lineas_anuladas_por_cancelacion' (NUNCA 'devolucion')", async () => {
    const { cliente, spies } = crearClienteDinero({
      lineaCobro: { id: "linea-cobro-1", anulada: false, periodo_cobro_id: "periodo-1" },
      periodoCobro: { estado: "abierto" },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const resultado = await handler({
      event: { data: EVENTO_BASE },
      step: stepFalso,
      logger: loggerFalso,
      runId: "run-1",
    });

    expect(spies.updateLineaCobro).toHaveBeenCalledOnce();
    expect(spies.updateLineaCobro.mock.calls[0][0]).toMatchObject({
      anulada: true,
      motivo_anulacion: "cancelacion",
    });
    expect(spies.updatePedidoCobroFlag).toHaveBeenCalledWith(
      expect.objectContaining({ cobro_generado: false }),
    );

    const entradasBitacora = vi.mocked(registrarEnBitacora).mock.calls.map((c) => c[1]);
    const entradaCobro = entradasBitacora.find((e) => e.detalle && (e.detalle as Record<string, unknown>).tipo_linea === "cobro");
    expect(entradaCobro?.accion).toBe("dinero.lineas_anuladas_por_cancelacion");
    expect(entradasBitacora.some((e) => e.accion === "dinero.lineas_anuladas_por_devolucion")).toBe(false);

    expect(spies.insertEventoConciliacion).not.toHaveBeenCalled();
    expect(resultado).toMatchObject({ generaCobro: false, generaLiquidacion: false, anuloCobro: true });
  });

  it("anula la línea de LIQUIDACIÓN con motivo_anulacion='cancelacion' y bitácora correspondiente", async () => {
    const { cliente, spies } = crearClienteDinero({
      lineaLiquidacion: { id: "linea-liq-1", anulada: false, liquidacion_id: "liq-1", driver_id: "driver-1" },
      liquidacion: { estado: "borrador" },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const resultado = await handler({
      event: { data: EVENTO_BASE },
      step: stepFalso,
      logger: loggerFalso,
      runId: "run-1",
    });

    expect(spies.updateLineaLiquidacion).toHaveBeenCalledOnce();
    expect(spies.updateLineaLiquidacion.mock.calls[0][0]).toMatchObject({
      anulada: true,
      motivo_anulacion: "cancelacion",
    });

    const entradasBitacora = vi.mocked(registrarEnBitacora).mock.calls.map((c) => c[1]);
    const entradaLiq = entradasBitacora.find(
      (e) => e.detalle && (e.detalle as Record<string, unknown>).tipo_linea === "liquidacion",
    );
    expect(entradaLiq?.accion).toBe("dinero.lineas_anuladas_por_cancelacion");

    expect(resultado).toMatchObject({ anuloLiquidacion: true });
  });

  it("ambos lados vivos a la vez (cobro Y liquidación) se anulan en la misma corrida, con la misma fidelidad de motivo", async () => {
    const { cliente, spies } = crearClienteDinero({
      lineaCobro: { id: "linea-cobro-1", anulada: false, periodo_cobro_id: "periodo-1" },
      periodoCobro: { estado: "abierto" },
      lineaLiquidacion: { id: "linea-liq-1", anulada: false, liquidacion_id: "liq-1", driver_id: "driver-1" },
      liquidacion: { estado: "borrador" },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const resultado = await handler({
      event: { data: EVENTO_BASE },
      step: stepFalso,
      logger: loggerFalso,
      runId: "run-1",
    });

    expect(spies.updateLineaCobro).toHaveBeenCalledOnce();
    expect(spies.updateLineaLiquidacion).toHaveBeenCalledOnce();
    expect(resultado).toMatchObject({ anuloCobro: true, anuloLiquidacion: true });
  });
});

// =============================================================================
// Escenario §2.3/§2.4 (H2/D-A2) — período 'facturado' / liquidación 'pagada':
// la línea NO se toca, se levanta excepción BLOQUEANTE, y el re-run (retry de
// Inngest) no duplica el evento.
// =============================================================================
describe("jobGenerarLineas — §2.3/§2.4: período facturado / liquidación pagada (H2, punto ciego tapado)", () => {
  it("período 'facturado' → NO anula la línea de cobro y levanta excepción con bloquea_facturacion=true, bloquea_pago=false", async () => {
    const { cliente, spies } = crearClienteDinero({
      lineaCobro: { id: "linea-cobro-2", anulada: false, periodo_cobro_id: "periodo-2" },
      periodoCobro: { estado: "facturado" },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const resultado = await handler({
      event: { data: EVENTO_BASE },
      step: stepFalso,
      logger: loggerFalso,
      runId: "run-1",
    });

    // La línea NO se toca — el pedido queda cancelado, la línea sigue viva.
    expect(spies.updateLineaCobro).not.toHaveBeenCalled();
    expect(spies.updatePedidoCobroFlag).not.toHaveBeenCalled();

    expect(spies.insertEventoConciliacion).toHaveBeenCalledOnce();
    const eventoInsertado = spies.insertEventoConciliacion.mock.calls[0][0] as Record<string, unknown>;
    expect(eventoInsertado).toMatchObject({
      tipo_diferencia: "linea_cobro_sin_pedido_entregado",
      bloquea_facturacion: true,
      bloquea_pago: false,
      pedido_id: "pedido-1",
    });

    expect(resultado).toMatchObject({ anuloCobro: false, eventoConciliacionCobroId: eventoInsertado.id });
  });

  it("liquidación 'pagada' → NO anula la línea de liquidación y levanta excepción con bloquea_pago=true, bloquea_facturacion=false, con el driver_id de la LÍNEA (no del evento)", async () => {
    const { cliente, spies } = crearClienteDinero({
      lineaLiquidacion: { id: "linea-liq-2", anulada: false, liquidacion_id: "liq-2", driver_id: "driver-original" },
      liquidacion: { estado: "pagada" },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    // El evento trae driverIdAsignado=null (el pedido se reasignó/desasignó
    // después de que la línea se creó) — el driver_id del bloqueo debe salir
    // de la LÍNEA, no del evento, porque a quien se le pagó es al original.
    await handler({
      event: { data: { ...EVENTO_BASE, driverIdAsignado: null } },
      step: stepFalso,
      logger: loggerFalso,
      runId: "run-1",
    });

    expect(spies.updateLineaLiquidacion).not.toHaveBeenCalled();
    expect(spies.insertEventoConciliacion).toHaveBeenCalledOnce();
    const eventoInsertado = spies.insertEventoConciliacion.mock.calls[0][0] as Record<string, unknown>;
    expect(eventoInsertado).toMatchObject({
      tipo_diferencia: "linea_liquidacion_sin_pedido_entregado",
      bloquea_pago: true,
      bloquea_facturacion: false,
      driver_id: "driver-original",
      liquidacion_id: "liq-2",
    });
  });

  it("re-ejecutar el job (retry de Inngest) sobre el MISMO hallazgo vigente NO duplica el evento de conciliación", async () => {
    const { cliente, spies } = crearClienteDinero({
      lineaCobro: { id: "linea-cobro-2", anulada: false, periodo_cobro_id: "periodo-2" },
      periodoCobro: { estado: "facturado" },
      // Simula que un run anterior YA insertó un evento pendiente para
      // (tenant_id, pedido_id, tipo_diferencia) — el SELECT previo al INSERT
      // de `levantarExcepcionLineaNoAnulable` lo encuentra.
      eventoConciliacionExistente: { id: "evento-ya-existente" },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const resultado = await handler({
      event: { data: EVENTO_BASE },
      step: stepFalso,
      logger: loggerFalso,
      runId: "run-2-retry",
    });

    expect(spies.insertEventoConciliacion).not.toHaveBeenCalled();
    expect(resultado).toMatchObject({ eventoConciliacionCobroId: null });
  });

  it("bitácora ANTES del efecto también a nivel del handler completo: se registra 'dinero.linea_no_anulable_por_cancelacion' cuando no puede anular", async () => {
    const { cliente } = crearClienteDinero({
      lineaCobro: { id: "linea-cobro-3", anulada: false, periodo_cobro_id: "periodo-3" },
      periodoCobro: { estado: "cerrado" },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    await handler({ event: { data: EVENTO_BASE }, step: stepFalso, logger: loggerFalso, runId: "run-1" });

    const entradas = vi.mocked(registrarEnBitacora).mock.calls.map((c) => c[1]);
    expect(entradas.some((e) => e.accion === "dinero.linea_no_anulable_por_cancelacion")).toBe(true);
  });
});
