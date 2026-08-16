/**
 * Pruebas del consumidor `operacion/procesarCancelacionFuente` — job que
 * refleja en Rutax una cancelación DETECTADA en una fuente externa distinta de
 * Mercado Libre (hoy solo Shopify, evento `operacion/pedido.cancelado-en-fuente`).
 *
 * No repite las 18 pruebas de `procesar-cancelacion-ml.test.ts` — ambos jobs
 * comparten núcleo (`cancelacion-fuente-compartida.ts`), así que ese archivo ya
 * cubre exhaustivamente la máquina de estados, la carrera de optimistic
 * locking y la integración con el motor de dinero (C1). Este archivo se acota
 * a lo que es propio de ESTA envoltura: el mapeo del vocabulario source-neutral
 * (`fuente`, `idExterno`) a la identidad de bitácora, y sobre todo — el
 * requisito explícito de la tarea — que la bitácora de un pedido Shopify NUNCA
 * diga "Mercado Libre".
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
import { jobProcesarCancelacionFuente } from "./procesar-cancelacion-fuente";
import type { EstadoPedido } from "../tipos";

type CtxHandler = {
  event: { data: Record<string, unknown> };
  step: { run: <T>(label: string, fn: () => Promise<T>) => Promise<T> };
  logger: { info: (m: string) => void; warn: (m: string) => void };
  runId: string;
};

const handler = (
  jobProcesarCancelacionFuente as unknown as { handler: (ctx: CtxHandler) => Promise<Record<string, unknown>> }
).handler;

const stepFalso = {
  run: <T>(_label: string, fn: () => Promise<T>): Promise<T> => fn(),
};
const loggerFalso = { info: vi.fn(), warn: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(registrarEnBitacora).mockReset();
  vi.mocked(registrarEnBitacora).mockResolvedValue(undefined);
});

// =============================================================================
// Fixtures
// =============================================================================

const TENANT_A = "aaaa0000-0000-0000-0000-aaaaaaaaaaaa";
const PEDIDO_1 = "bbbb0000-0000-0000-0000-bbbbbbbbbbbb";
const SELLER_1 = "cccc0000-0000-0000-0000-cccccccccccc";
const DRIVER_1 = "dddd0000-0000-0000-0000-dddddddddddd";
const ID_EXTERNO_1 = "gid://shopify/Order/5123456789012";

const EVENTO_BASE = {
  pedidoId: PEDIDO_1,
  tenantId: TENANT_A,
  sellerId: SELLER_1,
  fuente: "shopify" as const,
  idExterno: ID_EXTERNO_1,
  referenciaExterna: "#1001",
  estadoAnterior: "asignado",
  canceladoEnFuenteEn: "2026-08-16T12:00:00.000Z",
};

// =============================================================================
// Doble de prueba del cliente Supabase — mismo molde que
// procesar-cancelacion-ml.test.ts, acotado a lo que este job necesita.
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
  idExternoReal?: string | null;
  driverIdAsignado?: string | null;
  incidenciasAbiertas?: FilaIncidenciaFalsa[];
}) {
  const pedido: Record<string, unknown> | null =
    opts.estadoPedido === "no_existe"
      ? null
      : {
          id: PEDIDO_1,
          tenant_id: TENANT_A,
          seller_id: SELLER_1,
          tipo_pedido: "same_day",
          estado: opts.estadoPedido,
          driver_id_asignado: opts.driverIdAsignado ?? null,
          id_externo: opts.idExternoReal ?? ID_EXTERNO_1,
          cancelado_en: null,
          cancelado_por_usuario_id: null,
          motivo_cancelacion: null,
          sla_cumplido: null,
          actualizado_en: new Date().toISOString(),
        };

  const incidencias: FilaIncidenciaFalsa[] = opts.incidenciasAbiertas ?? [];
  const asignaciones: Array<Record<string, unknown>> = opts.driverIdAsignado
    ? [
        {
          id: "asig-1",
          tenant_id: TENANT_A,
          pedido_id: PEDIDO_1,
          driver_id: opts.driverIdAsignado,
          activa: true,
          desasignado_en: null,
        },
      ]
    : [];
  let contadorIncidencia = 0;

  function from(tabla: string) {
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

  return { cliente: { from } as never, pedido, incidencias, asignaciones };
}

// =============================================================================
// 1. Camino feliz — con y sin incidencia de retiro
// =============================================================================

describe("procesarCancelacionFuente — pendiente_asignacion: cancela, sin incidencia", () => {
  it("transiciona a 'cancelado' y registra 'pedido.cancelado_por_fuente_externa' con la fuente real", async () => {
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
    const entradaCancelacion = entradas.find((e) => e.accion === "pedido.cancelado_por_fuente_externa");
    expect(entradaCancelacion).toBeDefined();
    expect(entradaCancelacion?.actorTipo).toBe("sistema");
    expect(entradaCancelacion?.actorUsuarioId).toBeNull();
    expect(entradaCancelacion?.detalle).toMatchObject({
      fuente: "shopify",
      id_externo: ID_EXTERNO_1,
      referencia_externa: "#1001",
      estado_anterior_rutax: "pendiente_asignacion",
    });

    // La regla explícita de la tarea: NUNCA "lo canceló Mercado Libre".
    const json = JSON.stringify(entradas).toLowerCase();
    expect(json).not.toContain("mercado libre");
    expect(json).not.toContain("_por_ml");
    expect(json).not.toContain("ml_shipment_id");
    expect(json).not.toContain("token");
    expect(json).not.toContain("password");
  });
});

describe("procesarCancelacionFuente — asignado/en_ruta: cancela, abre incidencia y desactiva la asignación", () => {
  it("asignado → cancelado: abre incidencia mencionando Shopify, y desactiva la asignación", async () => {
    const { cliente, pedido, incidencias, asignaciones } = crearClienteFalso({
      estadoPedido: "asignado",
      driverIdAsignado: DRIVER_1,
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
    expect(incidencias).toHaveLength(1);
    expect(incidencias[0].descripcion).toContain("Shopify");
    expect(incidencias[0].descripcion).toContain("devolución");
    expect(resultado).toMatchObject({ resultado: "cancelado", incidenciaAbierta: true });
  });
});

// =============================================================================
// 2. Idempotencia
// =============================================================================

describe("procesarCancelacionFuente — idempotencia: evento repetido", () => {
  it("segunda pasada sobre un pedido ya cancelado es no-op total", async () => {
    const { cliente, incidencias } = crearClienteFalso({
      estadoPedido: "asignado",
      driverIdAsignado: DRIVER_1,
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const evento = { ...EVENTO_BASE, estadoAnterior: "asignado" };

    const primera = await handler({ event: { data: evento }, step: stepFalso, logger: loggerFalso, runId: "run-1" });
    expect(primera).toMatchObject({ resultado: "cancelado" });
    expect(incidencias).toHaveLength(1);

    const llamadasTrasPrimera = vi.mocked(registrarEnBitacora).mock.calls.length;

    const segunda = await handler({ event: { data: evento }, step: stepFalso, logger: loggerFalso, runId: "run-2" });
    expect(segunda).toMatchObject({ resultado: "ya_cancelado" });

    expect(vi.mocked(registrarEnBitacora).mock.calls.length).toBe(llamadasTrasPrimera);
    expect(incidencias).toHaveLength(1);
  });
});

// =============================================================================
// 3. Estados terminales previos — anomalía, sin romper el invariante
// =============================================================================

describe("procesarCancelacionFuente — pedido ya en un estado terminal distinto de 'cancelado'", () => {
  it("pedido 'entregado': NO transiciona, registra 'pedido.cancelacion_fuente_no_reflejada'", async () => {
    const { cliente, pedido } = crearClienteFalso({ estadoPedido: "entregado" });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const resultado = await handler({
      event: { data: EVENTO_BASE },
      step: stepFalso,
      logger: loggerFalso,
      runId: "run-1",
    });

    expect(pedido?.estado).toBe("entregado");
    expect(resultado).toMatchObject({ resultado: "terminal_previo_no_reflejado", estadoActual: "entregado" });

    const entradas = vi.mocked(registrarEnBitacora).mock.calls.map((c) => c[1]);
    const anomalia = entradas.find((e) => e.accion === "pedido.cancelacion_fuente_no_reflejada");
    expect(anomalia).toBeDefined();
    expect(anomalia?.detalle).toMatchObject({ fuente: "shopify" });
  });
});

// =============================================================================
// 4. Pedido no encontrado (defensivo)
// =============================================================================

describe("procesarCancelacionFuente — pedido no encontrado", () => {
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
});

// =============================================================================
// 5. Bitácora ANTES del efecto (invariante CLAUDE.md)
// =============================================================================

describe("procesarCancelacionFuente — bitácora antes que el efecto", () => {
  it("registrarEnBitacora se llama con el pedido TODAVÍA sin cancelar", async () => {
    const { cliente, pedido } = crearClienteFalso({ estadoPedido: "pendiente_asignacion" });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    let estadoAlMomentoDeAuditar: unknown;
    vi.mocked(registrarEnBitacora).mockImplementation(async (_cliente, entrada) => {
      if (entrada.accion === "pedido.cancelado_por_fuente_externa") {
        estadoAlMomentoDeAuditar = pedido?.estado;
      }
    });

    await handler({ event: { data: EVENTO_BASE }, step: stepFalso, logger: loggerFalso, runId: "run-1" });

    expect(estadoAlMomentoDeAuditar).toBe("pendiente_asignacion");
    expect(pedido?.estado).toBe("cancelado");
  });

  it("id_externo del pedido distinto del evento: solo advierte, no bloquea la cancelación", async () => {
    const { cliente, pedido } = crearClienteFalso({
      estadoPedido: "pendiente_asignacion",
      idExternoReal: "gid://shopify/Order/OTRO",
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const resultado = await handler({
      event: { data: EVENTO_BASE }, // idExterno = ID_EXTERNO_1, distinto de 'gid://shopify/Order/OTRO'
      step: stepFalso,
      logger: loggerFalso,
      runId: "run-1",
    });

    expect(pedido?.estado).toBe("cancelado");
    expect(resultado).toMatchObject({ resultado: "cancelado" });
    expect(loggerFalso.warn).toHaveBeenCalled();
  });
});
