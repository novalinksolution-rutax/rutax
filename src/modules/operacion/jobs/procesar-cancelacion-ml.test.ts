/**
 * Pruebas del consumidor `operacion/procesarCancelacionMl` — job que refleja
 * en Rutax una cancelación DETECTADA en Mercado Libre (evento
 * `operacion/pedido.cancelado-en-ml`, publicado por `integraciones`).
 *
 * Mismo patrón de extracción de handler que `dinero/jobs/generar-lineas-
 * handler.test.ts`: se mockea `inngest.createFunction` para capturar el
 * handler real y se le inyecta un `step.run` que ejecuta el callback
 * directamente (sin Inngest de verdad), con un cliente Supabase chainable.
 *
 * Organización:
 * 1. Camino feliz por estado de origen: pendiente_asignacion (sin incidencia),
 *    asignado / en_ruta (con incidencia + desactivación de asignación),
 *    fallido / fallido_manual (sin incidencia nueva).
 * 2. Idempotencia: evento repetido sobre un pedido ya cancelado.
 * 3. Carrera: ErrorConflicto se trata como no-op, no como fallo.
 * 4. Estados terminales previos (entregado/devuelto): anomalía registrada sin
 *    romper el invariante de la máquina de estados.
 * 5. Pedido no encontrado / de otro tenant: no-op defensivo (aislamiento).
 * 6. Bitácora ANTES del efecto, con actorTipo='sistema' y sin secretos.
 * 7. Integración real con el motor de dinero (C1, `generar-lineas.ts`): el
 *    evento financiero que publica este job, procesado por el job REAL de
 *    dinero, anula líneas en período abierto y levanta la excepción
 *    bloqueante en período facturado — sin reimplementar esa lógica aquí.
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
import { inngest } from "@/lib/inngest/cliente";
import { jobProcesarCancelacionMl } from "./procesar-cancelacion-ml";
import { jobGenerarLineas } from "@/modules/dinero/jobs/generar-lineas";
import type { EstadoPedido } from "../tipos";

type CtxHandler = {
  event: { data: Record<string, unknown> };
  step: { run: <T>(label: string, fn: () => Promise<T>) => Promise<T> };
  logger: { info: (m: string) => void; warn: (m: string) => void };
  runId: string;
};

// El handler real, capturado por el mock de createFunction.
const handler = (
  jobProcesarCancelacionMl as unknown as { handler: (ctx: CtxHandler) => Promise<Record<string, unknown>> }
).handler;

const handlerDinero = (
  jobGenerarLineas as unknown as { handler: (ctx: CtxHandler) => Promise<Record<string, unknown>> }
).handler;

const stepFalso = {
  run: <T>(_label: string, fn: () => Promise<T>): Promise<T> => fn(),
};
const loggerFalso = { info: vi.fn(), warn: vi.fn() };

/**
 * Extrae, del mock de `inngest.send`, el primer evento publicado con el
 * `name` dado. Mismo patrón de cast explícito que `dinero/acciones.test.ts`
 * (`vi.mocked(inngest.send).mock.calls[0][0] as {...}`) — `send()` acepta un
 * evento único o un arreglo (batch), así que TypeScript no puede inferir
 * `.name`/`.data` sin este cast.
 */
type EventoInngestCapturado = { name: string; data: Record<string, unknown> };

function extraerEventoPublicado(nombre: string): EventoInngestCapturado {
  const llamada = vi
    .mocked(inngest.send)
    .mock.calls.find((c) => (c[0] as EventoInngestCapturado).name === nombre);
  if (!llamada) throw new Error(`No se publicó ningún evento '${nombre}' — revisa el test.`);
  return llamada[0] as EventoInngestCapturado;
}

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks NO borra implementaciones (solo llamadas) — se re-afirma acá
  // por si algún test override con mockImplementation (ver grupo 6).
  vi.mocked(registrarEnBitacora).mockReset();
  vi.mocked(registrarEnBitacora).mockResolvedValue(undefined);
});

