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
import { asignarPedidosAManifiesto, crearManifiesto, confirmarManifiesto, completarManifiesto } from "./manifiestos";
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
// UUID de auth del usuario que dispara las acciones (RNF-04 — el "quién").
const USUARIO_ID = "uuuu0000-0000-0000-0000-000000000001";

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
        select: (_cols?: string, _opts?: Record<string, unknown>) => {
          const filtros: Array<[string, unknown]> = [];

          function buildChain() {
            return {
              eq(c: string, v: unknown) {
                filtros.push([c, v]);
                return buildChain();
              },
              in(_c: string, _vals: string[]) { return buildChain(); },
              then(resolve: (r: { data: FilaAsignacion[] | null; count: number; error: null }) => void) {
                const filtradas = estado.asignaciones.filter((a) =>
                  filtros.every(([c, v]) => (a as unknown as Record<string, unknown>)[c] === v),
                );
                // Con head:true Supabase devuelve data=null y count=N.
                // El mock devuelve ambos para que el código de producción funcione
                // independientemente de si usa data o count.
                resolve({ data: filtradas, count: filtradas.length, error: null });
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

    // NOTA (2026-08-14): este doble tenía un caso "ubicacion_conductor" para el
    // borrado de GPS que `completarManifiesto` hacía al cerrar la ruta (ALTO-1).
    // Ese borrado se retiró junto con todo el rastreo en vivo del conductor —
    // ver docs/seguridad/punto-de-termino-conductor.md §1. `completarManifiesto`
    // ya no consulta esta tabla; por eso NO hay caso para ella aquí abajo, y
    // por eso el `throw` de más abajo es la aserción: si algo la vuelve a
    // llamar, este doble lo revienta en vez de dejarlo pasar en silencio.
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

    await asignarPedidosAManifiesto(cliente, MANIFIESTO_A, [PEDIDO_1], actorCoordinador(), USUARIO_ID);

    const nuevaAsignacion = estado.asignaciones.find(
      (a) => a.pedido_id === PEDIDO_1 && a.manifiesto_id === MANIFIESTO_A && a.activa,
    );
    expect(nuevaAsignacion).toBeDefined();
  });

  it("la bitácora de asignación lleva actor_usuario_id no nulo (RNF-04 / H-1)", async () => {
    // Regresión: antes se registraba actorUsuarioId: null incluso con actor real.
    const { cliente, estado } = crearClienteFalso();

    await asignarPedidosAManifiesto(
      cliente,
      MANIFIESTO_A,
      [PEDIDO_1],
      actorCoordinador(),
      USUARIO_ID,
    );

    const entrada = estado.bitacora.find(
      (e) => e.accion === "manifiesto.pedidos_asignados",
    );
    expect(entrada).toBeDefined();
    expect(entrada!.actor_usuario_id).toBe(USUARIO_ID);
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

// =============================================================================
// asignarPedidosAManifiesto — BUG: asignación a manifiesto ya confirmado
// =============================================================================

describe("asignarPedidosAManifiesto — manifiesto en estado no-borrador (BUG)", () => {
  it("BUG: asignar pedido a un manifiesto 'confirmado' debería lanzar ErrorConflicto", async () => {
    // El manifiesto ya está confirmado — no debe aceptar nuevas asignaciones
    const { cliente } = crearClienteFalso({
      manifiestos: [
        {
          id: MANIFIESTO_A,
          tenant_id: TENANT_A,
          driver_id: DRIVER_1,
          nombre: "Ruta A",
          fecha_operacion: "2026-06-08",
          estado: "confirmado", // <-- ya confirmado
          notas: null,
          creado_por_usuario_id: null,
          confirmado_en: new Date().toISOString(),
          completado_en: null,
          creado_en: new Date().toISOString(),
          actualizado_en: new Date().toISOString(),
        },
      ],
    });

    // Un manifiesto confirmado NO debe aceptar nuevas asignaciones de pedidos.
    // La ruta operacional correcta sería volver a borrador o crear un nuevo manifiesto.
    await expect(
      asignarPedidosAManifiesto(cliente, MANIFIESTO_A, [PEDIDO_1]),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it("BUG: asignar pedido a un manifiesto 'en_ruta' debería lanzar ErrorConflicto", async () => {
    const { cliente } = crearClienteFalso({
      manifiestos: [
        {
          id: MANIFIESTO_A,
          tenant_id: TENANT_A,
          driver_id: DRIVER_1,
          nombre: "Ruta A",
          fecha_operacion: "2026-06-08",
          estado: "en_ruta", // conductor ya salió
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
      asignarPedidosAManifiesto(cliente, MANIFIESTO_A, [PEDIDO_1]),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });
});

// =============================================================================
// confirmarManifiesto
// =============================================================================

describe("confirmarManifiesto", () => {
  function conAsignacionActiva() {
    const ahora = new Date().toISOString();
    return crearClienteFalso({
      asignaciones: [
        {
          id: "asig-para-confirmar",
          tenant_id: TENANT_A,
          pedido_id: PEDIDO_1,
          manifiesto_id: MANIFIESTO_A,
          driver_id: DRIVER_1,
          seller_id: SELLER_1,
          activa: true,
          asignado_por_usuario_id: null,
          asignado_en: ahora,
          desasignado_en: null,
        },
      ],
    });
  }

  it("confirma un manifiesto 'borrador' → 'confirmado'", async () => {
    const { cliente } = conAsignacionActiva();

    const confirmado = await confirmarManifiesto(cliente, MANIFIESTO_A, TENANT_A);

    expect(confirmado.estado).toBe("confirmado");
    expect(confirmado.confirmadoEn).not.toBeNull();
  });

  it("la bitácora de confirmación lleva actor_usuario_id no nulo (RNF-04 / H-1)", async () => {
    // Regresión: antes se registraba actorUsuarioId: null incluso con actor real.
    const { cliente, estado } = conAsignacionActiva();

    await confirmarManifiesto(
      cliente,
      MANIFIESTO_A,
      TENANT_A,
      actorCoordinador(),
      USUARIO_ID,
    );

    const entrada = estado.bitacora.find((e) => e.accion === "manifiesto.confirmado");
    expect(entrada).toBeDefined();
    expect(entrada!.actor_usuario_id).toBe(USUARIO_ID);
  });

  it("BUG: confirmar un manifiesto sin pedidos asignados debería lanzar ErrorConflicto", async () => {
    // El manifiesto existe en borrador pero no tiene ningún pedido asignado.
    // Confirmar un manifiesto vacío no tiene sentido operacional:
    // el conductor saldría sin entregas.
    const { cliente } = crearClienteFalso({
      asignaciones: [], // sin asignaciones
    });

    // Si el código actual NO lanza, es un bug: los manifiestos vacíos no deben confirmarse.
    await expect(
      confirmarManifiesto(cliente, MANIFIESTO_A, TENANT_A),
    ).rejects.toBeInstanceOf(ErrorConflicto);
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

// =============================================================================
// completarManifiesto — cierre de ruta del conductor (Expo + PWA)
//
// docs/arquitectura/edicion-y-cancelacion-de-pedidos.md §5 fila 8: "Un
// manifiesto puede quedar con menos paradas o vacío [tras cancelar]. `qa` debe
// verificar `api/conductor/manifiesto/completar` con un manifiesto cuyas
// paradas fueron todas canceladas." `completarManifiesto` NO tenía ninguna
// prueba antes de esta ronda de QA (ni módulo ni ruta API).
//
// Hasta 2026-08-14 esta función también purgaba la ubicación GPS del
// conductor al cerrar la ruta (Ley 21.431, ALTO-1); ese borrado y sus pruebas
// se retiraron junto con todo el rastreo en vivo — ver
// docs/seguridad/punto-de-termino-conductor.md §1.
// =============================================================================
describe("completarManifiesto", () => {
  function manifiestoEnRuta(overrides: Partial<FilaManifiesto> = {}): FilaManifiesto {
    return {
      id: MANIFIESTO_A,
      tenant_id: TENANT_A,
      driver_id: DRIVER_1,
      nombre: "Ruta A",
      fecha_operacion: "2026-06-08",
      estado: "en_ruta",
      notas: null,
      creado_por_usuario_id: null,
      confirmado_en: new Date().toISOString(),
      completado_en: null,
      creado_en: new Date().toISOString(),
      actualizado_en: new Date().toISOString(),
      ...overrides,
    };
  }

  it("completa un manifiesto 'en_ruta' → 'completado' y deja bitácora", async () => {
    const { cliente, estado } = crearClienteFalso({ manifiestos: [manifiestoEnRuta()] });

    const completado = await completarManifiesto(
      cliente,
      MANIFIESTO_A,
      TENANT_A,
      DRIVER_1,
      actorCoordinador(),
      USUARIO_ID,
    );

    expect(completado.estado).toBe("completado");
    expect(completado.completadoEn).not.toBeNull();

    const entrada = estado.bitacora.find((e) => e.accion === "manifiesto.completado");
    expect(entrada).toBeDefined();
  });

  it("BUG QUE NO SE ROMPIÓ (§5 fila 8): un manifiesto con TODAS sus paradas canceladas SIGUE completándose — la función no mira paradas, solo el estado del manifiesto", async () => {
    // Simula el escenario que motivó la pregunta de QA: las dos únicas
    // asignaciones del manifiesto quedaron desactivadas (cancelarPedido puso
    // activa=false en cada una) y los pedidos terminaron 'cancelado'. El
    // manifiesto en sí sigue 'en_ruta' — nada en el ciclo de cancelación lo
    // toca — así que completarManifiesto debe funcionar exactamente igual.
    const ahora = new Date().toISOString();
    const { cliente, estado } = crearClienteFalso({
      manifiestos: [manifiestoEnRuta()],
      pedidos: [
        { id: PEDIDO_1, tenant_id: TENANT_A, seller_id: SELLER_1, estado: "cancelado" },
        { id: PEDIDO_2, tenant_id: TENANT_A, seller_id: SELLER_1, estado: "cancelado" },
      ],
      asignaciones: [
        {
          id: "asig-1", tenant_id: TENANT_A, pedido_id: PEDIDO_1, manifiesto_id: MANIFIESTO_A,
          driver_id: DRIVER_1, seller_id: SELLER_1, activa: false,
          asignado_por_usuario_id: null, asignado_en: ahora, desasignado_en: ahora,
        },
        {
          id: "asig-2", tenant_id: TENANT_A, pedido_id: PEDIDO_2, manifiesto_id: MANIFIESTO_A,
          driver_id: DRIVER_1, seller_id: SELLER_1, activa: false,
          asignado_por_usuario_id: null, asignado_en: ahora, desasignado_en: ahora,
        },
      ],
    });

    const completado = await completarManifiesto(cliente, MANIFIESTO_A, TENANT_A, DRIVER_1);

    expect(completado.estado).toBe("completado");
    // Sin excepción, sin importar que 0 paradas estén activas — confirmado.
    expect(estado.manifiestos[0].estado).toBe("completado");
  });

  it("lanza ErrorConflicto si el manifiesto NO está 'en_ruta' (p. ej. 'borrador')", async () => {
    const { cliente } = crearClienteFalso({ manifiestos: [manifiestoEnRuta({ estado: "borrador" })] });

    await expect(
      completarManifiesto(cliente, MANIFIESTO_A, TENANT_A, DRIVER_1),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it("lanza ErrorConflicto si el manifiesto no pertenece al tenant (aislamiento)", async () => {
    const { cliente } = crearClienteFalso({ manifiestos: [manifiestoEnRuta()] });

    await expect(
      completarManifiesto(cliente, MANIFIESTO_A, TENANT_B, DRIVER_1), // tenant incorrecto
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });
});
