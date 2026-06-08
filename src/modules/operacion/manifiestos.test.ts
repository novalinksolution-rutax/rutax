/**
 * Pruebas del módulo de manifiestos.
 *
 * Cubre:
 * 1. Reasignación desactiva la asignación previa.
 * 2. Pedido de otro tenant lanza ErrorConflicto.
 * 3. Asignar el mismo pedido al mismo manifiesto dos veces es idempotente.
 * 4. Actor sin capacidad recibe ErrorValidacion.
 * 5. confirmarManifiesto requiere estado 'borrador'.
 */

import { describe, expect, it } from "vitest";
import { asignarPedidosAManifiesto, crearManifiesto, confirmarManifiesto } from "./manifiestos";
import { ErrorValidacion, ErrorConflicto } from "@/modules/identidad/errores";
import type { UsuarioActual } from "@/modules/identidad/usuario-actual";

// =============================================================================
// Fixtures
// =============================================================================

const TENANT_A = "aaaa1111-0000-0000-0000-000000000001";
const TENANT_B = "bbbb2222-0000-0000-0000-000000000002";
const DRIVER_1 = "dddd0000-0000-0000-0000-000000000010";
const SELLER_1 = "ssss0000-0000-0000-0000-000000000020";
const MANIFIESTO_A = "mmmm0000-0000-0000-0000-000000000030";
const MANIFIESTO_B = "mmmm0000-0000-0000-0000-000000000031";
const PEDIDO_1 = "pppp0000-0000-0000-0000-000000000040";
const PEDIDO_2 = "pppp0000-0000-0000-0000-000000000041";

function actorCoordinador(tenantId: string = TENANT_A): UsuarioActual {
  return {
    tenantId,
    tipoUsuario: "interno",
    sellerId: null,
    driverId: null,
    rol: "coordinador",
    estado: "activo",
  };
}

function actorSeller(): UsuarioActual {
  return {
    tenantId: TENANT_A,
    tipoUsuario: "seller",
    sellerId: SELLER_1,
    driverId: null,
    rol: "seller",
    estado: "activo",
  };
}

// =============================================================================
// Doble de prueba del cliente Supabase
// =============================================================================

interface FilaManifiesto {
  id: string;
  tenant_id: string;
  driver_id: string;
  nombre: string;
  fecha_operacion: string;
  estado: string;
  notas: string | null;
  creado_por_usuario_id: string | null;
  confirmado_en: string | null;
  completado_en: string | null;
  creado_en: string;
  actualizado_en: string;
}

interface FilaAsignacion {
  id: string;
  tenant_id: string;
  pedido_id: string;
  manifiesto_id: string;
  driver_id: string;
  seller_id: string;
  activa: boolean;
  asignado_por_usuario_id: string | null;
  asignado_en: string;
  desasignado_en: string | null;
}

interface FilaPedido {
  id: string;
  tenant_id: string;
  seller_id: string;
  estado: string;
}

interface EstadoFalso {
  manifiestos: FilaManifiesto[];
  asignaciones: FilaAsignacion[];
  pedidos: FilaPedido[];
  bitacora: Array<Record<string, unknown>>;
}