// =============================================================================
// Fixtures
// =============================================================================

const TENANT_A = "aaaa0000-0000-0000-0000-aaaaaaaaaaaa";
const TENANT_B = "aaaa0000-0000-0000-0000-bbbbbbbbbbbb";
const PEDIDO_1 = "bbbb0000-0000-0000-0000-bbbbbbbbbbbb";
const SELLER_1 = "cccc0000-0000-0000-0000-cccccccccccc";
const DRIVER_1 = "dddd0000-0000-0000-0000-dddddddddddd";
const ML_SHIPMENT_1 = "ML-SHP-0001";

const EVENTO_BASE = {
  pedidoId: PEDIDO_1,
  tenantId: TENANT_A,
  sellerId: SELLER_1,
  mlShipmentId: ML_SHIPMENT_1,
  estadoAnterior: "asignado",
  substatusMl: "buyer_cancelled",
};

// =============================================================================
// Doble de prueba del cliente Supabase (schema `operacion`, tablas planas)
// =============================================================================

interface FilaIncidenciaFalsa {
  id: string;
  tenant_id: string;
  pedido_id: string;
  seller_id: string;
  tipo: string;
  estado: string;
  afecta_cobro: boolean;
  afecta_liquidacion: boolean;
  descripcion: string | null;
  abierta_por_usuario_id: string | null;
}

