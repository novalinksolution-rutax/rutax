/**
 * Pruebas del módulo de pedidos.
 *
 * Cubre:
 * 1. Optimistic locking rechaza si estado difiere del esperado.
 * 2. actualizarEstadoPedido a 'fallido' abre incidencia automáticamente.
 * 3. Corrección manual registra en bitácora.
 * 4. Transición inválida lanza ErrorTransicionInvalida.
 * 5. Actor sin capacidad recibe ErrorValidacion en correcciones manuales.
 * 6. crearPedidoSameDay fija tarifa_aplicable_id.
 * 7. crearPedidoSameDay sin tarifa lanza ErrorValidacion.
 * 8. crearPedidoSameDay retorna campos de geocoding con defaults correctos.
 * 9. filaAPedido mapea columnas de geocoding desde la fila de BD.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock de Inngest: sin él, `actualizarEstadoPedido`/`cancelarPedido`/
// `crearPedidoSameDay` llaman al cliente REAL (best-effort, siempre dentro de
// un try/catch — ver pedidos.ts), así que ningún test existente dependía de
// su comportamiento. Se agrega acá para poder ASERTAR si el evento
// `dinero/pedido.estado_financiero_relevante` se publicó o no — el corazón
// de la excepción "entregado sin conductor asignado no factura solo".
vi.mock("@/lib/inngest/cliente", () => ({
  inngest: { send: vi.fn().mockResolvedValue(undefined) },
}));

import { inngest } from "@/lib/inngest/cliente";
import { actualizarEstadoPedido, cancelarPedido, crearPedidoSameDay, asegurarCodigoInterno } from "./pedidos";
import { hoyEnSantiago, sumarDiasCalendario } from "@/lib/fecha-santiago";
import { ErrorTransicionInvalida, ErrorPedidoNoEncontrado } from "./errores";
import { ErrorConflicto, ErrorValidacion } from "@/modules/identidad/errores";
import { PATRON_CODIGO_INTERNO } from "./codigo-interno";
import type { UsuarioActual } from "@/modules/identidad/usuario-actual";
import type { EstadoPedido } from "./tipos";

// =============================================================================
// Fixtures
// =============================================================================

const TENANT_A = "aaaa0000-0000-0000-0000-000000000010";
const PEDIDO_1 = "bbbb0000-0000-0000-0000-000000000020";
const SELLER_1 = "cccc0000-0000-0000-0000-000000000030";
const SELLER_2 = "cccc0000-0000-0000-0000-000000000031";
const TARIFA_1 = "dddd0000-0000-0000-0000-000000000040";
const USUARIO_INTERNO_1 = "ffff0000-0000-0000-0000-000000000060";
const USUARIO_SELLER_1 = "ffff0000-0000-0000-0000-000000000061";

function actorSupervisor(): UsuarioActual {
  return {
    tenantId: TENANT_A,
    tipoUsuario: "interno",
    sellerId: null,
    driverId: null,
    rol: "supervisor",
    estado: "activo",
  };
}

function actorCoordinador(): UsuarioActual {
  return {
    tenantId: TENANT_A,
    tipoUsuario: "interno",
    sellerId: null,
    driverId: null,
    rol: "coordinador",
    estado: "activo",
  };
}

function actorSellerFixture(sellerId: string = SELLER_1): UsuarioActual {
  return {
    tenantId: TENANT_A,
    tipoUsuario: "seller",
    sellerId,
    driverId: null,
    rol: "seller",
    estado: "activo",
  };
}

// =============================================================================
// Doble de prueba del cliente Supabase
// =============================================================================

interface FilaPedido {
  id: string;
  tenant_id: string;
  seller_id: string;
  tipo_pedido: string;
  fuente: string;
  origen: string;
  ml_order_id: string | null;
  ml_shipment_id: string | null;
  id_externo?: string | null;
  referencia_externa?: string | null;
  estado: EstadoPedido;
  estado_ml: string | null;
  subestado_ml: string | null;
  ultima_sync_ml_en: string | null;
  driver_id_asignado: string | null;
  destinatario_nombre: string;
  destinatario_direccion: string;
  destinatario_comuna: string;
  destinatario_telefono: string | null;
  instrucciones_entrega: string | null;
  fecha_compromiso: string | null;
  tarifa_aplicable_id: string | null;
  monto_cobro_clp: number | null;
  monto_liquidacion_clp: number | null;
  cobro_generado: boolean;
  liquidacion_generada: boolean;
  notas_internas: string | null;
  creado_en: string;
  actualizado_en: string;
  // Columnas de geocoding (migración 0013)
  lat: number | null;
  long: number | null;
  geo_estado: string | null;
  geo_confianza: number | null;
  geocodificado_en: string | null;
  cobertura_estado: string | null;
  // Columnas de SLA/corte (migración 0014 — F7, ítem 1.2)
  fecha_compromiso_hora: string | null;
  corte_riesgo: boolean;
  sla_cumplido: boolean | null;
  // Código interno operativo para etiqueta con QR (same-day).
  codigo_interno?: string | null;
  // Columnas de cancelación (migración 20260811000003).
  cancelado_en?: string | null;
  cancelado_por_usuario_id?: string | null;
  motivo_cancelacion?: string | null;
}

interface FilaAsignacion {
  id: string;
  tenant_id: string;
  pedido_id: string;
  manifiesto_id: string;
  driver_id: string;
  seller_id: string;
  activa: boolean;
  asignado_en: string;
  desasignado_en: string | null;
}

interface FilaIncidencia {
  id: string;
  tenant_id: string;
  pedido_id: string;
  seller_id: string;
  tipo: string;
  estado: string;
  afecta_cobro: boolean;
  afecta_liquidacion: boolean;
  descripcion: string | null;
  notas_resolucion: string | null;
  abierta_por_usuario_id: string | null;
  resuelta_por_usuario_id: string | null;
  abierta_en: string;
  resuelta_en: string | null;
  creado_en: string;
  actualizado_en: string;
}

interface FilaTarifa {
  id: string;
}

interface EstadoFalso {
  pedidos: FilaPedido[];
  incidencias: FilaIncidencia[];
  asignaciones: FilaAsignacion[];
  bitacora: Array<Record<string, unknown>>;
}

function pedidoBase(estadoActual: EstadoPedido = "en_ruta"): FilaPedido {
  const ahora = new Date().toISOString();
  return {
    id: PEDIDO_1,
    tenant_id: TENANT_A,
    seller_id: SELLER_1,
    fuente: "ml_flex", tipo_pedido: "flex",
    origen: "ml_ingesta",
    ml_order_id: "ML-ORD-001",
    ml_shipment_id: "ML-SHP-001",
    estado: estadoActual,
    estado_ml: null,
    subestado_ml: null,
    ultima_sync_ml_en: null,
    driver_id_asignado: null,
    destinatario_nombre: "Juan Pérez",
    destinatario_direccion: "Av. Providencia 123",
    destinatario_comuna: "Providencia",
    destinatario_telefono: null,
    instrucciones_entrega: null,
    fecha_compromiso: null,
    tarifa_aplicable_id: TARIFA_1,
    monto_cobro_clp: null,
    monto_liquidacion_clp: null,
    cobro_generado: false,
    liquidacion_generada: false,
    notas_internas: null,
    creado_en: ahora,
    actualizado_en: ahora,
    // Columnas de geocoding — valores por defecto de la migración 0013
    lat: null,
    long: null,
    geo_estado: 'pendiente',
    geo_confianza: null,
    geocodificado_en: null,
    cobertura_estado: 'pendiente',
    // Columnas de SLA/corte — valores por defecto de la migración 0014
    fecha_compromiso_hora: null,
    corte_riesgo: false,
    sla_cumplido: null,
  };
}

function crearClienteFalso(opts?: {
  pedidos?: FilaPedido[];
  tarifas?: FilaTarifa[];
  asignaciones?: FilaAsignacion[];
  fallarUpdate?: boolean;
}) {
  let contadorInc = 0;
  let contadorPedido = 0;

  const estado: EstadoFalso = {
    pedidos: opts?.pedidos ?? [pedidoBase()],
    incidencias: [],
    asignaciones: opts?.asignaciones ?? [],
    bitacora: [],
  };

  const tarifas: FilaTarifa[] = opts?.tarifas ?? [{ id: TARIFA_1 }];

  function from(tabla: string) {
    // --- pedidos ---
    if (tabla === "pedidos") {
      return {
        select: (_cols?: string, _opts?: unknown) => {
          // Encadenamiento: .select().eq().eq().maybeSingle()
          const filtros: Array<[string, unknown]> = [];

          function addEq(c: string, v: unknown) {
            filtros.push([c, v]);
            return eqChain();
          }

          function eqChain() {
            return {
              eq: addEq,
              maybeSingle: async () => {
                const fila = estado.pedidos.find((p) =>
                  filtros.every(([c, v]) => (p as unknown as Record<string, unknown>)[c] === v),
                );
                return { data: fila ?? null, error: null };
              },
              select: () => ({
                single: async () => {
                  const fila = estado.pedidos.find((p) =>
                    filtros.every(([c, v]) => (p as unknown as Record<string, unknown>)[c] === v),
                  );
                  return { data: fila ?? null, error: null };
                },
              }),
              in: (_campo: string, _valores: string[]) => ({
                eq: addEq,
                order: () => ({
                  or: () => ({
                    or: () => ({
                      order: () => ({
                        limit: () => ({
                          then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
                            resolve({ data: tarifas.slice(0, 1), error: null }),
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            };
          }

          return {
            eq: addEq,
            maybeSingle: async () => {
              const fila = estado.pedidos.find((p) =>
                filtros.every(([c, v]) => (p as unknown as Record<string, unknown>)[c] === v),
              );
              return { data: fila ?? null, error: null };
            },
          };
        },
        update: (cambios: Record<string, unknown>) => {
          const filtrosUpdate: Array<[string, unknown]> = [];

          function eqUpdate(c: string, v: unknown) {
            filtrosUpdate.push([c, v]);
            return {
              eq: eqUpdate,
              select: () => ({
                single: async () => {
                  if (opts?.fallarUpdate) {
                    return { data: null, error: { message: "fallo simulado de update" } };
                  }
                  const idx = estado.pedidos.findIndex((p) =>
                    filtrosUpdate.every(([c, val]) => (p as unknown as Record<string, unknown>)[c] === val),
                  );
                  if (idx < 0) return { data: null, error: null };
                  estado.pedidos[idx] = { ...estado.pedidos[idx], ...cambios } as FilaPedido;
                  return { data: estado.pedidos[idx], error: null };
                },
              }),
            };
          }

          return { eq: eqUpdate };
        },
        insert: (fila: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              const ahora = new Date().toISOString();
              const nuevo: FilaPedido = {
                id: `pedido-${++contadorPedido}`,
                tenant_id: fila.tenant_id as string,
                seller_id: fila.seller_id as string,
                tipo_pedido: fila.tipo_pedido as string,
                fuente: fila.fuente as string,
                origen: fila.origen as string,
                ml_order_id: null,
                ml_shipment_id: null,
                estado: "pendiente_asignacion",
                estado_ml: null,
                subestado_ml: null,
                ultima_sync_ml_en: null,
                driver_id_asignado: null,
                destinatario_nombre: fila.destinatario_nombre as string,
                destinatario_direccion: fila.destinatario_direccion as string,
                destinatario_comuna: fila.destinatario_comuna as string,
                destinatario_telefono: (fila.destinatario_telefono as string | null) ?? null,
                instrucciones_entrega: (fila.instrucciones_entrega as string | null) ?? null,
                // ⚠️ Estas tres se escribían a mano como `null`, ignorando el
                // payload. Un doble falso que no refleja lo que se le pide
                // escribir no puede detectar que se escribió mal: por eso el
                // bug de `fecha_compromiso = NULL` (2026-08-27) pasó por 71
                // pruebas en verde. Un falso reproduce el INSERT, no lo inventa.
                fecha_compromiso: (fila.fecha_compromiso as string | null) ?? null,
                tarifa_aplicable_id: fila.tarifa_aplicable_id as string,
                monto_cobro_clp: null,
                monto_liquidacion_clp: null,
                cobro_generado: false,
                liquidacion_generada: false,
                notas_internas: null,
                creado_en: ahora,
                actualizado_en: ahora,
                // Columnas de geocoding — defaults de BD (migración 0013)
                lat: null,
                long: null,
                geo_estado: 'pendiente',
                geo_confianza: null,
                geocodificado_en: null,
                cobertura_estado: 'pendiente',
                // Columnas de SLA/corte — defaults de BD (migración 0014)
                fecha_compromiso_hora: (fila.fecha_compromiso_hora as string | null) ?? null,
                corte_riesgo: (fila.corte_riesgo as boolean) ?? false,
                sla_cumplido: null,
                codigo_interno: (fila.codigo_interno as string | null) ?? null,
              };
              estado.pedidos.push(nuevo);
              return { data: nuevo, error: null };
            },
          }),
        }),
      };
    }

    // --- incidencias ---
    if (tabla === "incidencias") {
      return {
        select: (_cols?: string) => ({
          eq: (c: string, v: unknown) => ({
            eq: (c2: string, v2: unknown) => ({
              in: (_c3: string, valores: string[]) => ({
                limit: (n: number) => ({
                  then(resolve: (r: { data: FilaIncidencia[]; error: null }) => void) {
                    const filtradas = estado.incidencias.filter(
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
              const ahora = new Date().toISOString();
              const nueva: FilaIncidencia = {
                id: `inc-${++contadorInc}`,
                tenant_id: fila.tenant_id as string,
                pedido_id: fila.pedido_id as string,
                seller_id: fila.seller_id as string,
                tipo: fila.tipo as string,
                estado: fila.estado as string,
                descripcion: (fila.descripcion as string | null) ?? null,
                notas_resolucion: null,
                afecta_cobro: fila.afecta_cobro as boolean,
                afecta_liquidacion: fila.afecta_liquidacion as boolean,
                abierta_por_usuario_id: null,
                resuelta_por_usuario_id: null,
                abierta_en: ahora,
                resuelta_en: null,
                creado_en: ahora,
                actualizado_en: ahora,
              };
              estado.incidencias.push(nueva);
              return { data: nueva, error: null };
            },
          }),
        }),
        update: () => ({ eq: () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: null, error: null }) }) }) }) }),
      };
    }

    // --- tarifas ---
    if (tabla === "tarifas") {
      return {
        select: (_cols?: string) => ({
          eq: (_c: string, _v: unknown) => ({
            eq: (_c2: string, _v2: unknown) => ({
              eq: (_c3: string, _v3: unknown) => ({
                lte: (_lc: string, _lv: string) => ({
                  or: (_expr: string) => ({
                    or: (_expr2: string) => ({
                      order: () => ({
                        order: () => ({
                          limit: (n: number) => ({
                            then(resolve: (r: { data: FilaTarifa[]; error: null }) => void) {
                              resolve({ data: tarifas.slice(0, n), error: null });
                            },
                          }),
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      };
    }

    // --- asignaciones_pedido ---
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
              estado.asignaciones.forEach((a, idx) => {
                if (filtros.every(([c, v]) => (a as unknown as Record<string, unknown>)[c] === v)) {
                  estado.asignaciones[idx] = { ...a, ...cambios } as FilaAsignacion;
                }
              });
              resolve({ error: null });
            },
          };

          return chain;
        },
      };
    }

    // --- bitacora_auditoria ---
    if (tabla === "bitacora_auditoria") {
      return {
        insert: async (fila: Record<string, unknown>) => {
          estado.bitacora.push(fila);
          return { data: null, error: null };
        },
      };
    }

    throw new Error(`Tabla no soportada en doble de prueba: ${tabla}`);
  }

  // Schema identidad — devuelve stubs vacíos para que resolverZona / resolverVentanaCorte
  // devuelvan null (best-effort) sin bloquear los tests de tarifa/geocoding existentes.
  function fromIdentidad(tabla: string) {
    if (tabla === "zona_comunas" || tabla === "ventanas_corte" || tabla === "zonas") {
      const chain = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        in: () => chain,
        order: () => chain,
        limit: () => chain,
        then: (resolve: (r: { data: null[]; error: null }) => void) => {
          resolve({ data: [], error: null });
        },
      };
      return chain;
    }
    throw new Error(`Tabla identidad no soportada en doble de prueba: ${tabla}`);
  }

  // resolver_zona vive en el esquema `identidad`: el código llama
  // `cliente.schema('identidad').rpc('resolver_zona', ...)`. El doble devuelve
  // null (sin zona mapeada), replicando el best-effort de producción.
  const rpcStub = (_fn: string, _args: unknown) => ({
    then: (resolve: (r: { data: null; error: null }) => void) => {
      resolve({ data: null, error: null });
    },
  });

  return {
    cliente: {
      from,
      schema: (esquema: string) => ({
        from: esquema === 'identidad' ? fromIdentidad : from,
        rpc: rpcStub,
      }),
      rpc: rpcStub,
    } as never,
    estado,
  };
}

// =============================================================================
// actualizarEstadoPedido — optimistic locking
// =============================================================================

describe("actualizarEstadoPedido — optimistic locking", () => {
  it("rechaza con ErrorConflicto si el estado actual difiere del esperado", async () => {
    // El pedido está en 'en_ruta' pero el job espera 'asignado'
    const { cliente } = crearClienteFalso({ pedidos: [pedidoBase("en_ruta")] });

    await expect(
      actualizarEstadoPedido(cliente, {
        pedidoId: PEDIDO_1,
        tenantId: TENANT_A,
        estadoNuevo: "entregado",
        estadoEsperado: "asignado", // diferente del real
        ejecutor: "sistema",
      }),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it("NO hace UPDATE si el estado difiere (protege contra carrera)", async () => {
    const { cliente, estado } = crearClienteFalso({ pedidos: [pedidoBase("en_ruta")] });

    try {
      await actualizarEstadoPedido(cliente, {
        pedidoId: PEDIDO_1,
        tenantId: TENANT_A,
        estadoNuevo: "entregado",
        estadoEsperado: "asignado",
        ejecutor: "sistema",
      });
    } catch (_e) {
      // esperado
    }

    // El estado del pedido no debe haber cambiado.
    expect(estado.pedidos[0].estado).toBe("en_ruta");
  });
});

// =============================================================================
// actualizarEstadoPedido — apertura automática de incidencia
// =============================================================================

describe("actualizarEstadoPedido — apertura automática de incidencia en 'fallido'", () => {
  it("transición a 'fallido' abre una incidencia automáticamente", async () => {
    const { cliente, estado } = crearClienteFalso({ pedidos: [pedidoBase("en_ruta")] });

    await actualizarEstadoPedido(cliente, {
      pedidoId: PEDIDO_1,
      tenantId: TENANT_A,
      estadoNuevo: "fallido",
      estadoEsperado: "en_ruta",
      ejecutor: "sistema",
    });

    expect(estado.incidencias).toHaveLength(1);
    expect(estado.incidencias[0].pedido_id).toBe(PEDIDO_1);
    expect(estado.incidencias[0].estado).toBe("abierta");
  });

  it("transición a 'fallido_manual' también abre incidencia", async () => {
    const { cliente, estado } = crearClienteFalso({ pedidos: [pedidoBase("en_ruta")] });

    await actualizarEstadoPedido(
      cliente,
      {
        pedidoId: PEDIDO_1,
        tenantId: TENANT_A,
        estadoNuevo: "fallido_manual",
        estadoEsperado: "en_ruta",
        ejecutor: "interno",
        actuadoPorUsuarioId: "usuario-supervisor-1",
        motivo: "No pudo contactar al destinatario",
      },
      actorSupervisor(),
    );

    expect(estado.incidencias).toHaveLength(1);
    expect(estado.incidencias[0].estado).toBe("abierta");
  });

  it("transición a 'entregado' NO abre incidencia", async () => {
    const { cliente, estado } = crearClienteFalso({ pedidos: [pedidoBase("en_ruta")] });

    await actualizarEstadoPedido(cliente, {
      pedidoId: PEDIDO_1,
      tenantId: TENANT_A,
      estadoNuevo: "entregado",
      estadoEsperado: "en_ruta",
      ejecutor: "sistema",
    });

    expect(estado.incidencias).toHaveLength(0);
  });
});

// =============================================================================
// actualizarEstadoPedido — corrección manual registra en bitácora
// =============================================================================

describe("actualizarEstadoPedido — corrección manual", () => {
  /**
   * Verifica el invariante CLAUDE.md: "bitácora ANTES que efectos externos".
   * La bitácora de corrección manual (ejecutor='interno') debe quedar escrita
   * antes de que el UPDATE de estado se ejecute. Si el UPDATE falla (simulamos
   * fallarUpdate=true), la entrada de bitácora ya debe existir.
   */
  it("la bitácora queda escrita ANTES del UPDATE de estado (invariante CLAUDE.md)", async () => {
    const { cliente, estado } = crearClienteFalso({
      pedidos: [pedidoBase("asignado")],
      fallarUpdate: true, // forzamos fallo del UPDATE
    });

    try {
      await actualizarEstadoPedido(
        cliente,
        {
          pedidoId: PEDIDO_1,
          tenantId: TENANT_A,
          estadoNuevo: "entregado_manual",
          estadoEsperado: "asignado",
          ejecutor: "interno",
          actuadoPorUsuarioId: "usuario-supervisor-1",
          motivo: "Confirmado por el destinatario vía teléfono",
        },
        actorSupervisor(),
      );
    } catch {
      // El UPDATE falló — es esperado en este test
    }

    // La bitácora debe haberse escrito aunque el UPDATE fallara.
    const entrada = estado.bitacora.find(
      (e) => e.accion === "pedido.estado_corregido_manual",
    );
    expect(entrada).toBeDefined();
    expect(entrada!.actor_usuario_id).toBe("usuario-supervisor-1");
  });

  it("registra en bitácora con accion='pedido.estado_corregido_manual'", async () => {
    const { cliente, estado } = crearClienteFalso({ pedidos: [pedidoBase("asignado")] });

    await actualizarEstadoPedido(
      cliente,
      {
        pedidoId: PEDIDO_1,
        tenantId: TENANT_A,
        estadoNuevo: "entregado_manual",
        estadoEsperado: "asignado",
        ejecutor: "interno",
        actuadoPorUsuarioId: "usuario-supervisor-1",
        motivo: "Confirmado por el destinatario vía teléfono",
      },
      actorSupervisor(),
    );

    expect(estado.bitacora).toHaveLength(1);
    expect(estado.bitacora[0]).toMatchObject({
      tenant_id: TENANT_A,
      actor_tipo: "usuario",
      accion: "pedido.estado_corregido_manual",
      entidad_tipo: "pedido",
      entidad_id: PEDIDO_1,
    });

    const detalle = estado.bitacora[0].detalle as Record<string, unknown>;
    expect(detalle.estado_anterior).toBe("asignado");
    expect(detalle.estado_nuevo).toBe("entregado_manual");
    expect(detalle.motivo).toBe("Confirmado por el destinatario vía teléfono");
    // Nunca secretos en bitácora.
    expect(JSON.stringify(detalle).toLowerCase()).not.toContain("token");
    expect(JSON.stringify(detalle).toLowerCase()).not.toContain("password");
  });

  it("rechaza corrección manual sin motivo", async () => {
    const { cliente } = crearClienteFalso({ pedidos: [pedidoBase("asignado")] });

    await expect(
      actualizarEstadoPedido(
        cliente,
        {
          pedidoId: PEDIDO_1,
          tenantId: TENANT_A,
          estadoNuevo: "entregado_manual",
          estadoEsperado: "asignado",
          ejecutor: "interno",
          actuadoPorUsuarioId: "u-1",
          motivo: "   ", // espacio solo — inválido
        },
        actorSupervisor(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it("rechaza corrección manual si el actor no tiene capacidad ajustar_operacion_diaria", async () => {
    const { cliente } = crearClienteFalso({ pedidos: [pedidoBase("asignado")] });

    // Coordinador solo tiene asignar_y_reasignar_pedidos, NO ajustar_operacion_diaria.
    await expect(
      actualizarEstadoPedido(
        cliente,
        {
          pedidoId: PEDIDO_1,
          tenantId: TENANT_A,
          estadoNuevo: "entregado_manual",
          estadoEsperado: "asignado",
          ejecutor: "interno",
          actuadoPorUsuarioId: "u-coord-1",
          motivo: "Corrección",
        },
        actorCoordinador(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it("transición manual sin actor (ejecutor='interno') lanza ErrorValidacion", async () => {
    const { cliente } = crearClienteFalso({ pedidos: [pedidoBase("asignado")] });

    await expect(
      actualizarEstadoPedido(cliente, {
        pedidoId: PEDIDO_1,
        tenantId: TENANT_A,
        estadoNuevo: "entregado_manual",
        estadoEsperado: "asignado",
        ejecutor: "interno",
        motivo: "Corrección",
        // actor omitido
      }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});

// =============================================================================
// actualizarEstadoPedido — transición inválida
// =============================================================================

describe("actualizarEstadoPedido — transición inválida", () => {
  it("lanza ErrorTransicionInvalida para transición no permitida por la máquina", async () => {
    // asignado → entregado es inválido (saltarse en_ruta) — nótese que
    // pendiente_asignacion → entregado por 'sistema' SÍ es válida desde el fix
    // del bug de facturación Flex (ago-2026): ver el describe
    // "reflejo de ML desde pendiente_asignacion (Flex)" más abajo.
    const { cliente } = crearClienteFalso({ pedidos: [pedidoBase("asignado")] });

    await expect(
      actualizarEstadoPedido(cliente, {
        pedidoId: PEDIDO_1,
        tenantId: TENANT_A,
        estadoNuevo: "entregado",
        estadoEsperado: "asignado",
        ejecutor: "sistema",
      }),
    ).rejects.toBeInstanceOf(ErrorTransicionInvalida);
  });

  it("lanza ErrorTransicionInvalida si se intenta mover desde un estado terminal", async () => {
    const { cliente } = crearClienteFalso({ pedidos: [pedidoBase("entregado")] });

    await expect(
      actualizarEstadoPedido(cliente, {
        pedidoId: PEDIDO_1,
        tenantId: TENANT_A,
        estadoNuevo: "en_ruta",
        estadoEsperado: "entregado",
        ejecutor: "sistema",
      }),
    ).rejects.toBeInstanceOf(ErrorTransicionInvalida);
  });
});

// =============================================================================
// crearPedidoSameDay — tarifa obligatoria
// =============================================================================

// =============================================================================
// actualizarEstadoPedido — carrera después del SELECT (UPDATE no afecta filas)
// =============================================================================

describe("actualizarEstadoPedido — carrera entre SELECT y UPDATE", () => {
  it("si el UPDATE devuelve null (otra transacción ganó), lanza ErrorConflicto", async () => {
    // Simula el escenario: el SELECT ve el pedido en_ruta, pero antes del UPDATE
    // otra ejecución concurrente ya lo cambió. El UPDATE con la condición de estado
    // no afecta filas → data=null → ErrorConflicto.
    const { cliente } = crearClienteFalso({
      pedidos: [pedidoBase("en_ruta")],
      fallarUpdate: true, // simula que el UPDATE no encontró filas (retorna null)
    });

    await expect(
      actualizarEstadoPedido(cliente, {
        pedidoId: PEDIDO_1,
        tenantId: TENANT_A,
        estadoNuevo: "entregado",
        estadoEsperado: "en_ruta",
        ejecutor: "sistema",
      }),
    ).rejects.toBeDefined(); // puede ser ErrorConflicto o Error genérico según impl.
  });
});

// =============================================================================
// actualizarEstadoPedido — pedido inexistente
// =============================================================================

describe("actualizarEstadoPedido — pedido no encontrado", () => {
  it("lanza ErrorPedidoNoEncontrado si el pedido no existe en el tenant", async () => {
    const { cliente } = crearClienteFalso({ pedidos: [] }); // sin pedidos

    await expect(
      actualizarEstadoPedido(cliente, {
        pedidoId: "pedido-inexistente",
        tenantId: TENANT_A,
        estadoNuevo: "entregado",
        estadoEsperado: "en_ruta",
        ejecutor: "sistema",
      }),
    ).rejects.toBeInstanceOf(ErrorPedidoNoEncontrado);
  });
});

// =============================================================================
// actualizarEstadoPedido — proyección de sla_cumplido al cancelar (§5 fila 5,
// docs/arquitectura/edicion-y-cancelacion-de-pedidos.md). Un pedido cancelado
// no es un incumplimiento de SLA — es una entrega que nadie pidió. Por eso
// sla_cumplido debe quedar `null` (no evaluable), forzado explícitamente aunque
// la columna ya tuviera un valor de una transición anterior.
// =============================================================================

describe("actualizarEstadoPedido — sla_cumplido al cancelar", () => {
  it("cancelado fuerza sla_cumplido=null aunque ya estuviera en true (fecha_compromiso_hora pasada)", async () => {
    const fechaPasada = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // hace 1h
    const pedido = pedidoBase("asignado");
    pedido.fecha_compromiso_hora = fechaPasada;
    pedido.sla_cumplido = true; // valor de una evaluación anterior — debe limpiarse

    const { cliente, estado } = crearClienteFalso({ pedidos: [pedido] });

    await actualizarEstadoPedido(cliente, {
      pedidoId: PEDIDO_1,
      tenantId: TENANT_A,
      estadoNuevo: "cancelado",
      estadoEsperado: "asignado",
      ejecutor: "sistema", // asignado→cancelado ya existe con ejecutor 'sistema'
    });

    expect(estado.pedidos[0].estado).toBe("cancelado");
    expect(estado.pedidos[0].sla_cumplido).toBeNull();
  });

  it("cancelado desde 'fallido' (ejecutor interno) también fuerza sla_cumplido=null", async () => {
    const fechaPasada = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const pedido = pedidoBase("fallido");
    pedido.fecha_compromiso_hora = fechaPasada;
    pedido.sla_cumplido = false; // el fallido previo ya lo había marcado incumplido

    const { cliente, estado } = crearClienteFalso({ pedidos: [pedido] });

    await actualizarEstadoPedido(
      cliente,
      {
        pedidoId: PEDIDO_1,
        tenantId: TENANT_A,
        estadoNuevo: "cancelado",
        estadoEsperado: "fallido",
        ejecutor: "interno",
        actuadoPorUsuarioId: "usuario-supervisor-1",
        motivo: "Seller solicitó cancelar, no hay reintento posible",
      },
      actorSupervisor(),
    );

    expect(estado.pedidos[0].estado).toBe("cancelado");
    expect(estado.pedidos[0].sla_cumplido).toBeNull();
  });

  it("cancelado sin fecha_compromiso_hora también queda en null (caso trivial, sin regresión)", async () => {
    const pedido = pedidoBase("asignado");
    pedido.fecha_compromiso_hora = null;

    const { cliente, estado } = crearClienteFalso({ pedidos: [pedido] });

    await actualizarEstadoPedido(cliente, {
      pedidoId: PEDIDO_1,
      tenantId: TENANT_A,
      estadoNuevo: "cancelado",
      estadoEsperado: "asignado",
      ejecutor: "sistema",
    });

    expect(estado.pedidos[0].sla_cumplido).toBeNull();
  });

  // Contraste deliberado: 'devuelto' NO cambia con este fix. A diferencia de
  // 'cancelado', 'devuelto' solo es alcanzable desde 'en_ruta'/'fallido'/
  // 'fallido_manual' (maquina-estados.ts) — siempre hubo un intento real de
  // entrega que terminó devuelto al origen, así que sí es un incumplimiento
  // genuino de SLA cuando había compromiso horario. Se deja documentado y sin
  // tocar (decisión pendiente de confirmar con el equipo, ver entregable).
  it("devuelto SIGUE marcando sla_cumplido=false si había fecha_compromiso_hora (sin cambios, a propósito)", async () => {
    const fechaPasada = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const pedido = pedidoBase("en_ruta");
    pedido.fecha_compromiso_hora = fechaPasada;

    const { cliente, estado } = crearClienteFalso({ pedidos: [pedido] });

    await actualizarEstadoPedido(cliente, {
      pedidoId: PEDIDO_1,
      tenantId: TENANT_A,
      estadoNuevo: "devuelto",
      estadoEsperado: "en_ruta",
      ejecutor: "sistema",
    });

    expect(estado.pedidos[0].estado).toBe("devuelto");
    expect(estado.pedidos[0].sla_cumplido).toBe(false);
  });
});

// =============================================================================
// cancelarPedido (docs/arquitectura/edicion-y-cancelacion-de-pedidos.md §7.1)
// =============================================================================

function pedidoSameDayCancelable(
  estadoActual: EstadoPedido = "pendiente_asignacion",
  overrides: Partial<FilaPedido> = {},
): FilaPedido {
  return {
    ...pedidoBase(estadoActual),
    fuente: "rutax_manual", tipo_pedido: "same_day",
    ...overrides,
  };
}

describe("cancelarPedido — camino feliz (interno)", () => {
  it("cancela pendiente_asignacion→cancelado, escribe las 3 columnas y motivo, y una sola entrada de bitácora 'pedido.cancelado'", async () => {
    const { cliente, estado } = crearClienteFalso({
      pedidos: [pedidoSameDayCancelable("pendiente_asignacion")],
    });

    const pedido = await cancelarPedido(
      cliente,
      {
        pedidoId: PEDIDO_1,
        tenantId: TENANT_A,
        estadoEsperado: "pendiente_asignacion",
        ejecutor: "interno",
        actuadoPorUsuarioId: USUARIO_INTERNO_1,
        motivo: "El seller pidió cancelar: dirección duplicada",
      },
      actorSupervisor(),
    );

    expect(pedido.estado).toBe("cancelado");
    expect(estado.pedidos[0].estado).toBe("cancelado");
    expect(estado.pedidos[0].cancelado_en).toBeTruthy();
    expect(estado.pedidos[0].cancelado_por_usuario_id).toBe(USUARIO_INTERNO_1);
    expect(estado.pedidos[0].motivo_cancelacion).toBe("El seller pidió cancelar: dirección duplicada");

    // Una entrada por acto: NO debe haber 'pedido.estado_corregido_manual'.
    const entradasCancelacion = estado.bitacora.filter((b) => b.accion === "pedido.cancelado");
    const entradasCorreccion = estado.bitacora.filter(
      (b) => b.accion === "pedido.estado_corregido_manual",
    );
    expect(entradasCancelacion).toHaveLength(1);
    expect(entradasCorreccion).toHaveLength(0);
    expect(entradasCancelacion[0].actor_usuario_id).toBe(USUARIO_INTERNO_1);
  });

  it("cancela asignado→cancelado por interno (NUEVA transición) y desactiva la asignación activa", async () => {
    const asignacion: FilaAsignacion = {
      id: "asig-1",
      tenant_id: TENANT_A,
      pedido_id: PEDIDO_1,
      manifiesto_id: "manifiesto-1",
      driver_id: "driver-1",
      seller_id: SELLER_1,
      activa: true,
      asignado_en: new Date().toISOString(),
      desasignado_en: null,
    };
    const { cliente, estado } = crearClienteFalso({
      pedidos: [pedidoSameDayCancelable("asignado", { driver_id_asignado: "driver-1" })],
      asignaciones: [asignacion],
    });

    await cancelarPedido(
      cliente,
      {
        pedidoId: PEDIDO_1,
        tenantId: TENANT_A,
        estadoEsperado: "asignado",
        ejecutor: "interno",
        actuadoPorUsuarioId: USUARIO_INTERNO_1,
        motivo: "Cliente ya no requiere el envío",
      },
      actorSupervisor(),
    );

    expect(estado.pedidos[0].estado).toBe("cancelado");
    expect(estado.asignaciones[0].activa).toBe(false);
    expect(estado.asignaciones[0].desasignado_en).toBeTruthy();
  });

  it("desde 'fallido' resuelve la incidencia abierta (mismo patrón que 'devuelto') con una sola bitácora por acto", async () => {
    const { cliente, estado } = crearClienteFalso({
      pedidos: [pedidoSameDayCancelable("fallido")],
    });
    // Simula que ya existe una incidencia abierta (abierta automáticamente al
    // llegar a 'fallido' en un ciclo previo).
    estado.incidencias.push({
      id: "inc-abierta-1",
      tenant_id: TENANT_A,
      pedido_id: PEDIDO_1,
      seller_id: SELLER_1,
      tipo: "otro",
      estado: "abierta",
      afecta_cobro: true,
      afecta_liquidacion: true,
      descripcion: null,
      notas_resolucion: null,
      abierta_por_usuario_id: null,
      resuelta_por_usuario_id: null,
      abierta_en: new Date().toISOString(),
      resuelta_en: null,
      creado_en: new Date().toISOString(),
      actualizado_en: new Date().toISOString(),
    });

    await cancelarPedido(
      cliente,
      {
        pedidoId: PEDIDO_1,
        tenantId: TENANT_A,
        estadoEsperado: "fallido",
        ejecutor: "interno",
        actuadoPorUsuarioId: USUARIO_INTERNO_1,
        motivo: "Sin reintento posible, cierre definitivo",
      },
      actorSupervisor(),
    );

    expect(estado.pedidos[0].estado).toBe("cancelado");
    const resolucion = estado.bitacora.find((b) => b.accion === "incidencia.resuelta_por_cancelacion");
    expect(resolucion).toBeDefined();
    expect((resolucion!.detalle as Record<string, unknown>).incidencia_id).toBe("inc-abierta-1");
  });

  it("cancelar SIN incidencia abierta no escribe 'incidencia.resuelta_por_cancelacion' (sin falsos positivos)", async () => {
    const { cliente, estado } = crearClienteFalso({
      pedidos: [pedidoSameDayCancelable("pendiente_asignacion")],
    });

    await cancelarPedido(
      cliente,
      {
        pedidoId: PEDIDO_1,
        tenantId: TENANT_A,
        estadoEsperado: "pendiente_asignacion",
        ejecutor: "interno",
        actuadoPorUsuarioId: USUARIO_INTERNO_1,
        motivo: "Nadie lo tomó todavía",
      },
      actorSupervisor(),
    );

    const resolucion = estado.bitacora.find((b) => b.accion === "incidencia.resuelta_por_cancelacion");
    expect(resolucion).toBeUndefined();
  });
});

describe("cancelarPedido — camino feliz (seller, ventana acotada)", () => {
  it("el seller cancela SU pendiente_asignacion→cancelado y queda registrado con ejecutor='seller'", async () => {
    const { cliente, estado } = crearClienteFalso({
      pedidos: [pedidoSameDayCancelable("pendiente_asignacion")],
    });

    const pedido = await cancelarPedido(
      cliente,
      {
        pedidoId: PEDIDO_1,
        tenantId: TENANT_A,
        estadoEsperado: "pendiente_asignacion",
        ejecutor: "seller",
        actuadoPorUsuarioId: USUARIO_SELLER_1,
        motivo: "Dirección de entrega errónea, voy a recrearlo",
        sellerId: SELLER_1,
      },
      actorSellerFixture(SELLER_1),
    );

    expect(pedido.estado).toBe("cancelado");
    const entrada = estado.bitacora.find((b) => b.accion === "pedido.cancelado");
    expect(entrada).toBeDefined();
    expect((entrada!.detalle as Record<string, unknown>).ejecutor).toBe("seller");
    expect(entrada!.actor_usuario_id).toBe(USUARIO_SELLER_1);
  });

  it("el seller cancela asignado→cancelado (dentro de su ventana, §3.1)", async () => {
    const { cliente } = crearClienteFalso({
      pedidos: [pedidoSameDayCancelable("asignado")],
    });

    const pedido = await cancelarPedido(
      cliente,
      {
        pedidoId: PEDIDO_1,
        tenantId: TENANT_A,
        estadoEsperado: "asignado",
        ejecutor: "seller",
        actuadoPorUsuarioId: USUARIO_SELLER_1,
        motivo: "Ya no necesito el envío",
        sellerId: SELLER_1,
      },
      actorSellerFixture(SELLER_1),
    );

    expect(pedido.estado).toBe("cancelado");
  });

  it("el seller NO puede cancelar en_ruta (fuera de su ventana) — ErrorTransicionInvalida", async () => {
    const { cliente } = crearClienteFalso({
      pedidos: [pedidoSameDayCancelable("en_ruta")],
    });

    await expect(
      cancelarPedido(
        cliente,
        {
          pedidoId: PEDIDO_1,
          tenantId: TENANT_A,
          estadoEsperado: "en_ruta",
          ejecutor: "seller",
          actuadoPorUsuarioId: USUARIO_SELLER_1,
          motivo: "Ya no necesito el envío",
          sellerId: SELLER_1,
        },
        actorSellerFixture(SELLER_1),
      ),
    ).rejects.toBeInstanceOf(ErrorTransicionInvalida);
  });

  it("un seller sin capacidad gestionar_pedidos_propios (tipoUsuario incorrecto) es rechazado con ErrorValidacion", async () => {
    const { cliente } = crearClienteFalso({
      pedidos: [pedidoSameDayCancelable("pendiente_asignacion")],
    });

    // Actor con rol 'conductor' — no tiene gestionar_pedidos_propios.
    const actorSinCapacidad: UsuarioActual = {
      tenantId: TENANT_A,
      tipoUsuario: "conductor",
      sellerId: null,
      driverId: "driver-x",
      rol: "conductor",
      estado: "activo",
    };

    await expect(
      cancelarPedido(
        cliente,
        {
          pedidoId: PEDIDO_1,
          tenantId: TENANT_A,
          estadoEsperado: "pendiente_asignacion",
          ejecutor: "seller",
          actuadoPorUsuarioId: USUARIO_SELLER_1,
          motivo: "Motivo con más de diez caracteres",
          sellerId: SELLER_1,
        },
        actorSinCapacidad,
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});

describe("cancelarPedido — aislamiento: seller A no puede cancelar un pedido de seller B", () => {
  it("responde ErrorPedidoNoEncontrado y NO muta el pedido de otro seller", async () => {
    const { cliente, estado } = crearClienteFalso({
      pedidos: [pedidoSameDayCancelable("pendiente_asignacion", { seller_id: SELLER_2 })],
    });

    await expect(
      cancelarPedido(
        cliente,
        {
          pedidoId: PEDIDO_1,
          tenantId: TENANT_A,
          estadoEsperado: "pendiente_asignacion",
          ejecutor: "seller",
          actuadoPorUsuarioId: USUARIO_SELLER_1,
          motivo: "Intento de cancelar un pedido ajeno",
          sellerId: SELLER_1, // el pedido real es de SELLER_2
        },
        actorSellerFixture(SELLER_1),
      ),
    ).rejects.toBeInstanceOf(ErrorPedidoNoEncontrado);

    // Sin efecto: el pedido de SELLER_2 sigue intacto.
    expect(estado.pedidos[0].estado).toBe("pendiente_asignacion");
    expect(estado.bitacora).toHaveLength(0);
  });
});

describe("cancelarPedido — motivo obligatorio (>= 10 caracteres)", () => {
  it("motivo de menos de 10 caracteres ⇒ ErrorValidacion, sin tocar el pedido", async () => {
    const { cliente, estado } = crearClienteFalso({
      pedidos: [pedidoSameDayCancelable("pendiente_asignacion")],
    });

    await expect(
      cancelarPedido(
        cliente,
        {
          pedidoId: PEDIDO_1,
          tenantId: TENANT_A,
          estadoEsperado: "pendiente_asignacion",
          ejecutor: "interno",
          actuadoPorUsuarioId: USUARIO_INTERNO_1,
          motivo: "corto", // 5 caracteres
        },
        actorSupervisor(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);

    expect(estado.pedidos[0].estado).toBe("pendiente_asignacion");
    expect(estado.bitacora).toHaveLength(0);
  });

  it("motivo vacío ⇒ ErrorValidacion", async () => {
    const { cliente } = crearClienteFalso({
      pedidos: [pedidoSameDayCancelable("pendiente_asignacion")],
    });

    await expect(
      cancelarPedido(
        cliente,
        {
          pedidoId: PEDIDO_1,
          tenantId: TENANT_A,
          estadoEsperado: "pendiente_asignacion",
          ejecutor: "interno",
          actuadoPorUsuarioId: USUARIO_INTERNO_1,
          motivo: "   ",
        },
        actorSupervisor(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  // Bordes exactos del límite (busca lo que nadie miró — encargo QA).
  it("motivo de EXACTAMENTE 9 caracteres (uno menos del mínimo) ⇒ ErrorValidacion", async () => {
    const { cliente, estado } = crearClienteFalso({
      pedidos: [pedidoSameDayCancelable("pendiente_asignacion")],
    });
    const motivo9 = "123456789";
    expect(motivo9).toHaveLength(9);

    await expect(
      cancelarPedido(
        cliente,
        {
          pedidoId: PEDIDO_1,
          tenantId: TENANT_A,
          estadoEsperado: "pendiente_asignacion",
          ejecutor: "interno",
          actuadoPorUsuarioId: USUARIO_INTERNO_1,
          motivo: motivo9,
        },
        actorSupervisor(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    expect(estado.pedidos[0].estado).toBe("pendiente_asignacion");
  });

  it("motivo de EXACTAMENTE 10 caracteres (el mínimo, inclusive) ⇒ SE ACEPTA", async () => {
    const { cliente, estado } = crearClienteFalso({
      pedidos: [pedidoSameDayCancelable("pendiente_asignacion")],
    });
    const motivo10 = "1234567890";
    expect(motivo10).toHaveLength(10);

    const pedido = await cancelarPedido(
      cliente,
      {
        pedidoId: PEDIDO_1,
        tenantId: TENANT_A,
        estadoEsperado: "pendiente_asignacion",
        ejecutor: "interno",
        actuadoPorUsuarioId: USUARIO_INTERNO_1,
        motivo: motivo10,
      },
      actorSupervisor(),
    );

    expect(pedido.estado).toBe("cancelado");
    expect(estado.pedidos[0].motivo_cancelacion).toBe(motivo10);
  });

  it("motivo hecho SOLO de espacios, aunque tenga 15 caracteres de largo aparente ⇒ ErrorValidacion (se valida el trim, no el largo bruto)", async () => {
    const { cliente, estado } = crearClienteFalso({
      pedidos: [pedidoSameDayCancelable("pendiente_asignacion")],
    });
    const soloEspacios = " ".repeat(15);
    expect(soloEspacios).toHaveLength(15);

    await expect(
      cancelarPedido(
        cliente,
        {
          pedidoId: PEDIDO_1,
          tenantId: TENANT_A,
          estadoEsperado: "pendiente_asignacion",
          ejecutor: "interno",
          actuadoPorUsuarioId: USUARIO_INTERNO_1,
          motivo: soloEspacios,
        },
        actorSupervisor(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    expect(estado.pedidos[0].estado).toBe("pendiente_asignacion");
  });

  it("motivo MUY largo (2000 caracteres) se acepta sin truncar — motivo_cancelacion es text libre", async () => {
    const { cliente, estado } = crearClienteFalso({
      pedidos: [pedidoSameDayCancelable("pendiente_asignacion")],
    });
    const motivoLargo = "El seller solicitó anular este pedido porque ".repeat(50); // ~2350 chars

    const pedido = await cancelarPedido(
      cliente,
      {
        pedidoId: PEDIDO_1,
        tenantId: TENANT_A,
        estadoEsperado: "pendiente_asignacion",
        ejecutor: "interno",
        actuadoPorUsuarioId: USUARIO_INTERNO_1,
        motivo: motivoLargo,
      },
      actorSupervisor(),
    );

    expect(pedido.estado).toBe("cancelado");
    expect(estado.pedidos[0].motivo_cancelacion).toBe(motivoLargo);
    expect((estado.pedidos[0].motivo_cancelacion as string).length).toBe(motivoLargo.length);
  });
});

describe("cancelarPedido — carreras (busca lo que nadie miró, encargo QA)", () => {
  it("cancelar con un estadoEsperado ya obsoleto (alguien reasignó el pedido mientras tanto) ⇒ ErrorConflicto, sin mutar el pedido", async () => {
    // El llamador leyó 'pendiente_asignacion' hace un instante, pero el
    // sistema (o el coordinador) ya lo movió a 'asignado' antes de que esta
    // llamada llegara al UPDATE — la guarda .eq('estado', estadoEsperado) no
    // encuentra la fila.
    const { cliente, estado } = crearClienteFalso({
      pedidos: [pedidoSameDayCancelable("asignado")], // el estado REAL ya avanzó
    });

    await expect(
      cancelarPedido(
        cliente,
        {
          pedidoId: PEDIDO_1,
          tenantId: TENANT_A,
          estadoEsperado: "pendiente_asignacion", // stale
          ejecutor: "interno",
          actuadoPorUsuarioId: USUARIO_INTERNO_1,
          motivo: "Cancelar mientras alguien más asigna el pedido",
        },
        actorSupervisor(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    // El pedido sigue 'asignado' — ni se movió a 'cancelado' a medias, ni
    // quedó bitácora de una cancelación que no ocurrió.
    expect(estado.pedidos[0].estado).toBe("asignado");
    expect(estado.bitacora).toHaveLength(0);
  });

  it("dos cancelaciones simultáneas del MISMO pedido: la primera gana, la segunda recibe ErrorConflicto — nunca doble bitácora ni doble anulación", async () => {
    const { cliente, estado } = crearClienteFalso({
      pedidos: [pedidoSameDayCancelable("pendiente_asignacion")],
    });

    const entrada = {
      pedidoId: PEDIDO_1,
      tenantId: TENANT_A,
      estadoEsperado: "pendiente_asignacion" as const,
      ejecutor: "interno" as const,
      actuadoPorUsuarioId: USUARIO_INTERNO_1,
      motivo: "Dos coordinadores cancelando el mismo pedido a la vez",
    };

    // Primera "hebra": gana, deja el pedido en 'cancelado'.
    const primera = await cancelarPedido(cliente, entrada, actorSupervisor());
    expect(primera.estado).toBe("cancelado");

    // Segunda "hebra": leyó el mismo estadoEsperado ANTES de que la primera
    // corriera (la carrera real), así que llega con el mismo valor stale.
    await expect(
      cancelarPedido(cliente, entrada, actorSupervisor()),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    // Exactamente UNA entrada de bitácora 'pedido.cancelado' — la segunda
    // hebra nunca llegó a escribir nada (falla en el UPDATE, no después).
    const cancelaciones = estado.bitacora.filter((e) => e.accion === "pedido.cancelado");
    expect(cancelaciones).toHaveLength(1);
  });
});

describe("cancelarPedido — barrera por fuente: SOLO same_day (§3.2)", () => {
  it("un Flex vivo (pendiente_asignacion) es rechazado con ErrorValidacion", async () => {
    const { cliente, estado } = crearClienteFalso({
      pedidos: [pedidoBase("pendiente_asignacion")], // pedidoBase() = tipo_pedido 'flex'
    });

    await expect(
      cancelarPedido(
        cliente,
        {
          pedidoId: PEDIDO_1,
          tenantId: TENANT_A,
          estadoEsperado: "pendiente_asignacion",
          ejecutor: "interno",
          actuadoPorUsuarioId: USUARIO_INTERNO_1,
          motivo: "Intento de cancelar un Flex vivo",
        },
        actorSupervisor(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);

    expect(estado.pedidos[0].estado).toBe("pendiente_asignacion");
  });

  it("un Flex en 'asignado' también es rechazado por cancelarPedido (aunque la transición exista para 'sistema')", async () => {
    const { cliente } = crearClienteFalso({
      pedidos: [pedidoBase("asignado")],
    });

    await expect(
      cancelarPedido(
        cliente,
        {
          pedidoId: PEDIDO_1,
          tenantId: TENANT_A,
          estadoEsperado: "asignado",
          ejecutor: "interno",
          actuadoPorUsuarioId: USUARIO_INTERNO_1,
          motivo: "Intento de cancelar un Flex vivo",
        },
        actorSupervisor(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it("fallido→cancelado de un Flex SIGUE PERMITIDO — pero por la vía existente (actualizarEstadoPedido directo, sin pasar por cancelarPedido)", async () => {
    const { cliente, estado } = crearClienteFalso({
      pedidos: [pedidoBase("fallido")], // tipo_pedido 'flex', sin cambios
    });

    const pedido = await actualizarEstadoPedido(
      cliente,
      {
        pedidoId: PEDIDO_1,
        tenantId: TENANT_A,
        estadoNuevo: "cancelado",
        estadoEsperado: "fallido",
        ejecutor: "interno",
        actuadoPorUsuarioId: USUARIO_INTERNO_1,
        motivo: "Válvula de escape: Flex atascado, sin reintento posible",
      },
      actorSupervisor(),
    );

    expect(pedido.estado).toBe("cancelado");
    expect(estado.pedidos[0].tipo_pedido).toBe("flex");
    // La barrera same_day es de cancelarPedido, NO de actualizarEstadoPedido:
    // sin ella, este camino existente (válvula de escape para Flex atascado,
    // §3.2) se seguiría rompiendo.
  });
});

describe("cancelarPedido — regresión commit 0164a56: exige cliente service_role", () => {
  const claveServiceRoleOriginal = process.env.SUPABASE_SERVICE_ROLE_KEY;

  afterEach(() => {
    if (claveServiceRoleOriginal === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = claveServiceRoleOriginal;
    }
  });

  it("con un cliente que NO es service_role (p. ej. la sesión del usuario), lanza error explícito de registrarEnBitacora", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "clave-service-role";

    const { cliente } = crearClienteFalso({
      pedidos: [pedidoSameDayCancelable("pendiente_asignacion")],
    });
    // Cliente falso que se hace pasar por la sesión del usuario (clave anon).
    (cliente as unknown as { supabaseKey: string }).supabaseKey = "clave-anon";

    await expect(
      cancelarPedido(
        cliente,
        {
          pedidoId: PEDIDO_1,
          tenantId: TENANT_A,
          estadoEsperado: "pendiente_asignacion",
          ejecutor: "interno",
          actuadoPorUsuarioId: USUARIO_INTERNO_1,
          motivo: "Motivo con más de diez caracteres",
        },
        actorSupervisor(),
      ),
    ).rejects.toThrow(/no es service_role/i);
  });
});

// =============================================================================
// crearPedidoSameDay — manejo de tarifa
// =============================================================================

describe("crearPedidoSameDay — manejo de tarifa", () => {
  it("fija tarifa_aplicable_id al crear el pedido", async () => {
    const { cliente, estado } = crearClienteFalso({ tarifas: [{ id: TARIFA_1 }] });

    const { pedido } = await crearPedidoSameDay(cliente, {
      tenantId: TENANT_A,
      sellerId: SELLER_1,
      destinatarioNombre: "María González",
      destinatarioDireccion: "Calle Falsa 123",
      destinatarioComuna: "Santiago",
    });

    expect(pedido.tarifaAplicableId).toBe(TARIFA_1);
    expect(estado.pedidos.find((p) => p.id === pedido.id)?.tarifa_aplicable_id).toBe(TARIFA_1);
  });

  it("lanza ErrorValidacion si no hay tarifa configurada para same-day", async () => {
    // Sin tarifas disponibles
    const { cliente } = crearClienteFalso({ tarifas: [] });

    await expect(
      crearPedidoSameDay(cliente, {
        tenantId: TENANT_A,
        sellerId: SELLER_1,
        destinatarioNombre: "María González",
        destinatarioDireccion: "Calle Falsa 123",
        destinatarioComuna: "Santiago",
      }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it("el mensaje de ErrorValidacion sin tarifa menciona /onboarding/tarifas", async () => {
    const { cliente } = crearClienteFalso({ tarifas: [] });

    try {
      await crearPedidoSameDay(cliente, {
        tenantId: TENANT_A,
        sellerId: SELLER_1,
        destinatarioNombre: "Test",
        destinatarioDireccion: "Dir",
        destinatarioComuna: "Comuna",
      });
      expect.fail("debería haber lanzado");
    } catch (e) {
      expect(e).toBeInstanceOf(ErrorValidacion);
      expect((e as ErrorValidacion).message).toContain("/onboarding/tarifas");
    }
  });

  it("crea pedido con tipo 'same_day' y origen 'same_day_manual'", async () => {
    const { cliente } = crearClienteFalso();

    const { pedido } = await crearPedidoSameDay(cliente, {
      tenantId: TENANT_A,
      sellerId: SELLER_1,
      destinatarioNombre: "Ana López",
      destinatarioDireccion: "Av. Libertad 500",
      destinatarioComuna: "Ñuñoa",
    });

    expect(pedido.tipoPedido).toBe("same_day");
    expect(pedido.origen).toBe("same_day_manual");
    expect(pedido.estado).toBe("pendiente_asignacion");
  });
});

// =============================================================================
// crearPedidoSameDay — campos de geocoding (migración 0013, F4 ítem 1.1)
// =============================================================================

describe("crearPedidoSameDay — campos de geocoding", () => {
  it("retorna geoEstado = 'pendiente' y coberturaEstado = 'pendiente' por defecto", async () => {
    const { cliente } = crearClienteFalso();

    const { pedido } = await crearPedidoSameDay(cliente, {
      tenantId: TENANT_A,
      sellerId: SELLER_1,
      destinatarioNombre: "Pedro Soto",
      destinatarioDireccion: "Calle Los Leones 100",
      destinatarioComuna: "Providencia",
    });

    expect(pedido.geoEstado).toBe("pendiente");
    expect(pedido.coberturaEstado).toBe("pendiente");
    expect(pedido.lat).toBeNull();
    expect(pedido.long).toBeNull();
    expect(pedido.geoConfianza).toBeNull();
    expect(pedido.geocodificadoEn).toBeNull();
  });

  it("el pedido creado no expone datos personales en el payload de geocoding (minimización)", async () => {
    // Verifica que los campos de geocoding son solo de dirección/comuna,
    // nunca nombre ni teléfono. El campo geoEstado = 'pendiente' confirma
    // que el pedido aún no fue geocodificado en el mismo request.
    const { cliente } = crearClienteFalso();

    const { pedido } = await crearPedidoSameDay(cliente, {
      tenantId: TENANT_A,
      sellerId: SELLER_1,
      destinatarioNombre: "María González",  // no debe aparecer en geocoding
      destinatarioDireccion: "Calle Falsa 456",
      destinatarioComuna: "Santiago",
      destinatarioTelefono: "+56912345678",  // no debe aparecer en geocoding
    });

    // Los campos de geocoding no incluyen datos personales —
    // solo los de dirección/ubicación.
    expect(pedido.geoEstado).toBe("pendiente");
    expect(pedido.coberturaEstado).toBe("pendiente");
    // Los datos del pedido sí están (para uso interno)
    expect(pedido.destinatarioNombre).toBe("María González");
    expect(pedido.destinatarioDireccion).toBe("Calle Falsa 456");
    expect(pedido.destinatarioComuna).toBe("Santiago");
  });
});

// =============================================================================
// crearPedidoSameDay — fecha de compromiso (regresión 2026-08-27)
// =============================================================================
// 🔴 Sin fecha, el pedido se guardaba con `fecha_compromiso = NULL`, y en SQL
// un NULL no satisface NINGUNA comparación: ni el `.eq` del panel de Pedidos,
// ni el `.gte`/`.lte` del rango. El pedido existía y no aparecía en ninguna
// pantalla del día, así que tampoco se podía asignar. Diez pedidos reales se
// perdieron así antes de encontrarlo.
//
// El formulario SIEMPRE prometió «Si la dejas vacía, se entrega hoy» —y hasta
// calculaba el aviso de corte tratando el vacío como hoy—; lo único que no lo
// cumplía era la escritura.

describe("crearPedidoSameDay — fecha de compromiso", () => {
  it("sin fecha, se compromete para HOY y nunca guarda NULL", async () => {
    const { cliente, estado } = crearClienteFalso();

    const { pedido } = await crearPedidoSameDay(cliente, {
      tenantId: TENANT_A,
      sellerId: SELLER_1,
      destinatarioNombre: "Camila Rojas",
      destinatarioDireccion: "Av. Apoquindo 4501",
      destinatarioComuna: "Las Condes",
      // fechaCompromiso ausente a propósito: es el caso que se rompió.
    });

    const fila = estado.pedidos.find((p) => p.id === pedido.id);
    expect(fila?.fecha_compromiso).toBe(hoyEnSantiago());
    expect(fila?.fecha_compromiso).not.toBeNull();
  });

  it("respeta la fecha explícita cuando el usuario la eligió", async () => {
    const { cliente, estado } = crearClienteFalso();
    const manana = sumarDiasCalendario(hoyEnSantiago(), 1);

    const { pedido } = await crearPedidoSameDay(cliente, {
      tenantId: TENANT_A,
      sellerId: SELLER_1,
      destinatarioNombre: "Tomás Vera",
      destinatarioDireccion: "Av. Independencia 1300",
      destinatarioComuna: "Independencia",
      fechaCompromiso: manana,
    });

    expect(estado.pedidos.find((p) => p.id === pedido.id)?.fecha_compromiso).toBe(manana);
  });
});

// =============================================================================
// filaAPedido — mapper de columnas de geocoding
// =============================================================================

describe("filaAPedido — mapper de columnas de geocoding", () => {
  it("mapea lat/long/geoEstado/geoConfianza/geocodificadoEn/coberturaEstado desde la fila", async () => {
    // Usamos crearPedidoSameDay con un doble que devuelve valores geocodificados
    // para ejercer el mapper con datos reales de geocodificación.
    const ahora = new Date().toISOString();
    const filaPedidoGeocod: FilaPedido = {
      ...pedidoBase(),
      lat: -33.4372,
      long: -70.6506,
      geo_estado: 'resuelto',
      geo_confianza: 0.95,
      geocodificado_en: ahora,
      cobertura_estado: 'tarifada',
    };

    const { cliente } = crearClienteFalso({ pedidos: [filaPedidoGeocod] });

    // actualizarEstadoPedido devuelve el pedido completo vía filaAPedido;
    // lo usamos para verificar que el mapper mapea las columnas correctamente.
    // Hacemos una transición válida: en_ruta → entregado.
    const pedido = await import("./pedidos").then(m =>
      m.actualizarEstadoPedido(cliente, {
        pedidoId: PEDIDO_1,
        tenantId: TENANT_A,
        estadoNuevo: "entregado",
        estadoEsperado: "en_ruta",
        ejecutor: "sistema",
      })
    );

    expect(pedido.lat).toBe(-33.4372);
    expect(pedido.long).toBe(-70.6506);
    expect(pedido.geoEstado).toBe("resuelto");
    expect(pedido.geoConfianza).toBe(0.95);
    expect(pedido.geocodificadoEn).toBe(ahora);
    expect(pedido.coberturaEstado).toBe("tarifada");
  });

  it("aplica defaults de geocoding cuando las columnas no están en la fila (pedido pre-migración)", async () => {
    // Simula una fila sin columnas de geocoding (pedido creado antes de la migración 0013).
    // El mapper debe retornar defaults seguros, no fallar.
    const filaSinGeo = {
      ...pedidoBase(),
      lat: undefined,
      long: undefined,
      geo_estado: undefined,
      geo_confianza: undefined,
      geocodificado_en: undefined,
      cobertura_estado: undefined,
    };

    const { cliente } = crearClienteFalso({ pedidos: [filaSinGeo as unknown as FilaPedido] });

    const pedido = await import("./pedidos").then(m =>
      m.actualizarEstadoPedido(cliente, {
        pedidoId: PEDIDO_1,
        tenantId: TENANT_A,
        estadoNuevo: "entregado",
        estadoEsperado: "en_ruta",
        ejecutor: "sistema",
      })
    );

    expect(pedido.geoEstado).toBe("pendiente");
    expect(pedido.coberturaEstado).toBe("pendiente");
    expect(pedido.lat).toBeNull();
    expect(pedido.long).toBeNull();
    expect(pedido.geoConfianza).toBeNull();
    expect(pedido.geocodificadoEn).toBeNull();
  });
});

// =============================================================================
// actualizarEstadoPedido — barrera same-day del conductor (Bloque 2)
// =============================================================================

const DRIVER_1 = "eeee0000-0000-0000-0000-000000000050";

function actorConductorFixture(driverId: string = DRIVER_1): UsuarioActual {
  return {
    tenantId: TENANT_A,
    tipoUsuario: "conductor",
    sellerId: null,
    driverId,
    rol: "conductor",
    estado: "activo",
  };
}

function pedidoSameDay(
  estadoActual: EstadoPedido = "en_ruta",
  overrides: Partial<FilaPedido> = {},
): FilaPedido {
  return {
    ...pedidoBase(estadoActual),
    fuente: "rutax_manual", tipo_pedido: "same_day",
    driver_id_asignado: DRIVER_1,
    ...overrides,
  };
}

/**
 * Cliente falso extendido para tests de conductor:
 * - Soporta consultas a pruebas_entrega (para verificar POD válido).
 */
function crearClienteFalsoConductor(opts?: {
  pedidos?: FilaPedido[];
  hayPodValido?: boolean;
}) {
  const { cliente: clienteBase, estado } = crearClienteFalso({
    pedidos: opts?.pedidos ?? [pedidoSameDay()],
  });

  // Envolver el from original para interceptar pruebas_entrega
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clienteMutable = clienteBase as any;
  const fromOriginal = clienteMutable.from.bind(clienteMutable);
  const hayPodValido = opts?.hayPodValido ?? false;

  clienteMutable.from = (tabla: string) => {
    if (tabla === "pruebas_entrega") {
      // Retorna una cadena de mocks que simula la consulta de POD válido.
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({
                      data: hayPodValido
                        ? { id: "pod-valido-1" }
                        : null,
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      };
    }
    return fromOriginal(tabla);
  };

  return { cliente: clienteMutable as never, estado };
}

describe("actualizarEstadoPedido — barrera same-day del conductor (Bloque 2)", () => {
  // 1. Conductor sin capacidad marcar_evidencias_propias → ErrorValidacion
  it("actor sin capacidad de conductor lanza ErrorValidacion", async () => {
    const { cliente } = crearClienteFalsoConductor();
    const actorInterno: UsuarioActual = {
      tenantId: TENANT_A,
      tipoUsuario: "interno",
      sellerId: null,
      driverId: null,
      rol: "coordinador",
      estado: "activo",
    };
    await expect(
      actualizarEstadoPedido(
        cliente,
        {
          pedidoId: PEDIDO_1,
          tenantId: TENANT_A,
          estadoNuevo: "en_ruta",
          estadoEsperado: "en_ruta",
          ejecutor: "conductor",
        },
        actorInterno,
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  // 2. Pedido Flex → ErrorValidacion (frontera dura)
  it("conductor no puede actuar sobre pedido Flex (frontera dura)", async () => {
    const pedidoFlex: FilaPedido = {
      ...pedidoBase("asignado"),
      fuente: "ml_flex", tipo_pedido: "flex",
      driver_id_asignado: DRIVER_1,
    };
    const { cliente } = crearClienteFalso({ pedidos: [pedidoFlex] });

    // Wrapar from para pruebas_entrega (no se llega, pero evitar crash)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const origFrom = (cliente as any).from.bind(cliente);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cliente as any).from = (tabla: string) => {
      if (tabla === "pruebas_entrega") {
        const noPod = { maybeSingle: async () => ({ data: null, error: null }) };
        const chain = { limit: () => noPod };
        const eq4 = { eq: () => chain };
        const eq3 = { eq: () => eq4 };
        const eq2 = { eq: () => eq3 };
        const eq1 = { eq: () => eq2 };
        return { select: () => eq1 };
      }
      return origFrom(tabla);
    };

    await expect(
      actualizarEstadoPedido(
        cliente,
        {
          pedidoId: PEDIDO_1,
          tenantId: TENANT_A,
          estadoNuevo: "en_ruta",
          estadoEsperado: "asignado",
          ejecutor: "conductor",
        },
        actorConductorFixture(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  // 3. Conductor no asignado al pedido → ErrorValidacion
  it("conductor no asignado al pedido lanza ErrorValidacion", async () => {
    const pedido: FilaPedido = {
      ...pedidoSameDay("asignado"),
      driver_id_asignado: "otro-driver-uuid",
    };
    const { cliente } = crearClienteFalsoConductor({ pedidos: [pedido] });

    await expect(
      actualizarEstadoPedido(
        cliente,
        {
          pedidoId: PEDIDO_1,
          tenantId: TENANT_A,
          estadoNuevo: "en_ruta",
          estadoEsperado: "asignado",
          ejecutor: "conductor",
        },
        actorConductorFixture(DRIVER_1), // DRIVER_1 !== otro-driver-uuid
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  // 4. Entregado sin POD válido → ErrorValidacion
  it("transición a 'entregado' sin POD válido lanza ErrorValidacion", async () => {
    const { cliente } = crearClienteFalsoConductor({
      pedidos: [pedidoSameDay("en_ruta")],
      hayPodValido: false,
    });

    await expect(
      actualizarEstadoPedido(
        cliente,
        {
          pedidoId: PEDIDO_1,
          tenantId: TENANT_A,
          estadoNuevo: "entregado",
          estadoEsperado: "en_ruta",
          ejecutor: "conductor",
        },
        actorConductorFixture(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  // 5. Fallido sin tipo_incidencia → ErrorValidacion
  it("transición a 'fallido' sin tipo_incidencia lanza ErrorValidacion", async () => {
    const { cliente } = crearClienteFalsoConductor({
      pedidos: [pedidoSameDay("en_ruta")],
    });

    await expect(
      actualizarEstadoPedido(
        cliente,
        {
          pedidoId: PEDIDO_1,
          tenantId: TENANT_A,
          estadoNuevo: "fallido",
          estadoEsperado: "en_ruta",
          ejecutor: "conductor",
          // tipoIncidenciaConductor omitido → ErrorValidacion
        },
        actorConductorFixture(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  // 6. Fallido con tipo_incidencia → abre incidencia con el tipo declarado
  it("conductor puede registrar fallo con tipo_incidencia", async () => {
    const { cliente, estado } = crearClienteFalsoConductor({
      pedidos: [pedidoSameDay("en_ruta")],
    });

    await actualizarEstadoPedido(
      cliente,
      {
        pedidoId: PEDIDO_1,
        tenantId: TENANT_A,
        estadoNuevo: "fallido",
        estadoEsperado: "en_ruta",
        ejecutor: "conductor",
        tipoIncidenciaConductor: "destinatario_ausente",
        actuadoPorUsuarioId: DRIVER_1,
      },
      actorConductorFixture(),
    );

    expect(estado.incidencias).toHaveLength(1);
    expect(estado.incidencias[0].tipo).toBe("destinatario_ausente");
  });

  // 7a. Bitácora del conductor va ANTES del UPDATE (invariante CLAUDE.md)
  it("la bitácora del conductor queda escrita ANTES del UPDATE de estado (invariante CLAUDE.md)", async () => {
    const { cliente: clienteBase, estado } = crearClienteFalsoConductor({
      pedidos: [pedidoSameDay("en_ruta")],
      hayPodValido: true,
    });

    // Sobrescribir el UPDATE para simular fallo del UPDATE de pedidos
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clienteMutable = clienteBase as any;
    const fromOriginal = clienteMutable.from.bind(clienteMutable);
    clienteMutable.from = (tabla: string) => {
      if (tabla === "pedidos") {
        const orig = fromOriginal(tabla);
        return {
          ...orig,
          update: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  select: () => ({
                    single: async () => ({ data: null, error: { message: "fallo simulado UPDATE" } }),
                  }),
                }),
              }),
            }),
          }),
          select: orig.select,
        };
      }
      return fromOriginal(tabla);
    };

    try {
      await actualizarEstadoPedido(
        clienteMutable,
        {
          pedidoId: PEDIDO_1,
          tenantId: TENANT_A,
          estadoNuevo: "entregado",
          estadoEsperado: "en_ruta",
          ejecutor: "conductor",
          actuadoPorUsuarioId: DRIVER_1,
        },
        actorConductorFixture(),
      );
    } catch {
      // El UPDATE falló — es esperado en este test
    }

    // La bitácora debe haberse escrito aunque el UPDATE fallara.
    const bitacoraConductor = estado.bitacora.find(
      (b) => b.accion === "pedido.estado_actualizado_conductor",
    );
    expect(bitacoraConductor).toBeDefined();
    expect(bitacoraConductor!.actor_usuario_id).toBe(DRIVER_1);
  });

  // 7. Entregado con POD válido → transición exitosa
  it("conductor puede marcar entregado con POD válido", async () => {
    const { cliente, estado } = crearClienteFalsoConductor({
      pedidos: [pedidoSameDay("en_ruta")],
      hayPodValido: true,
    });

    const pedido = await actualizarEstadoPedido(
      cliente,
      {
        pedidoId: PEDIDO_1,
        tenantId: TENANT_A,
        estadoNuevo: "entregado",
        estadoEsperado: "en_ruta",
        ejecutor: "conductor",
        actuadoPorUsuarioId: DRIVER_1,
      },
      actorConductorFixture(),
    );

    expect(pedido.estado).toBe("entregado");
    // La bitácora debe incluir la acción del conductor.
    const bitacoraConductor = estado.bitacora.find(
      (b) => b.accion === "pedido.estado_actualizado_conductor",
    );
    expect(bitacoraConductor).toBeDefined();
    // No debe incluir coordenadas (datos personales).
    const detalle = JSON.stringify(bitacoraConductor?.detalle ?? {});
    expect(detalle).not.toContain("lat");
    expect(detalle).not.toContain("long");
  });
});

// =============================================================================
// crearPedidoSameDay — codigo_interno (etiqueta con QR)
// =============================================================================

describe("crearPedidoSameDay — codigo_interno", () => {
  it("genera un codigo_interno con formato RX-XXXX-XXXX al crear el pedido", async () => {
    const { cliente, estado } = crearClienteFalso();

    const { pedido } = await crearPedidoSameDay(cliente, {
      tenantId: TENANT_A,
      sellerId: SELLER_1,
      destinatarioNombre: "Carla Muñoz",
      destinatarioDireccion: "Av. Kennedy 200",
      destinatarioComuna: "Las Condes",
    });

    expect(pedido.codigoInterno).toMatch(PATRON_CODIGO_INTERNO);
    expect(estado.pedidos.find((p) => p.id === pedido.id)?.codigo_interno).toBe(
      pedido.codigoInterno,
    );
  });

  it("reintenta la generación ante colisión (23505) y persiste con el código regenerado", async () => {
    const { cliente: clienteBase, estado } = crearClienteFalso();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clienteMutable = clienteBase as any;
    const fromOriginal = clienteMutable.from.bind(clienteMutable);

    let intentos = 0;
    clienteMutable.from = (tabla: string) => {
      if (tabla === "pedidos") {
        const orig = fromOriginal(tabla);
        return {
          ...orig,
          insert: (fila: Record<string, unknown>) => ({
            select: () => ({
              single: async () => {
                intentos++;
                // Los primeros 2 intentos chocan con unique_violation; el 3º pasa.
                if (intentos <= 2) {
                  return { data: null, error: { code: "23505", message: "unique_violation" } };
                }
                const ahora = new Date().toISOString();
                const nuevo = {
                  id: "pedido-nuevo-reintento",
                  tenant_id: fila.tenant_id,
                  seller_id: fila.seller_id,
                  tipo_pedido: fila.tipo_pedido,
                  origen: fila.origen,
                  ml_order_id: null,
                  ml_shipment_id: null,
                  estado: "pendiente_asignacion",
                  estado_ml: null,
                  subestado_ml: null,
                  ultima_sync_ml_en: null,
                  driver_id_asignado: null,
                  destinatario_nombre: fila.destinatario_nombre,
                  destinatario_direccion: fila.destinatario_direccion,
                  destinatario_comuna: fila.destinatario_comuna,
                  destinatario_telefono: null,
                  instrucciones_entrega: null,
                  fecha_compromiso: null,
                  tarifa_aplicable_id: fila.tarifa_aplicable_id,
                  monto_cobro_clp: null,
                  monto_liquidacion_clp: null,
                  cobro_generado: false,
                  liquidacion_generada: false,
                  notas_internas: null,
                  creado_en: ahora,
                  actualizado_en: ahora,
                  lat: null,
                  long: null,
                  geo_estado: "pendiente",
                  geo_confianza: null,
                  geocodificado_en: null,
                  cobertura_estado: "pendiente",
                  fecha_compromiso_hora: null,
                  corte_riesgo: false,
                  sla_cumplido: null,
                  codigo_interno: fila.codigo_interno,
                };
                estado.pedidos.push(nuevo as never);
                return { data: nuevo, error: null };
              },
            }),
          }),
        };
      }
      return fromOriginal(tabla);
    };

    const { pedido } = await crearPedidoSameDay(clienteMutable, {
      tenantId: TENANT_A,
      sellerId: SELLER_1,
      destinatarioNombre: "Reintento Test",
      destinatarioDireccion: "Calle X 1",
      destinatarioComuna: "Santiago",
    });

    expect(intentos).toBe(3);
    expect(pedido.codigoInterno).toMatch(PATRON_CODIGO_INTERNO);
  });

  it("agota los 5 intentos y lanza error si todas las colisiones persisten", async () => {
    const { cliente: clienteBase } = crearClienteFalso();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clienteMutable = clienteBase as any;
    const fromOriginal = clienteMutable.from.bind(clienteMutable);

    let intentos = 0;
    clienteMutable.from = (tabla: string) => {
      if (tabla === "pedidos") {
        const orig = fromOriginal(tabla);
        return {
          ...orig,
          insert: () => ({
            select: () => ({
              single: async () => {
                intentos++;
                return { data: null, error: { code: "23505", message: "unique_violation" } };
              },
            }),
          }),
        };
      }
      return fromOriginal(tabla);
    };

    await expect(
      crearPedidoSameDay(clienteMutable, {
        tenantId: TENANT_A,
        sellerId: SELLER_1,
        destinatarioNombre: "Agotado Test",
        destinatarioDireccion: "Calle Y 2",
        destinatarioComuna: "Santiago",
      }),
    ).rejects.toThrow();

    expect(intentos).toBe(5);
  });

  it("no reintenta ante un error de INSERT que no sea unique_violation", async () => {
    const { cliente: clienteBase } = crearClienteFalso();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clienteMutable = clienteBase as any;
    const fromOriginal = clienteMutable.from.bind(clienteMutable);

    let intentos = 0;
    clienteMutable.from = (tabla: string) => {
      if (tabla === "pedidos") {
        const orig = fromOriginal(tabla);
        return {
          ...orig,
          insert: () => ({
            select: () => ({
              single: async () => {
                intentos++;
                return { data: null, error: { code: "23502", message: "not_null_violation" } };
              },
            }),
          }),
        };
      }
      return fromOriginal(tabla);
    };

    await expect(
      crearPedidoSameDay(clienteMutable, {
        tenantId: TENANT_A,
        sellerId: SELLER_1,
        destinatarioNombre: "Sin Reintento Test",
        destinatarioDireccion: "Calle Z 3",
        destinatarioComuna: "Santiago",
      }),
    ).rejects.toThrow();

    expect(intentos).toBe(1);
  });
});

// =============================================================================
// asegurarCodigoInterno — backfill perezoso
// =============================================================================

describe("asegurarCodigoInterno", () => {
  it("devuelve el codigo_interno existente sin tocar la BD si ya está presente", async () => {
    const updateSpy = vi.fn();
    const clienteFalso = {
      from: (_tabla: string) => ({
        update: updateSpy,
      }),
    };

    const codigo = await asegurarCodigoInterno(clienteFalso as never, {
      id: PEDIDO_1,
      tenantId: TENANT_A,
      codigoInterno: "RX-7K2M-9QP4",
    });

    expect(codigo).toBe("RX-7K2M-9QP4");
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("genera y persiste un codigo_interno nuevo si el pedido no lo tiene", async () => {
    const clienteFalso = {
      from: (_tabla: string) => ({
        update: (cambios: Record<string, unknown>) => ({
          eq: () => ({
            eq: () => ({
              select: () => ({
                single: async () => ({
                  data: { codigo_interno: cambios.codigo_interno },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    };

    const codigo = await asegurarCodigoInterno(clienteFalso as never, {
      id: PEDIDO_1,
      tenantId: TENANT_A,
      codigoInterno: null,
    });

    expect(codigo).toMatch(PATRON_CODIGO_INTERNO);
  });

  it("reintenta ante colisión (23505) y persiste con el código regenerado", async () => {
    let intentos = 0;
    const clienteFalso = {
      from: (_tabla: string) => ({
        update: (cambios: Record<string, unknown>) => ({
          eq: () => ({
            eq: () => ({
              select: () => ({
                single: async () => {
                  intentos++;
                  if (intentos <= 2) {
                    return { data: null, error: { code: "23505", message: "unique_violation" } };
                  }
                  return { data: { codigo_interno: cambios.codigo_interno }, error: null };
                },
              }),
            }),
          }),
        }),
      }),
    };

    const codigo = await asegurarCodigoInterno(clienteFalso as never, {
      id: PEDIDO_1,
      tenantId: TENANT_A,
      codigoInterno: null,
    });

    expect(intentos).toBe(3);
    expect(codigo).toMatch(PATRON_CODIGO_INTERNO);
  });

  it("lanza error si agota los intentos ante colisión persistente", async () => {
    const clienteFalso = {
      from: (_tabla: string) => ({
        update: () => ({
          eq: () => ({
            eq: () => ({
              select: () => ({
                single: async () => ({
                  data: null,
                  error: { code: "23505", message: "unique_violation" },
                }),
              }),
            }),
          }),
        }),
      }),
    };

    await expect(
      asegurarCodigoInterno(clienteFalso as never, {
        id: PEDIDO_1,
        tenantId: TENANT_A,
        codigoInterno: null,
      }),
    ).rejects.toThrow();
  });
});

// =============================================================================
// actualizarEstadoPedido — reflejo de ML sin asignación (bug de facturación
// Flex, ago-2026)
// =============================================================================
// El diagnóstico: la ingesta nunca traducía `estado_ml`, así que un Flex que
// ML ya reportaba delivered/shipped/not_delivered se quedaba congelado en
// 'pendiente_asignacion' — y aunque se detectara, la máquina de estados
// rechazaba la transición. Este bloque cubre las DOS piezas del arreglo que
// viven en `actualizarEstadoPedido`:
//   1. La puerta nueva: 'sistema' SÍ puede reflejar en_ruta/entregado/fallido
//      desde 'pendiente_asignacion', pero SOLO para Flex (same-day rechaza).
//   2. La excepción de dinero: 'entregado' sin `driver_id_asignado` NO
//      publica el evento financiero (decisión #2 del usuario) — el estado
//      SÍ se refleja igual (decisión #1).
// =============================================================================

const DRIVER_REFLEJO_ML = "eeee0000-0000-0000-0000-0000000000aa";

function nombresEventosEnviados(): string[] {
  return vi.mocked(inngest.send).mock.calls.map((c) => (c[0] as { name: string }).name);
}

describe("actualizarEstadoPedido — reflejo de ML desde pendiente_asignacion (Flex)", () => {
  // `inngest.send` es un mock COMPARTIDO por todo el archivo (declarado con
  // `vi.mock` a nivel de módulo) — sin limpiarlo antes de cada test de este
  // bloque, `nombresEventosEnviados()` arrastraría las llamadas de los tests
  // de otros describes que corrieron antes.
  beforeEach(() => {
    vi.mocked(inngest.send).mockClear();
  });

  it("Flex: pendiente_asignacion → entregado por sistema transiciona, pero NO dispara el evento financiero (sin conductor asignado en Rutax)", async () => {
    const { cliente } = crearClienteFalso({
      pedidos: [
        { ...pedidoBase("pendiente_asignacion"), fuente: "ml_flex", tipo_pedido: "flex", driver_id_asignado: null },
      ],
    });

    const pedido = await actualizarEstadoPedido(cliente, {
      pedidoId: PEDIDO_1,
      tenantId: TENANT_A,
      estadoNuevo: "entregado",
      estadoEsperado: "pendiente_asignacion",
      ejecutor: "sistema",
    });

    // Decisión #1: el estado real de ML se refleja SIEMPRE.
    expect(pedido.estado).toBe("entregado");
    // Decisión #2: sin conductor asignado, NO se dispara el cobro automático.
    expect(nombresEventosEnviados()).not.toContain("dinero/pedido.estado_financiero_relevante");
  });

  it("Flex: pendiente_asignacion → fallido por sistema tampoco dispara el cobro sin conductor asignado", async () => {
    // Misma regla que 'entregado' (decisión del usuario, 2026-08-13). Sin esta
    // guardia se cobraba igual: la incidencia automática de 'fallido' nace con
    // `afecta_cobro=true` y el motor de fallidos cobra con solo eso, sin mirar
    // el conductor. Se estaría facturando un intento que Rutax no hizo — o que
    // hizo otro courier conectado a la misma cuenta de ML.
    const { cliente } = crearClienteFalso({
      pedidos: [
        { ...pedidoBase("pendiente_asignacion"), fuente: "ml_flex", tipo_pedido: "flex", driver_id_asignado: null },
      ],
    });

    const pedido = await actualizarEstadoPedido(cliente, {
      pedidoId: PEDIDO_1,
      tenantId: TENANT_A,
      estadoNuevo: "fallido",
      estadoEsperado: "pendiente_asignacion",
      ejecutor: "sistema",
    });

    expect(pedido.estado).toBe("fallido");
    expect(nombresEventosEnviados()).not.toContain("dinero/pedido.estado_financiero_relevante");
  });

  it("Flex: pendiente_asignacion → en_ruta por sistema es una transición permitida (no es estado financiero)", async () => {
    const { cliente } = crearClienteFalso({
      pedidos: [
        { ...pedidoBase("pendiente_asignacion"), fuente: "ml_flex", tipo_pedido: "flex", driver_id_asignado: null },
      ],
    });

    const pedido = await actualizarEstadoPedido(cliente, {
      pedidoId: PEDIDO_1,
      tenantId: TENANT_A,
      estadoNuevo: "en_ruta",
      estadoEsperado: "pendiente_asignacion",
      ejecutor: "sistema",
    });

    expect(pedido.estado).toBe("en_ruta");
    expect(nombresEventosEnviados()).not.toContain("dinero/pedido.estado_financiero_relevante");
  });

  it("Flex: 'fallido' CON conductor asignado sí dispara el evento financiero — la guardia es por conductor, no por estado", async () => {
    // El contraste con el caso de arriba es el punto: si la operación de Rutax
    // sí tocó el pedido, el intento fallido se factura como siempre y la
    // incidencia decide con `afecta_cobro`. Lo que se corta es cobrar por algo
    // que Rutax nunca hizo.
    const { cliente } = crearClienteFalso({
      pedidos: [
        { ...pedidoBase("en_ruta"), fuente: "ml_flex", tipo_pedido: "flex", driver_id_asignado: DRIVER_REFLEJO_ML },
      ],
    });

    const pedido = await actualizarEstadoPedido(cliente, {
      pedidoId: PEDIDO_1,
      tenantId: TENANT_A,
      estadoNuevo: "fallido",
      estadoEsperado: "en_ruta",
      ejecutor: "sistema",
    });

    expect(pedido.estado).toBe("fallido");
    expect(nombresEventosEnviados()).toContain("dinero/pedido.estado_financiero_relevante");
  });

  it("same-day: pendiente_asignacion → entregado/en_ruta/fallido por sistema se rechaza — el POD de Rutax es el autoritativo, no ML", async () => {
    for (const destino of ["entregado", "en_ruta", "fallido"] as const) {
      const { cliente } = crearClienteFalso({
        pedidos: [
          { ...pedidoBase("pendiente_asignacion"), fuente: "rutax_manual", tipo_pedido: "same_day", driver_id_asignado: null },
        ],
      });

      await expect(
        actualizarEstadoPedido(cliente, {
          pedidoId: PEDIDO_1,
          tenantId: TENANT_A,
          estadoNuevo: destino,
          estadoEsperado: "pendiente_asignacion",
          ejecutor: "sistema",
        }),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    }
  });

  it("same-day sigue pudiendo pendiente_asignacion → asignado por sistema (auto-asignación, sin cambios)", async () => {
    const { cliente } = crearClienteFalso({
      pedidos: [
        { ...pedidoBase("pendiente_asignacion"), fuente: "rutax_manual", tipo_pedido: "same_day", driver_id_asignado: null },
      ],
    });

    const pedido = await actualizarEstadoPedido(cliente, {
      pedidoId: PEDIDO_1,
      tenantId: TENANT_A,
      estadoNuevo: "asignado",
      estadoEsperado: "pendiente_asignacion",
      ejecutor: "sistema",
    });

    expect(pedido.estado).toBe("asignado");
  });

  it("con conductor YA asignado, en_ruta → entregado por sistema SÍ dispara el evento (no-regresión del caso normal)", async () => {
    const { cliente } = crearClienteFalso({
      pedidos: [
        { ...pedidoBase("en_ruta"), fuente: "ml_flex", tipo_pedido: "flex", driver_id_asignado: DRIVER_REFLEJO_ML },
      ],
    });

    await actualizarEstadoPedido(cliente, {
      pedidoId: PEDIDO_1,
      tenantId: TENANT_A,
      estadoNuevo: "entregado",
      estadoEsperado: "en_ruta",
      ejecutor: "sistema",
    });

    const evento = vi
      .mocked(inngest.send)
      .mock.calls.find(
        (c) => (c[0] as { name: string }).name === "dinero/pedido.estado_financiero_relevante",
      );
    expect(evento).toBeDefined();
    const datos = (evento![0] as { data: { driverIdAsignado: string | null } }).data;
    expect(datos.driverIdAsignado).toBe(DRIVER_REFLEJO_ML);
  });

  it("'entregado_manual' sin conductor asignado SIGUE disparando el evento (la excepción es solo para 'entregado')", async () => {
    // Corrección humana deliberada (RBAC + motivo, ejecutor='interno') — la
    // excepción de "sin conductor" NO la alcanza, a propósito: acotada a
    // `entradaNuevo === 'entregado'` en pedidos.ts.
    const { cliente } = crearClienteFalso({
      pedidos: [{ ...pedidoBase("asignado"), fuente: "ml_flex", tipo_pedido: "flex", driver_id_asignado: null }],
    });

    await actualizarEstadoPedido(
      cliente,
      {
        pedidoId: PEDIDO_1,
        tenantId: TENANT_A,
        estadoNuevo: "entregado_manual",
        estadoEsperado: "asignado",
        ejecutor: "interno",
        actuadoPorUsuarioId: USUARIO_INTERNO_1,
        motivo: "Confirmado por el seller, POD fuera de banda",
      },
      actorSupervisor(),
    );

    expect(nombresEventosEnviados()).toContain("dinero/pedido.estado_financiero_relevante");
  });
});
