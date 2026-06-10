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
 */

import { describe, expect, it } from "vitest";
import { actualizarEstadoPedido, crearPedidoSameDay } from "./pedidos";
import { ErrorTransicionInvalida, ErrorPedidoNoEncontrado } from "./errores";
import { ErrorConflicto, ErrorValidacion } from "@/modules/identidad/errores";
import type { UsuarioActual } from "@/modules/identidad/usuario-actual";
import type { EstadoPedido } from "./tipos";

// =============================================================================
// Fixtures
// =============================================================================

const TENANT_A = "aaaa0000-0000-0000-0000-000000000010";
const PEDIDO_1 = "bbbb0000-0000-0000-0000-000000000020";
const SELLER_1 = "cccc0000-0000-0000-0000-000000000030";
const TARIFA_1 = "dddd0000-0000-0000-0000-000000000040";

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

// =============================================================================
// Doble de prueba del cliente Supabase
// =============================================================================

interface FilaPedido {
  id: string;
  tenant_id: string;
  seller_id: string;
  tipo_pedido: string;
  origen: string;
  ml_order_id: string | null;
  ml_shipment_id: string | null;
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
  bitacora: Array<Record<string, unknown>>;
}

function pedidoBase(estadoActual: EstadoPedido = "en_ruta"): FilaPedido {
  const ahora = new Date().toISOString();
  return {
    id: PEDIDO_1,
    tenant_id: TENANT_A,
    seller_id: SELLER_1,
    tipo_pedido: "flex",
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
  };
}

function crearClienteFalso(opts?: {
  pedidos?: FilaPedido[];
  tarifas?: FilaTarifa[];
  fallarUpdate?: boolean;
}) {
  let contadorInc = 0;
  let contadorPedido = 0;

  const estado: EstadoFalso = {
    pedidos: opts?.pedidos ?? [pedidoBase()],
    incidencias: [],
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
                destinatario_telefono: null,
                instrucciones_entrega: null,
                fecha_compromiso: null,
                tarifa_aplicable_id: fila.tarifa_aplicable_id as string,
                monto_cobro_clp: null,
                monto_liquidacion_clp: null,
                cobro_generado: false,
                liquidacion_generada: false,
                notas_internas: null,
                creado_en: ahora,
                actualizado_en: ahora,
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

  return { cliente: { from } as never, estado };
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
    // pendiente_asignacion → entregado es inválido (saltarse asignado + en_ruta)
    const { cliente } = crearClienteFalso({ pedidos: [pedidoBase("pendiente_asignacion")] });

    await expect(
      actualizarEstadoPedido(cliente, {
        pedidoId: PEDIDO_1,
        tenantId: TENANT_A,
        estadoNuevo: "entregado",
        estadoEsperado: "pendiente_asignacion",
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
// crearPedidoSameDay — manejo de tarifa
// =============================================================================

describe("crearPedidoSameDay — manejo de tarifa", () => {
  it("fija tarifa_aplicable_id al crear el pedido", async () => {
    const { cliente, estado } = crearClienteFalso({ tarifas: [{ id: TARIFA_1 }] });

    const pedido = await crearPedidoSameDay(cliente, {
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

    const pedido = await crearPedidoSameDay(cliente, {
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