function crearClienteFalso(opts: {
  estadoPedido: EstadoPedido | "no_existe";
  tenantIdReal?: string;
  tipoPedido?: string;
  driverIdAsignado?: string | null;
  mlShipmentIdReal?: string | null;
  incidenciasAbiertas?: FilaIncidenciaFalsa[];
  simularConflictoEnUpdate?: boolean;
}) {
  const ahora = new Date().toISOString();

  const pedido: Record<string, unknown> | null =
    opts.estadoPedido === "no_existe"
      ? null
      : {
          id: PEDIDO_1,
          tenant_id: opts.tenantIdReal ?? TENANT_A,
          seller_id: SELLER_1,
          tipo_pedido: opts.tipoPedido ?? "flex",
          estado: opts.estadoPedido,
          driver_id_asignado: opts.driverIdAsignado ?? null,
          ml_shipment_id: opts.mlShipmentIdReal ?? ML_SHIPMENT_1,
          tarifa_aplicable_id: null,
          fecha_compromiso_hora: null,
          fecha_compromiso: null,
          cancelado_en: null,
          cancelado_por_usuario_id: null,
          motivo_cancelacion: null,
          sla_cumplido: null,
          actualizado_en: ahora,
        };

  const incidencias: FilaIncidenciaFalsa[] = opts.incidenciasAbiertas ?? [];
  const asignaciones: Array<Record<string, unknown>> = [];
  let contadorIncidencia = 0;

  function from(tabla: string) {
    // ---- pedidos ----
    if (tabla === "pedidos") {
      return {
        select: (_cols?: string) => ({
          eq: (c: string, v: unknown) => ({
            eq: (c2: string, v2: unknown) => ({
              maybeSingle: async () => {
                if (!pedido) return { data: null, error: null };
                if (pedido[c] === v && pedido[c2] === v2) return { data: pedido, error: null };
                return { data: null, error: null };
              },
            }),
          }),
        }),
        update: (cambios: Record<string, unknown>) => ({
          eq: (c: string, v: unknown) => ({
            eq: (c2: string, v2: unknown) => ({
              eq: (c3: string, v3: unknown) => ({
                select: () => ({
                  single: async () => {
                    if (opts.simularConflictoEnUpdate) return { data: null, error: null };
                    if (!pedido) return { data: null, error: null };
                    if (pedido[c] !== v || pedido[c2] !== v2 || pedido[c3] !== v3) {
                      return { data: null, error: null };
                    }
                    Object.assign(pedido, cambios);
                    return { data: pedido, error: null };
                  },
                }),
              }),
            }),
          }),
        }),
      };
    }

    // ---- incidencias ----
    if (tabla === "incidencias") {
      return {
        select: (_cols?: string) => ({
          eq: (c: string, v: unknown) => ({
            eq: (c2: string, v2: unknown) => ({
              in: (_campo: string, valores: string[]) => ({
                limit: (n: number) => ({
                  then(resolve: (r: { data: FilaIncidenciaFalsa[]; error: null }) => void) {
                    const filtradas = incidencias.filter(
                      (i) =>
                        (i as unknown as Record<string, unknown>)[c] === v &&
                        (i as unknown as Record<string, unknown>)[c2] === v2 &&
                        valores.includes(i.estado),
                    );
                    resolve({ data: filtradas.slice(0, n), error: null });
                  },
                }),
              }),
            }),
          }),
        }),
        insert: (fila: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              const nueva: FilaIncidenciaFalsa = {
                id: `inc-auto-${++contadorIncidencia}`,
                tenant_id: fila.tenant_id as string,
                pedido_id: fila.pedido_id as string,
                seller_id: (fila.seller_id as string) ?? SELLER_1,
                tipo: fila.tipo as string,
                estado: fila.estado as string,
                afecta_cobro: fila.afecta_cobro as boolean,
                afecta_liquidacion: fila.afecta_liquidacion as boolean,
                descripcion: (fila.descripcion as string | null) ?? null,
                abierta_por_usuario_id: (fila.abierta_por_usuario_id as string | null) ?? null,
              };
              incidencias.push(nueva);
              return { data: nueva, error: null };
            },
          }),
        }),
      };
    }

    // ---- asignaciones_pedido ----
    if (tabla === "asignaciones_pedido") {
      return {
        update: (cambios: Record<string, unknown>) => {
          const filtros: Array<[string, unknown]> = [];
          function addEq(c: string, v: unknown) {
            filtros.push([c, v]);
            return chain;
          }
          const chain = {
            eq: addEq,
            then: (resolve: (r: { error: null }) => void) => {
              asignaciones.forEach((a, idx) => {
                if (filtros.every(([c, v]) => a[c] === v)) {
                  asignaciones[idx] = { ...a, ...cambios };
                }
              });
              resolve({ error: null });
            },
          };
          return chain;
        },
      };
    }

    throw new Error(`Tabla no soportada en doble de prueba: ${tabla}`);
  }

  return {
    cliente: { from } as never,
    pedido,
    incidencias,
    asignaciones,
  };
}

// =============================================================================
// 1. Camino feliz por estado de origen
// =============================================================================

describe("procesarCancelacionMl — pendiente_asignacion: cancela, sin incidencia nueva", () => {
  it("transiciona a 'cancelado', deja cancelado_por_usuario_id/motivo_cancelacion en null, y registra 'pedido.cancelado_por_ml'", async () => {
    const { cliente, pedido, incidencias } = crearClienteFalso({ estadoPedido: "pendiente_asignacion" });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const resultado = await handler({
      event: { data: EVENTO_BASE },
      step: stepFalso,
      logger: loggerFalso,
      runId: "run-1",
    });

    expect(pedido?.estado).toBe("cancelado");
    expect(pedido?.cancelado_por_usuario_id).toBeNull();
    expect(pedido?.motivo_cancelacion).toBeNull();
    expect(incidencias).toHaveLength(0);
    expect(resultado).toMatchObject({
      resultado: "cancelado",
      estadoAnterior: "pendiente_asignacion",
      incidenciaAbierta: false,
    });

    const entradas = vi.mocked(registrarEnBitacora).mock.calls.map((c) => c[1]);
    const entradaCancelacion = entradas.find((e) => e.accion === "pedido.cancelado_por_ml");
    expect(entradaCancelacion).toBeDefined();
    expect(entradaCancelacion?.actorTipo).toBe("sistema");
    expect(entradaCancelacion?.actorUsuarioId).toBeNull();
    expect(entradaCancelacion?.detalle).toMatchObject({
      ml_shipment_id: ML_SHIPMENT_1,
      estado_anterior_rutax: "pendiente_asignacion",
    });

    // Sin secretos en la bitácora.
    const json = JSON.stringify(entradaCancelacion).toLowerCase();
    expect(json).not.toContain("token");
    expect(json).not.toContain("password");
  });
});