function crearClienteFalso(seed?: {
  manifiestos?: FilaManifiesto[];
  asignaciones?: FilaAsignacion[];
  pedidos?: FilaPedido[];
}) {
  let contadorManifiesto = 0;
  let contadorAsignacion = 0;

  const estado: EstadoFalso = {
    manifiestos: seed?.manifiestos ?? [
      {
        id: MANIFIESTO_A,
        tenant_id: TENANT_A,
        driver_id: DRIVER_1,
        nombre: "Ruta A",
        fecha_operacion: "2026-06-08",
        estado: "borrador",
        notas: null,
        creado_por_usuario_id: null,
        confirmado_en: null,
        completado_en: null,
        creado_en: new Date().toISOString(),
        actualizado_en: new Date().toISOString(),
      },
    ],
    asignaciones: seed?.asignaciones ?? [],
    pedidos: seed?.pedidos ?? [
      { id: PEDIDO_1, tenant_id: TENANT_A, seller_id: SELLER_1, estado: "pendiente_asignacion" },
      { id: PEDIDO_2, tenant_id: TENANT_A, seller_id: SELLER_1, estado: "pendiente_asignacion" },
    ],
    bitacora: [],
  };

  function from(tabla: string) {
    // --- manifiestos ---
    if (tabla === "manifiestos") {
      return {
        select: (_cols?: string) => {
          const filtros: Array<[string, unknown]> = [];

          function buildChain() {
            return {
              eq(c: string, v: unknown) {
                filtros.push([c, v]);
                return buildChain();
              },
              maybeSingle: async () => {
                const fila = estado.manifiestos.find((m) =>
                  filtros.every(([c, v]) => (m as unknown as Record<string, unknown>)[c] === v),
                );
                return { data: fila ?? null, error: null };
              },
              in(_c: string, _vals: string[]) { return buildChain(); },
              order() { return buildChain(); },
              limit() { return buildChain(); },
            };
          }

          return buildChain();
        },
        insert: (fila: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              const ahora = new Date().toISOString();
              const nuevo: FilaManifiesto = {
                id: `man-${++contadorManifiesto}`,
                tenant_id: fila.tenant_id as string,
                driver_id: fila.driver_id as string,
                nombre: fila.nombre as string,
                fecha_operacion: fila.fecha_operacion as string,
                estado: "borrador",
                notas: (fila.notas as string | null) ?? null,
                creado_por_usuario_id: (fila.creado_por_usuario_id as string | null) ?? null,
                confirmado_en: null,
                completado_en: null,
                creado_en: ahora,
                actualizado_en: ahora,
              };
              estado.manifiestos.push(nuevo);
              return { data: nuevo, error: null };
            },
          }),
        }),
        update: (cambios: Record<string, unknown>) => {
          const filtros: Array<[string, unknown]> = [];

          function buildUpdate() {
            return {
              eq(c: string, v: unknown) {
                filtros.push([c, v]);
                return buildUpdate();
              },
              select: () => ({
                single: async () => {
                  const idx = estado.manifiestos.findIndex((m) =>
                    filtros.every(([c, v]) => (m as unknown as Record<string, unknown>)[c] === v),
                  );
                  if (idx < 0) return { data: null, error: null };
                  estado.manifiestos[idx] = { ...estado.manifiestos[idx], ...cambios } as FilaManifiesto;
                  return { data: estado.manifiestos[idx], error: null };
                },
              }),
            };
          }

          return buildUpdate();
        },
      };
    }

    // --- pedidos ---
    if (tabla === "pedidos") {
      return {
        select: (_cols?: string) => {
          const filtros: Array<[string, unknown]> = [];

          function buildChain() {
            return {
              eq(c: string, v: unknown) {
                filtros.push([c, v]);
                return buildChain();
              },
              in(_c: string, _vals: string[]) { return buildChain(); },
              then(resolve: (r: { data: FilaPedido[]; error: null }) => void) {
                const filtradas = estado.pedidos.filter((p) =>
                  filtros.every(([c, v]) => (p as unknown as Record<string, unknown>)[c] === v),
                );
                resolve({ data: filtradas, error: null });
              },
            };
          }

          return buildChain();
        },
        update: (_cambios: Record<string, unknown>) => {
          return {
            eq: (_c: string, _v: unknown) => ({
              eq: (_c2: string, _v2: unknown) => Promise.resolve({ data: null, error: null }),
            }),
          };
        },
      };
    }

    // --- asignaciones_pedido ---
    if (tabla === "asignaciones_pedido") {
      return {
        select: (_cols?: string) => {
          const filtros: Array<[string, unknown]> = [];

          function buildChain() {
            return {
              eq(c: string, v: unknown) {
                filtros.push([c, v]);
                return buildChain();
              },
              in(_c: string, _vals: string[]) { return buildChain(); },
              then(resolve: (r: { data: FilaAsignacion[]; error: null }) => void) {
                const filtradas = estado.asignaciones.filter((a) =>
                  filtros.every(([c, v]) => (a as unknown as Record<string, unknown>)[c] === v),
                );
                resolve({ data: filtradas, error: null });
              },
            };
          }

          return buildChain();
        },
        insert: (fila: Record<string, unknown>) => {
          const ahora = new Date().toISOString();
          const nueva: FilaAsignacion = {
            id: `asig-${++contadorAsignacion}`,
            tenant_id: fila.tenant_id as string,
            pedido_id: fila.pedido_id as string,
            manifiesto_id: fila.manifiesto_id as string,
            driver_id: fila.driver_id as string,
            seller_id: fila.seller_id as string,
            activa: fila.activa as boolean,
            asignado_por_usuario_id: null,
            asignado_en: ahora,
            desasignado_en: null,
          };
          estado.asignaciones.push(nueva);
          return { error: null };
        },
        update: (cambios: Record<string, unknown>) => {
          const filtros: Array<[string, unknown]> = [];

          function buildUpdate() {
            return {
              eq(c: string, v: unknown) {
                filtros.push([c, v]);
                return buildUpdate();
              },
              then(resolve: (r: { data: null; error: null }) => void) {
                const idx = estado.asignaciones.findIndex((a) =>
                  filtros.every(([c, v]) => (a as unknown as Record<string, unknown>)[c] === v),
                );
                if (idx >= 0) {
                  estado.asignaciones[idx] = { ...estado.asignaciones[idx], ...cambios } as FilaAsignacion;
                }
                resolve({ data: null, error: null });
              },
            };
          }

          return buildUpdate();
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

  return { cliente: { from } as never, estado };
}

// =============================================================================
// asignarPedidosAManifiesto — reasignación desactiva la asignación previa
// =============================================================================

describe("asignarPedidosAManifiesto — reasignación", () => {
  it("desactiva la asignación previa cuando el pedido ya estaba en otro manifiesto", async () => {
    const ahora = new Date().toISOString();

    // PEDIDO_1 ya estaba activo en MANIFIESTO_B
    const asignacionPrevia: FilaAsignacion = {
      id: "asig-previa",
      tenant_id: TENANT_A,
      pedido_id: PEDIDO_1,
      manifiesto_id: MANIFIESTO_B, // otro manifiesto
      driver_id: DRIVER_1,
      seller_id: SELLER_1,
      activa: true,
      asignado_por_usuario_id: null,
      asignado_en: ahora,
      desasignado_en: null,
    };

    const { cliente, estado } = crearClienteFalso({
      asignaciones: [asignacionPrevia],
    });

    // Asignar PEDIDO_1 a MANIFIESTO_A (diferente)
    await asignarPedidosAManifiesto(cliente, MANIFIESTO_A, [PEDIDO_1]);

    // La asignación previa debe estar desactivada
    const previa = estado.asignaciones.find((a) => a.id === "asig-previa");
    expect(previa).toBeDefined();
    expect(previa!.activa).toBe(false);
    expect(previa!.desasignado_en).not.toBeNull();

    // Una nueva asignación activa al manifiesto A debe existir
    const nueva = estado.asignaciones.find(
      (a) => a.pedido_id === PEDIDO_1 && a.manifiesto_id === MANIFIESTO_A && a.activa,
    );
    expect(nueva).toBeDefined();
  });

  it("asignar el mismo pedido al mismo manifiesto dos veces es idempotente (no duplica)", async () => {
    const ahora = new Date().toISOString();

    // PEDIDO_1 ya está activo en MANIFIESTO_A
    const asignacionExistente: FilaAsignacion = {
      id: "asig-existente",
      tenant_id: TENANT_A,
      pedido_id: PEDIDO_1,
      manifiesto_id: MANIFIESTO_A, // mismo manifiesto
      driver_id: DRIVER_1,
      seller_id: SELLER_1,
      activa: true,
      asignado_por_usuario_id: null,
      asignado_en: ahora,
      desasignado_en: null,
    };

    const { cliente, estado } = crearClienteFalso({
      asignaciones: [asignacionExistente],
    });

    // Volver a asignar PEDIDO_1 al mismo MANIFIESTO_A
    await asignarPedidosAManifiesto(cliente, MANIFIESTO_A, [PEDIDO_1]);

    // Solo debe existir la asignación original, no se creó una nueva.
    const asignacionesActivas = estado.asignaciones.filter(
      (a) => a.pedido_id === PEDIDO_1 && a.activa,
    );
    expect(asignacionesActivas).toHaveLength(1);
    expect(asignacionesActivas[0].id).toBe("asig-existente");
  });
});

// =============================================================================
// asignarPedidosAManifiesto — aislamiento de tenant
// =============================================================================

describe("asignarPedidosAManifiesto — aislamiento de tenant", () => {
  it("lanza ErrorConflicto si un pedido no pertenece al mismo tenant que el manifiesto", async () => {
    // El pedido PEDIDO_2 es del TENANT_B, pero el manifiesto es del TENANT_A
    const pedidoTenantB: FilaPedido = {
      id: PEDIDO_2,
      tenant_id: TENANT_B, // diferente tenant
      seller_id: SELLER_1,
      estado: "pendiente_asignacion",
    };

    const { cliente } = crearClienteFalso({
      pedidos: [
        { id: PEDIDO_1, tenant_id: TENANT_A, seller_id: SELLER_1, estado: "pendiente_asignacion" },
        pedidoTenantB,
      ],
    });

    await expect(
      asignarPedidosAManifiesto(cliente, MANIFIESTO_A, [PEDIDO_2]),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });
});

// =============================================================================
// asignarPedidosAManifiesto — control de acceso
// =============================================================================

describe("asignarPedidosAManifiesto — control de acceso", () => {
  it("un seller sin capacidad asignar_y_reasignar_pedidos recibe ErrorValidacion", async () => {
    const { cliente } = crearClienteFalso();

    await expect(
      asignarPedidosAManifiesto(cliente, MANIFIESTO_A, [PEDIDO_1], actorSeller()),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it("un coordinador con capacidad puede asignar", async () => {
    const { cliente, estado } = crearClienteFalso();

    await asignarPedidosAManifiesto(cliente, MANIFIESTO_A, [PEDIDO_1], actorCoordinador());

    const nuevaAsignacion = estado.asignaciones.find(
      (a) => a.pedido_id === PEDIDO_1 && a.manifiesto_id === MANIFIESTO_A && a.activa,
    );
    expect(nuevaAsignacion).toBeDefined();
  });
});

// =============================================================================
// crearManifiesto — control de acceso
// =============================================================================

describe("crearManifiesto — control de acceso", () => {
  it("un seller sin capacidad generar_manifiestos recibe ErrorValidacion", async () => {
    const { cliente } = crearClienteFalso();

    await expect(
      crearManifiesto(
        cliente,
        { tenantId: TENANT_A, driverId: DRIVER_1, nombre: "Ruta Test", fechaOperacion: "2026-06-08" },
        actorSeller(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it("un coordinador puede crear manifiestos", async () => {
    const { cliente, estado } = crearClienteFalso();

    const manifiesto = await crearManifiesto(
      cliente,
      { tenantId: TENANT_A, driverId: DRIVER_1, nombre: "Ruta Lunes", fechaOperacion: "2026-06-09" },
      actorCoordinador(),
    );

    expect(manifiesto.id).toBeTruthy();
    expect(manifiesto.estado).toBe("borrador");
    expect(estado.manifiestos.some((m) => m.id === manifiesto.id)).toBe(true);
  });
});

// =============================================================================
// confirmarManifiesto — transición de estado
// =============================================================================

describe("confirmarManifiesto", () => {
  it("confirma un manifiesto 'borrador' → 'confirmado'", async () => {
    const { cliente } = crearClienteFalso();

    const confirmado = await confirmarManifiesto(cliente, MANIFIESTO_A, TENANT_A);

    expect(confirmado.estado).toBe("confirmado");
    expect(confirmado.confirmadoEn).not.toBeNull();
  });

  it("lanza ErrorConflicto si el manifiesto no está en 'borrador'", async () => {
    const { cliente } = crearClienteFalso({
      manifiestos: [
        {
          id: MANIFIESTO_A,
          tenant_id: TENANT_A,
          driver_id: DRIVER_1,
          nombre: "Ruta A",
          fecha_operacion: "2026-06-08",
          estado: "confirmado", // ya confirmado
          notas: null,
          creado_por_usuario_id: null,
          confirmado_en: new Date().toISOString(),
          completado_en: null,
          creado_en: new Date().toISOString(),
          actualizado_en: new Date().toISOString(),
        },
      ],
    });

    await expect(
      confirmarManifiesto(cliente, MANIFIESTO_A, TENANT_A),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it("lanza ErrorConflicto si el manifiesto no pertenece al tenant", async () => {
    const { cliente } = crearClienteFalso();

    await expect(
      confirmarManifiesto(cliente, MANIFIESTO_A, TENANT_B), // tenant incorrecto
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });
});