describe("procesarCancelacionMl — asignado / en_ruta: cancela, abre incidencia y desactiva la asignación", () => {
  it("asignado → cancelado: abre incidencia de retiro pendiente y desactiva la asignación activa", async () => {
    const { cliente, pedido, incidencias, asignaciones } = crearClienteFalso({
      estadoPedido: "asignado",
      driverIdAsignado: DRIVER_1,
    });
    asignaciones.push({
      id: "asig-1",
      tenant_id: TENANT_A,
      pedido_id: PEDIDO_1,
      driver_id: DRIVER_1,
      activa: true,
      desasignado_en: null,
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const resultado = await handler({
      event: { data: { ...EVENTO_BASE, estadoAnterior: "asignado" } },
      step: stepFalso,
      logger: loggerFalso,
      runId: "run-1",
    });

    expect(pedido?.estado).toBe("cancelado");
    expect(asignaciones[0].activa).toBe(false);
    expect(asignaciones[0].desasignado_en).toBeTruthy();
    expect(incidencias).toHaveLength(1);
    expect(incidencias[0].tipo).toBe("otro");
    expect(incidencias[0].descripcion).toContain("devolución");
    expect(incidencias[0].seller_id).toBe(SELLER_1);
    expect(resultado).toMatchObject({ resultado: "cancelado", incidenciaAbierta: true });
  });

  it("en_ruta → cancelado: también abre incidencia de retiro pendiente", async () => {
    const { cliente, pedido, incidencias } = crearClienteFalso({
      estadoPedido: "en_ruta",
      driverIdAsignado: DRIVER_1,
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const resultado = await handler({
      event: { data: { ...EVENTO_BASE, estadoAnterior: "en_ruta" } },
      step: stepFalso,
      logger: loggerFalso,
      runId: "run-1",
    });

    expect(pedido?.estado).toBe("cancelado");
    expect(incidencias).toHaveLength(1);
    expect(resultado).toMatchObject({ resultado: "cancelado", incidenciaAbierta: true });
  });

  it("abrirIncidencia es idempotente: si ya había una incidencia abierta, no duplica", async () => {
    const incidenciaPrevia: FilaIncidenciaFalsa = {
      id: "inc-previa",
      tenant_id: TENANT_A,
      pedido_id: PEDIDO_1,
      seller_id: SELLER_1,
      tipo: "otro",
      estado: "abierta",
      afecta_cobro: true,
      afecta_liquidacion: true,
      descripcion: "Otra incidencia abierta antes de la cancelación",
      abierta_por_usuario_id: null,
    };
    const { cliente, incidencias } = crearClienteFalso({
      estadoPedido: "asignado",
      driverIdAsignado: DRIVER_1,
      incidenciasAbiertas: [incidenciaPrevia],
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    await handler({
      event: { data: { ...EVENTO_BASE, estadoAnterior: "asignado" } },
      step: stepFalso,
      logger: loggerFalso,
      runId: "run-1",
    });

    // Sigue habiendo UNA sola incidencia — abrirIncidencia devolvió la existente.
    expect(incidencias).toHaveLength(1);
    expect(incidencias[0].id).toBe("inc-previa");
  });
});

describe("procesarCancelacionMl — fallido / fallido_manual: cancela, sin incidencia nueva por este motivo", () => {
  it("fallido → cancelado: transiciona, no abre una incidencia de retiro (no es asignado/en_ruta)", async () => {
    const { cliente, pedido, incidencias } = crearClienteFalso({ estadoPedido: "fallido" });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const resultado = await handler({
      event: { data: { ...EVENTO_BASE, estadoAnterior: "fallido" } },
      step: stepFalso,
      logger: loggerFalso,
      runId: "run-1",
    });

    expect(pedido?.estado).toBe("cancelado");
    expect(incidencias).toHaveLength(0);
    expect(resultado).toMatchObject({ resultado: "cancelado", incidenciaAbierta: false });
  });

  it("fallido_manual → cancelado: transiciona (única transición nueva agregada a la máquina), sin incidencia nueva", async () => {
    const { cliente, pedido, incidencias } = crearClienteFalso({ estadoPedido: "fallido_manual" });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const resultado = await handler({
      event: { data: { ...EVENTO_BASE, estadoAnterior: "fallido_manual" } },
      step: stepFalso,
      logger: loggerFalso,
      runId: "run-1",
    });

    expect(pedido?.estado).toBe("cancelado");
    expect(incidencias).toHaveLength(0);
    expect(resultado).toMatchObject({ resultado: "cancelado" });
  });
});

// =============================================================================
// 2. Idempotencia — evento repetido
// =============================================================================

describe("procesarCancelacionMl — idempotencia: evento repetido", () => {
  it("segunda pasada sobre un pedido ya cancelado es no-op total: sin nueva bitácora ni nueva incidencia", async () => {
    const { cliente, incidencias } = crearClienteFalso({
      estadoPedido: "asignado",
      driverIdAsignado: DRIVER_1,
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const evento = { ...EVENTO_BASE, estadoAnterior: "asignado" };

    const primera = await handler({ event: { data: evento }, step: stepFalso, logger: loggerFalso, runId: "run-1" });
    expect(primera).toMatchObject({ resultado: "cancelado" });
    expect(incidencias).toHaveLength(1);

    const llamadasBitacoraTrasPrimera = vi.mocked(registrarEnBitacora).mock.calls.length;
    expect(llamadasBitacoraTrasPrimera).toBeGreaterThan(0);

    const segunda = await handler({ event: { data: evento }, step: stepFalso, logger: loggerFalso, runId: "run-2" });
    expect(segunda).toMatchObject({ resultado: "ya_cancelado" });

    // Ni nueva bitácora ni nueva incidencia en la segunda pasada.
    expect(vi.mocked(registrarEnBitacora).mock.calls.length).toBe(llamadasBitacoraTrasPrimera);
    expect(incidencias).toHaveLength(1);
  });
});

// =============================================================================
// 3. Carrera — ErrorConflicto tratado como no-op
// =============================================================================

describe("procesarCancelacionMl — carrera con otra invocación concurrente", () => {
  it("ErrorConflicto (optimistic locking) se captura como no-op: no lanza y no abre incidencia desde la invocación perdedora", async () => {
    const { cliente, incidencias } = crearClienteFalso({
      estadoPedido: "asignado",
      driverIdAsignado: DRIVER_1,
      simularConflictoEnUpdate: true,
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const resultado = await handler({
      event: { data: { ...EVENTO_BASE, estadoAnterior: "asignado" } },
      step: stepFalso,
      logger: loggerFalso,
      runId: "run-1",
    });

    expect(resultado).toMatchObject({ resultado: "conflicto_concurrente", incidenciaAbierta: false });
    expect(incidencias).toHaveLength(0);
  });
});

// =============================================================================
// 4. Estados terminales previos — anomalía, sin romper el invariante
// =============================================================================

describe("procesarCancelacionMl — pedido ya en un estado terminal distinto de 'cancelado'", () => {
  it("pedido 'entregado': NO transiciona, registra 'pedido.cancelacion_ml_no_reflejada', sin lanzar", async () => {
    const { cliente, pedido } = crearClienteFalso({ estadoPedido: "entregado" });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const resultado = await handler({
      event: { data: EVENTO_BASE },
      step: stepFalso,
      logger: loggerFalso,
      runId: "run-1",
    });

    expect(pedido?.estado).toBe("entregado"); // sin cambios — invariante de terminal preservado
    expect(resultado).toMatchObject({
      resultado: "terminal_previo_no_reflejado",
      estadoActual: "entregado",
    });

    const entradas = vi.mocked(registrarEnBitacora).mock.calls.map((c) => c[1]);
    const anomalia = entradas.find((e) => e.accion === "pedido.cancelacion_ml_no_reflejada");
    expect(anomalia).toBeDefined();
    expect(anomalia?.actorTipo).toBe("sistema");
  });

  it("pedido 'devuelto': mismo tratamiento (anomalía, sin transición)", async () => {
    const { cliente, pedido } = crearClienteFalso({ estadoPedido: "devuelto" });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const resultado = await handler({
      event: { data: EVENTO_BASE },
      step: stepFalso,
      logger: loggerFalso,
      runId: "run-1",
    });

    expect(pedido?.estado).toBe("devuelto");
    expect(resultado).toMatchObject({ resultado: "terminal_previo_no_reflejado", estadoActual: "devuelto" });
  });
});

// =============================================================================
// 5. Pedido no encontrado / aislamiento multi-tenant
// =============================================================================

describe("procesarCancelacionMl — pedido no encontrado (defensivo)", () => {
  it("pedido inexistente en BD: no-op, sin lanzar y sin auditar", async () => {
    const { cliente } = crearClienteFalso({ estadoPedido: "no_existe" });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const resultado = await handler({
      event: { data: EVENTO_BASE },
      step: stepFalso,
      logger: loggerFalso,
      runId: "run-1",
    });

    expect(resultado).toMatchObject({ resultado: "pedido_no_encontrado" });
    expect(registrarEnBitacora).not.toHaveBeenCalled();
  });

  it("pedido existe pero en OTRO tenant: se trata como no encontrado (aislamiento — nunca cruza tenant)", async () => {
    const { cliente, pedido } = crearClienteFalso({ estadoPedido: "asignado", tenantIdReal: TENANT_B });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    // El evento dice TENANT_A, pero la fila real es de TENANT_B.
    const resultado = await handler({
      event: { data: { ...EVENTO_BASE, tenantId: TENANT_A } },
      step: stepFalso,
      logger: loggerFalso,
      runId: "run-1",
    });

    expect(resultado).toMatchObject({ resultado: "pedido_no_encontrado" });
    expect(pedido?.estado).toBe("asignado"); // el pedido de TENANT_B queda intacto
  });
});

// =============================================================================
// 6. Bitácora ANTES del efecto + trazabilidad del substatus de ML
// =============================================================================

describe("procesarCancelacionMl — bitácora antes que el efecto (invariante CLAUDE.md)", () => {
  it("registrarEnBitacora se llama con el pedido TODAVÍA sin cancelar (antes del UPDATE)", async () => {
    const { cliente, pedido } = crearClienteFalso({ estadoPedido: "pendiente_asignacion" });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    let estadoAlMomentoDeAuditar: unknown;
    vi.mocked(registrarEnBitacora).mockImplementation(async (_cliente, entrada) => {
      if (entrada.accion === "pedido.cancelado_por_ml") {
        estadoAlMomentoDeAuditar = pedido?.estado;
      }
    });

    await handler({ event: { data: EVENTO_BASE }, step: stepFalso, logger: loggerFalso, runId: "run-1" });

    expect(estadoAlMomentoDeAuditar).toBe("pendiente_asignacion");
    expect(pedido?.estado).toBe("cancelado"); // al terminar el handler, ya cambió
  });

  it("el detalle de bitácora incluye el substatus de ML reportado, sin consultar a ML", async () => {
    const { cliente } = crearClienteFalso({ estadoPedido: "pendiente_asignacion" });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    await handler({
      event: { data: { ...EVENTO_BASE, substatusMl: "seller_cancelled" } },
      step: stepFalso,
      logger: loggerFalso,
      runId: "run-1",
    });

    const entradas = vi.mocked(registrarEnBitacora).mock.calls.map((c) => c[1]);
    const entradaCancelacion = entradas.find((e) => e.accion === "pedido.cancelado_por_ml");
    expect(entradaCancelacion?.detalle).toMatchObject({ substatus_ml: "seller_cancelled" });
  });

  it("ml_shipment_id del pedido distinto del evento: solo advierte (logger.warn), no bloquea la cancelación", async () => {
    const { cliente, pedido } = crearClienteFalso({
      estadoPedido: "pendiente_asignacion",
      mlShipmentIdReal: "ML-SHP-OTRO",
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const resultado = await handler({
      event: { data: EVENTO_BASE }, // mlShipmentId = ML_SHIPMENT_1, distinto de 'ML-SHP-OTRO'
      step: stepFalso,
      logger: loggerFalso,
      runId: "run-1",
    });

    expect(pedido?.estado).toBe("cancelado");
    expect(resultado).toMatchObject({ resultado: "cancelado" });
    expect(loggerFalso.warn).toHaveBeenCalled();
  });
});

// =============================================================================
// 7. Integración real con el motor de dinero (C1) — sin reimplementar su lógica
// =============================================================================

/**
 * Doble de prueba del cliente Supabase para `dinero/jobs/generar-lineas.ts`,
 * adaptado de `dinero/jobs/generar-lineas-handler.test.ts` (mismas claves
 * `schema.tabla`, mismos spies) — acotado a lo que el paso 'anular-lineas-si-
 * devolucion' necesita para el caso 'cancelado'. Se duplica aquí (en vez de
 * importarlo) porque ese helper no está exportado — mismo patrón que ya usan
 * otros archivos de test de este repo (cada test file arma su propio doble).
 */
interface ConfigClienteDinero {
  lineaCobro?: Record<string, unknown> | null;
  periodoCobro?: Record<string, unknown> | null;
  lineaLiquidacion?: Record<string, unknown> | null;
  liquidacion?: Record<string, unknown> | null;
  eventoConciliacionExistente?: Record<string, unknown> | null;
}

function crearClienteDinero(config: ConfigClienteDinero) {
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
        return { data: null, error: null };
      case "operacion.incidencias":
        return { data: null, error: null };
      case "identidad.tenants":
        return { data: null, error: null };
      case "operacion.pedidos":
        return { data: null, error: null };
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

describe("integración con dinero (C1) — el evento que publica este job dispara la anulación/excepción YA existente", () => {
  it("línea de cobro en período 'abierto': C1 la anula con motivo_anulacion='cancelacion'", async () => {
    // --- Fase 1: procesarCancelacionMl cancela el pedido y publica el evento financiero.
    const { cliente: clienteOperacion } = crearClienteFalso({ estadoPedido: "pendiente_asignacion" });
    vi.mocked(crearClienteServiceRole).mockReturnValue(clienteOperacion);

    await handler({ event: { data: EVENTO_BASE }, step: stepFalso, logger: loggerFalso, runId: "run-op" });

    const datosEvento = extraerEventoPublicado("dinero/pedido.estado_financiero_relevante").data;
    expect(datosEvento).toMatchObject({ pedidoId: PEDIDO_1, tenantId: TENANT_A, estadoNuevo: "cancelado" });

    // --- Fase 2: ese MISMO evento, procesado por el job REAL de dinero (C1).
    const { cliente: clienteDinero, spies } = crearClienteDinero({
      lineaCobro: { id: "linea-cobro-1", anulada: false, periodo_cobro_id: "periodo-1" },
      periodoCobro: { estado: "abierto" },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(clienteDinero as never);

    const resultadoC1 = await handlerDinero({
      event: { data: datosEvento },
      step: stepFalso,
      logger: loggerFalso,
      runId: "run-c1",
    });

    expect(spies.updateLineaCobro).toHaveBeenCalledOnce();
    expect(spies.updateLineaCobro.mock.calls[0][0]).toMatchObject({
      anulada: true,
      motivo_anulacion: "cancelacion",
    });
    expect(spies.insertEventoConciliacion).not.toHaveBeenCalled();
    expect(resultadoC1).toMatchObject({ generaCobro: false, generaLiquidacion: false, anuloCobro: true });
  });

  it("línea de cobro en período 'facturado': C1 NO la toca y levanta la excepción bloqueante en la bandeja de conciliación", async () => {
    const { cliente: clienteOperacion } = crearClienteFalso({ estadoPedido: "en_ruta", driverIdAsignado: DRIVER_1 });
    vi.mocked(crearClienteServiceRole).mockReturnValue(clienteOperacion);

    await handler({
      event: { data: { ...EVENTO_BASE, estadoAnterior: "en_ruta" } },
      step: stepFalso,
      logger: loggerFalso,
      runId: "run-op",
    });

    const datosEvento = extraerEventoPublicado("dinero/pedido.estado_financiero_relevante").data;

    const { cliente: clienteDinero, spies } = crearClienteDinero({
      lineaCobro: { id: "linea-cobro-2", anulada: false, periodo_cobro_id: "periodo-2" },
      periodoCobro: { estado: "facturado" },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(clienteDinero as never);

    const resultadoC1 = await handlerDinero({
      event: { data: datosEvento },
      step: stepFalso,
      logger: loggerFalso,
      runId: "run-c1",
    });

    // La línea NO se toca — el pedido queda cancelado, la línea sigue viva.
    expect(spies.updateLineaCobro).not.toHaveBeenCalled();
    expect(spies.insertEventoConciliacion).toHaveBeenCalledOnce();
    const eventoInsertado = spies.insertEventoConciliacion.mock.calls[0][0] as Record<string, unknown>;
    expect(eventoInsertado).toMatchObject({
      tipo_diferencia: "linea_cobro_sin_pedido_entregado",
      bloquea_facturacion: true,
      bloquea_pago: false,
      pedido_id: PEDIDO_1,
    });
    expect(resultadoC1).toMatchObject({ anuloCobro: false });
  });

  it("línea de liquidación 'pagada': C1 NO la toca y levanta la excepción con bloquea_pago=true (conductor ya cobrado)", async () => {
    const { cliente: clienteOperacion } = crearClienteFalso({ estadoPedido: "asignado", driverIdAsignado: DRIVER_1 });
    vi.mocked(crearClienteServiceRole).mockReturnValue(clienteOperacion);

    await handler({
      event: { data: { ...EVENTO_BASE, estadoAnterior: "asignado" } },
      step: stepFalso,
      logger: loggerFalso,
      runId: "run-op",
    });

    const datosEvento = extraerEventoPublicado("dinero/pedido.estado_financiero_relevante").data;

    const { cliente: clienteDinero, spies } = crearClienteDinero({
      lineaLiquidacion: { id: "linea-liq-1", anulada: false, liquidacion_id: "liq-1", driver_id: DRIVER_1 },
      liquidacion: { estado: "pagada" },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(clienteDinero as never);

    await handlerDinero({
      event: { data: datosEvento },
      step: stepFalso,
      logger: loggerFalso,
      runId: "run-c1",
    });

    expect(spies.updateLineaLiquidacion).not.toHaveBeenCalled();
    expect(spies.insertEventoConciliacion).toHaveBeenCalledOnce();
    expect(spies.insertEventoConciliacion.mock.calls[0][0]).toMatchObject({
      tipo_diferencia: "linea_liquidacion_sin_pedido_entregado",
      bloquea_pago: true,
      bloquea_facturacion: false,
      driver_id: DRIVER_1,
    });
  });
});
