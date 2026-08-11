/**
 * Pruebas del módulo de métricas operativas (RF-046).
 *
 * Cubre las nuevas métricas agregadas para el dashboard del dueño:
 * - conductoresActivos
 * - conductoresListosHoy
 * - paquetesPorComuna (top 5 + agrupación de "Otras")
 * - rezagadosAyer
 *
 * El doble de prueba implementa un builder de queries genérico que soporta
 * encadenamientos arbitrarios de `.eq/.in/.not/.or` y resuelve con `then`,
 * imitando el comportamiento real del cliente de Supabase (thenable).
 */

import { describe, expect, it } from "vitest";
import { obtenerMetricasDelDia, obtenerSlaPorSeller, type SlaPorSeller } from "./metricas";

const TENANT_A = "10000000-0000-0000-0000-000000000001";

interface FilaPedido {
  id: string;
  tenant_id: string;
  estado: string;
  destinatario_comuna: string;
  fecha_compromiso: string | null;
  creado_en: string;
  sla_cumplido?: boolean | null;
}

interface FilaConductor {
  id: string;
  tenant_id: string;
  estado: string;
}

interface FilaManifiesto {
  id: string;
  tenant_id: string;
  driver_id: string;
  fecha_operacion: string;
  estado: string;
}

interface FilaPedidoSla {
  id: string;
  tenant_id: string;
  seller_id: string;
  estado: string;
  sla_cumplido: boolean | null;
  fecha_compromiso: string | null;
}

interface FilaSeller {
  id: string;
  tenant_id: string;
  nombre_empresa: string;
}

interface FilaVentanaCorte {
  seller_id: string;
  tenant_id: string;
  hora_corte: string;
  sla_objetivo_pct: number;
  zona_id: null;
  activa: boolean;
}

interface Estado {
  pedidos: FilaPedido[];
  conductores: FilaConductor[];
  manifiestos: FilaManifiesto[];
  incidencias: Array<{ id: string; tenant_id: string; estado: string }>;
  conexiones: Array<{ id: string; tenant_id: string; estado_salud: string }>;
}

/**
 * Builder de query encadenable: aplica filtros a `filas` perezosamente y
 * resuelve cuando se usa `await` (thenable) o cuando se llama explícitamente.
 */
function buildQuery<T extends Record<string, unknown>>(
  filas: T[],
  opts?: { count?: "exact"; head?: boolean },
) {
  const filtros: Array<(f: T) => boolean> = [];

  const chain = {
    eq(campo: string, valor: unknown) {
      filtros.push((f) => f[campo] === valor);
      return chain;
    },
    in(campo: string, valores: unknown[]) {
      filtros.push((f) => valores.includes(f[campo]));
      return chain;
    },
    not(campo: string, op: string, valor: string) {
      // valor viene como "(a,b,c)" para op = "in"
      const lista = valor.replace(/^\(|\)$/g, "").split(",");
      filtros.push((f) => !lista.includes(String(f[campo])));
      return chain;
    },
    or(_expr: string) {
      // Para los tests, la cláusula `.or(fecha_compromiso/creado_en)` se
      // resuelve usando los filtros previos (tenant_id) más una función
      // de selección dada por el seed (ver `coincideDia` abajo).
      filtros.push((f) => coincideDiaActual(f as unknown as FilaPedido));
      return chain;
    },
    then(resolve: (r: { data: T[] | null; count: number | null; error: null }) => void) {
      const filtradas = filas.filter((f) => filtros.every((fn) => fn(f)));
      if (opts?.head) {
        resolve({ data: null, count: filtradas.length, error: null });
      } else {
        resolve({ data: filtradas, count: filtradas.length, error: null });
      }
    },
  };

  return chain;
}

// La fecha "actual" usada en cada test se inyecta vía closure para que `or()`
// pueda evaluar coincidencia de día sin re-parsear la expresión SQL.
let coincideDiaActual: (f: FilaPedido) => boolean = () => true;

function crearClienteFalso(seed?: Partial<Estado>) {
  const estado: Estado = {
    pedidos: seed?.pedidos ?? [],
    conductores: seed?.conductores ?? [],
    manifiestos: seed?.manifiestos ?? [],
    incidencias: seed?.incidencias ?? [],
    conexiones: seed?.conexiones ?? [],
  };

  function fromImpl(tabla: string) {
    if (tabla === "pedidos") {
      return {
        select: (cols: string, opts?: { count?: "exact"; head?: boolean }) =>
          buildQuery(estado.pedidos as unknown as Record<string, unknown>[], opts),
      };
    }
    if (tabla === "incidencias") {
      return {
        select: (cols: string, opts?: { count?: "exact"; head?: boolean }) =>
          buildQuery(estado.incidencias as unknown as Record<string, unknown>[], opts),
      };
    }
    if (tabla === "conexiones_seller_ml") {
      return {
        select: (cols: string, opts?: { count?: "exact"; head?: boolean }) =>
          buildQuery(estado.conexiones as unknown as Record<string, unknown>[], opts),
      };
    }
    if (tabla === "conductores") {
      return {
        select: (cols: string, opts?: { count?: "exact"; head?: boolean }) =>
          buildQuery(estado.conductores as unknown as Record<string, unknown>[], opts),
      };
    }
    if (tabla === "manifiestos") {
      return {
        select: (cols: string, opts?: { count?: "exact"; head?: boolean }) =>
          buildQuery(estado.manifiestos as unknown as Record<string, unknown>[], opts),
      };
    }
    throw new Error(`Tabla no mockeada: ${tabla}`);
  }

  return {
    from: fromImpl,
    schema: (_nombre: string) => ({ from: fromImpl }),
  } as unknown as import("@supabase/supabase-js").SupabaseClient;
}

describe("obtenerMetricasDelDia — nuevas métricas RF-046", () => {
  it("conductoresActivos cuenta solo conductores con estado='activo' del tenant", async () => {
    coincideDiaActual = () => false;

    const cliente = crearClienteFalso({
      conductores: [
        { id: "c1", tenant_id: TENANT_A, estado: "activo" },
        { id: "c2", tenant_id: TENANT_A, estado: "activo" },
        { id: "c3", tenant_id: TENANT_A, estado: "inactivo" },
        { id: "c4", tenant_id: "otro-tenant", estado: "activo" },
      ],
    });

    const metricas = await obtenerMetricasDelDia(cliente, TENANT_A, new Date("2026-06-09T12:00:00Z"));

    expect(metricas.conductoresActivos).toBe(2);
  });

  it("conductoresListosHoy cuenta conductores distintos con manifiesto confirmado/en_ruta para la fecha", async () => {
    coincideDiaActual = () => false;

    const cliente = crearClienteFalso({
      manifiestos: [
        { id: "m1", tenant_id: TENANT_A, driver_id: "drv-1", fecha_operacion: "2026-06-09", estado: "confirmado" },
        { id: "m2", tenant_id: TENANT_A, driver_id: "drv-2", fecha_operacion: "2026-06-09", estado: "en_ruta" },
        // Mismo conductor con dos manifiestos confirmados el mismo día -> cuenta una vez.
        { id: "m3", tenant_id: TENANT_A, driver_id: "drv-1", fecha_operacion: "2026-06-09", estado: "confirmado" },
        // Estado borrador no cuenta.
        { id: "m4", tenant_id: TENANT_A, driver_id: "drv-3", fecha_operacion: "2026-06-09", estado: "borrador" },
        // Otra fecha no cuenta.
        { id: "m5", tenant_id: TENANT_A, driver_id: "drv-4", fecha_operacion: "2026-06-08", estado: "confirmado" },
        // Otro tenant no cuenta.
        { id: "m6", tenant_id: "otro-tenant", driver_id: "drv-5", fecha_operacion: "2026-06-09", estado: "confirmado" },
      ],
    });

    const metricas = await obtenerMetricasDelDia(cliente, TENANT_A, new Date("2026-06-09T12:00:00Z"));

    expect(metricas.conductoresListosHoy).toBe(2);
  });

  it("paquetesPorComuna agrupa top 5 comunas por cantidad y agrupa el resto en 'Otras'", async () => {
    coincideDiaActual = (f) => f.tenant_id === TENANT_A;

    const comunas = ["Maipú", "Ñuñoa", "Providencia", "Las Condes", "La Florida", "Puente Alto", "Recoleta"];
    const pedidos: FilaPedido[] = [];
    // cantidades: Maipú=6, Ñuñoa=5, Providencia=4, Las Condes=3, La Florida=2, Puente Alto=1, Recoleta=1
    const cantidades = [6, 5, 4, 3, 2, 1, 1];
    comunas.forEach((comuna, idx) => {
      for (let i = 0; i < cantidades[idx]; i++) {
        pedidos.push({
          id: `p-${comuna}-${i}`,
          tenant_id: TENANT_A,
          estado: "pendiente_asignacion",
          destinatario_comuna: comuna,
          fecha_compromiso: "2026-06-09",
          creado_en: "2026-06-09T10:00:00.000Z",
        });
      }
    });

    const cliente = crearClienteFalso({ pedidos });

    const metricas = await obtenerMetricasDelDia(cliente, TENANT_A, new Date("2026-06-09T12:00:00Z"));

    expect(metricas.paquetesPorComuna.slice(0, 5)).toEqual([
      { comuna: "Maipú", cantidad: 6 },
      { comuna: "Ñuñoa", cantidad: 5 },
      { comuna: "Providencia", cantidad: 4 },
      { comuna: "Las Condes", cantidad: 3 },
      { comuna: "La Florida", cantidad: 2 },
    ]);
    // Puente Alto (1) + Recoleta (1) = 2, agrupados en "Otras".
    expect(metricas.paquetesPorComuna[5]).toEqual({ comuna: "Otras", cantidad: 2 });
    expect(metricas.paquetesPorComuna).toHaveLength(6);
  });

  it("paquetesPorComuna no agrega 'Otras' si hay 5 o menos comunas", async () => {
    coincideDiaActual = (f) => f.tenant_id === TENANT_A;

    const cliente = crearClienteFalso({
      pedidos: [
        {
          id: "p1",
          tenant_id: TENANT_A,
          estado: "pendiente_asignacion",
          destinatario_comuna: "Maipú",
          fecha_compromiso: "2026-06-09",
          creado_en: "2026-06-09T10:00:00.000Z",
        },
        {
          id: "p2",
          tenant_id: TENANT_A,
          estado: "pendiente_asignacion",
          destinatario_comuna: "Ñuñoa",
          fecha_compromiso: "2026-06-09",
          creado_en: "2026-06-09T10:00:00.000Z",
        },
      ],
    });

    const metricas = await obtenerMetricasDelDia(cliente, TENANT_A, new Date("2026-06-09T12:00:00Z"));

    expect(metricas.paquetesPorComuna).toEqual([
      { comuna: "Maipú", cantidad: 1 },
      { comuna: "Ñuñoa", cantidad: 1 },
    ]);
  });

  it("rezagadosAyer cuenta pedidos con fecha_compromiso=ayer y estado no terminal", async () => {
    coincideDiaActual = () => false; // No nos interesan los pedidos "de hoy" en este test.

    const cliente = crearClienteFalso({
      pedidos: [
        // Ayer (2026-06-08), no terminal -> cuenta.
        { id: "p1", tenant_id: TENANT_A, estado: "pendiente_asignacion", destinatario_comuna: "Maipú", fecha_compromiso: "2026-06-08", creado_en: "2026-06-08T10:00:00.000Z" },
        { id: "p2", tenant_id: TENANT_A, estado: "asignado", destinatario_comuna: "Maipú", fecha_compromiso: "2026-06-08", creado_en: "2026-06-08T10:00:00.000Z" },
        { id: "p3", tenant_id: TENANT_A, estado: "en_ruta", destinatario_comuna: "Maipú", fecha_compromiso: "2026-06-08", creado_en: "2026-06-08T10:00:00.000Z" },
        // Ayer pero terminal -> no cuenta.
        { id: "p4", tenant_id: TENANT_A, estado: "entregado", destinatario_comuna: "Maipú", fecha_compromiso: "2026-06-08", creado_en: "2026-06-08T10:00:00.000Z" },
        { id: "p5", tenant_id: TENANT_A, estado: "fallido_manual", destinatario_comuna: "Maipú", fecha_compromiso: "2026-06-08", creado_en: "2026-06-08T10:00:00.000Z" },
        // Hoy, no terminal -> no cuenta (fecha distinta).
        { id: "p6", tenant_id: TENANT_A, estado: "pendiente_asignacion", destinatario_comuna: "Maipú", fecha_compromiso: "2026-06-09", creado_en: "2026-06-09T10:00:00.000Z" },
        // Otro tenant -> no cuenta.
        { id: "p7", tenant_id: "otro-tenant", estado: "pendiente_asignacion", destinatario_comuna: "Maipú", fecha_compromiso: "2026-06-08", creado_en: "2026-06-08T10:00:00.000Z" },
      ],
    });

    const metricas = await obtenerMetricasDelDia(cliente, TENANT_A, new Date("2026-06-09T12:00:00Z"));

    expect(metricas.rezagadosAyer).toBe(3);
  });

  it("calcula correctamente todas las métricas combinadas con datos vacíos", async () => {
    coincideDiaActual = () => false;

    const cliente = crearClienteFalso({});

    const metricas = await obtenerMetricasDelDia(cliente, TENANT_A, new Date("2026-06-09T12:00:00Z"));

    expect(metricas.conductoresActivos).toBe(0);
    expect(metricas.conductoresListosHoy).toBe(0);
    expect(metricas.paquetesPorComuna).toEqual([]);
    expect(metricas.rezagadosAyer).toBe(0);
  });

  it("slaGlobalPct es null cuando no hay pedidos con sla_cumplido evaluado", async () => {
    coincideDiaActual = (f) => f.tenant_id === TENANT_A;

    const cliente = crearClienteFalso({
      pedidos: [
        {
          id: "p1",
          tenant_id: TENANT_A,
          estado: "pendiente_asignacion",
          destinatario_comuna: "Maipú",
          fecha_compromiso: "2026-06-09",
          creado_en: "2026-06-09T10:00:00.000Z",
          // sla_cumplido no incluido = undefined → tratado como null
        } as FilaPedido,
      ],
    });

    const metricas = await obtenerMetricasDelDia(cliente, TENANT_A, new Date("2026-06-09T12:00:00Z"));
    expect(metricas.slaGlobalPct).toBeNull();
  });

  it("slaGlobalPct calcula % correcto con pedidos evaluados", async () => {
    coincideDiaActual = (f) => f.tenant_id === TENANT_A;

    const pedidosConSla = [
      { id: "p1", tenant_id: TENANT_A, estado: "entregado", destinatario_comuna: "Maipú", fecha_compromiso: "2026-06-09", creado_en: "2026-06-09T10:00:00.000Z", sla_cumplido: true },
      { id: "p2", tenant_id: TENANT_A, estado: "entregado", destinatario_comuna: "Maipú", fecha_compromiso: "2026-06-09", creado_en: "2026-06-09T10:00:00.000Z", sla_cumplido: true },
      { id: "p3", tenant_id: TENANT_A, estado: "entregado", destinatario_comuna: "Maipú", fecha_compromiso: "2026-06-09", creado_en: "2026-06-09T10:00:00.000Z", sla_cumplido: false },
      { id: "p4", tenant_id: TENANT_A, estado: "fallido", destinatario_comuna: "Maipú", fecha_compromiso: "2026-06-09", creado_en: "2026-06-09T10:00:00.000Z", sla_cumplido: false },
    ] as unknown as FilaPedido[];

    const cliente = crearClienteFalso({ pedidos: pedidosConSla });
    const metricas = await obtenerMetricasDelDia(cliente, TENANT_A, new Date("2026-06-09T12:00:00Z"));

    // 2 a tiempo / 4 evaluados = 50%
    expect(metricas.slaGlobalPct).toBe(50);
  });

  it("un pedido cancelado con sla_cumplido=null no mueve slaGlobalPct (queda fuera del denominador)", async () => {
    coincideDiaActual = (f) => f.tenant_id === TENANT_A;

    // Baseline: 2 entregados a tiempo / 2 evaluados = 100%.
    const pedidosBase = [
      { id: "p1", tenant_id: TENANT_A, estado: "entregado", destinatario_comuna: "Maipú", fecha_compromiso: "2026-06-09", creado_en: "2026-06-09T10:00:00.000Z", sla_cumplido: true },
      { id: "p2", tenant_id: TENANT_A, estado: "entregado", destinatario_comuna: "Maipú", fecha_compromiso: "2026-06-09", creado_en: "2026-06-09T10:00:00.000Z", sla_cumplido: true },
    ] as unknown as FilaPedido[];

    const clienteBase = crearClienteFalso({ pedidos: pedidosBase });
    const metricasBase = await obtenerMetricasDelDia(clienteBase, TENANT_A, new Date("2026-06-09T12:00:00Z"));
    expect(metricasBase.slaGlobalPct).toBe(100);

    // Mismo escenario + un pedido cancelado que TENÍA fecha_compromiso_hora y
    // fue forzado a sla_cumplido=null por actualizarEstadoPedido (§5 fila 5 del
    // doc de arquitectura). El % de SLA no debe cambiar: el cancelado queda
    // fuera del denominador, no cuenta como incumplimiento.
    const pedidosConCancelado = [
      ...pedidosBase,
      { id: "p3", tenant_id: TENANT_A, estado: "cancelado", destinatario_comuna: "Maipú", fecha_compromiso: "2026-06-09", creado_en: "2026-06-09T10:00:00.000Z", sla_cumplido: null },
    ] as unknown as FilaPedido[];

    const clienteConCancelado = crearClienteFalso({ pedidos: pedidosConCancelado });
    const metricasConCancelado = await obtenerMetricasDelDia(clienteConCancelado, TENANT_A, new Date("2026-06-09T12:00:00Z"));

    expect(metricasConCancelado.slaGlobalPct).toBe(100);
    expect(metricasConCancelado.totalPedidos).toBe(3); // el cancelado sí entra en el total del día, solo no en el SLA
  });

  // ===========================================================================
  // tasaEntrega — mismo bug de fondo que 23107c6 (sla_cumplido), aplicado al
  // denominador de la tarjeta "Tasa de entrega" del dashboard del dueño.
  // Reproducción literal reportada por qa: 1 entregado + 1 cancelado ⇒ el
  // cálculo viejo daba 0.5 pese a que ningún intento de entrega falló.
  // ===========================================================================

  it("un pedido cancelado no baja tasaEntrega (queda fuera del denominador)", async () => {
    coincideDiaActual = (f) => f.tenant_id === TENANT_A;

    // Reproducción literal del bug: 1 entregado + 1 cancelado. Con el bug,
    // tasaEntrega = 1 / (1 + 1) = 0.5 pese a que ningún intento de entrega
    // falló — el cancelado nunca debió entrar al denominador.
    const pedidos = [
      { id: "p1", tenant_id: TENANT_A, estado: "entregado", destinatario_comuna: "Maipú", fecha_compromiso: "2026-06-09", creado_en: "2026-06-09T10:00:00.000Z" },
      { id: "p2", tenant_id: TENANT_A, estado: "cancelado", destinatario_comuna: "Maipú", fecha_compromiso: "2026-06-09", creado_en: "2026-06-09T10:00:00.000Z" },
    ] as unknown as FilaPedido[];

    const cliente = crearClienteFalso({ pedidos });
    const metricas = await obtenerMetricasDelDia(cliente, TENANT_A, new Date("2026-06-09T12:00:00Z"));

    expect(metricas.tasaEntrega).toBe(1);
    expect(metricas.totalPedidos).toBe(2); // el cancelado sigue contando en el volumen del día
  });

  it("tasaEntrega no cambia entre agregar cancelados de más (fuera del denominador)", async () => {
    coincideDiaActual = (f) => f.tenant_id === TENANT_A;

    // Baseline: 1 entregado / 1 fallido = 50%.
    const pedidosBase = [
      { id: "p1", tenant_id: TENANT_A, estado: "entregado", destinatario_comuna: "Maipú", fecha_compromiso: "2026-06-09", creado_en: "2026-06-09T10:00:00.000Z" },
      { id: "p2", tenant_id: TENANT_A, estado: "fallido", destinatario_comuna: "Maipú", fecha_compromiso: "2026-06-09", creado_en: "2026-06-09T10:00:00.000Z" },
    ] as unknown as FilaPedido[];

    const clienteBase = crearClienteFalso({ pedidos: pedidosBase });
    const metricasBase = await obtenerMetricasDelDia(clienteBase, TENANT_A, new Date("2026-06-09T12:00:00Z"));
    expect(metricasBase.tasaEntrega).toBe(0.5);

    // Agregar cancelados no debe mover la tasa: siguen fuera del denominador.
    const pedidosConCancelados = [
      ...pedidosBase,
      { id: "p3", tenant_id: TENANT_A, estado: "cancelado", destinatario_comuna: "Maipú", fecha_compromiso: "2026-06-09", creado_en: "2026-06-09T10:00:00.000Z" },
      { id: "p4", tenant_id: TENANT_A, estado: "cancelado", destinatario_comuna: "Maipú", fecha_compromiso: "2026-06-09", creado_en: "2026-06-09T10:00:00.000Z" },
    ] as unknown as FilaPedido[];

    const clienteConCancelados = crearClienteFalso({ pedidos: pedidosConCancelados });
    const metricasConCancelados = await obtenerMetricasDelDia(clienteConCancelados, TENANT_A, new Date("2026-06-09T12:00:00Z"));

    expect(metricasConCancelados.tasaEntrega).toBe(0.5);
    expect(metricasConCancelados.totalPedidos).toBe(4);
  });

  // Contraste deliberado, igual que hizo 23107c6 para sla_cumplido: 'devuelto'
  // SÍ se mantiene en el denominador de tasaEntrega. A diferencia de
  // 'cancelado', 'devuelto' solo es alcanzable desde en_ruta/fallido/
  // fallido_manual (máquina de estados) — siempre hubo un intento real de
  // entrega que terminó devuelto al origen, así que es un fallo genuino.
  it("un pedido devuelto SIGUE bajando tasaEntrega (sin cambios, a propósito)", async () => {
    coincideDiaActual = (f) => f.tenant_id === TENANT_A;

    const pedidos = [
      { id: "p1", tenant_id: TENANT_A, estado: "entregado", destinatario_comuna: "Maipú", fecha_compromiso: "2026-06-09", creado_en: "2026-06-09T10:00:00.000Z" },
      { id: "p2", tenant_id: TENANT_A, estado: "devuelto", destinatario_comuna: "Maipú", fecha_compromiso: "2026-06-09", creado_en: "2026-06-09T10:00:00.000Z" },
    ] as unknown as FilaPedido[];

    const cliente = crearClienteFalso({ pedidos });
    const metricas = await obtenerMetricasDelDia(cliente, TENANT_A, new Date("2026-06-09T12:00:00Z"));

    // 1 entregado / (1 entregado + 1 devuelto) = 50%, no 100%.
    expect(metricas.tasaEntrega).toBe(0.5);
  });
});

// =============================================================================
// obtenerSlaPorSeller — SLA por seller
// =============================================================================

/**
 * Builder de query encadenable para obtenerSlaPorSeller.
 * Soporta el esquema identidad (sellers, ventanas_corte) y operacion (pedidos).
 */
function buildQuerySla<T extends Record<string, unknown>>(
  filas: T[],
  opts?: { count?: "exact"; head?: boolean },
) {
  const filtros: Array<(f: T) => boolean> = [];

  const chain = {
    select: (_cols: string, _opts?: object) => chain,
    eq(campo: string, valor: unknown) { filtros.push((f) => f[campo] === valor); return chain; },
    in(campo: string, valores: unknown[]) { filtros.push((f) => valores.includes(f[campo])); return chain; },
    not(campo: string, op: string, _valor: unknown) {
      if (op === 'is') { filtros.push((f) => f[campo] !== null && f[campo] !== undefined); }
      return chain;
    },
    is(campo: string, valor: unknown) { filtros.push((f) => f[campo] === valor); return chain; },
    gte(campo: string, valor: unknown) { filtros.push((f) => String(f[campo]) >= String(valor)); return chain; },
    lte(campo: string, valor: unknown) { filtros.push((f) => String(f[campo]) <= String(valor)); return chain; },
    order: () => chain,
    then(resolve: (r: { data: T[] | null; count: number | null; error: null }) => void) {
      const filtradas = filas.filter((f) => filtros.every((fn) => fn(f)));
      if (opts?.head) {
        resolve({ data: null, count: filtradas.length, error: null });
      } else {
        resolve({ data: filtradas, count: filtradas.length, error: null });
      }
    },
  };

  return chain;
}

function crearClienteSlaFalso(
  pedidosSla: FilaPedidoSla[],
  sellers: FilaSeller[],
  ventanas: FilaVentanaCorte[],
) {
  function fromSla(tabla: string) {
    if (tabla === "pedidos") {
      return buildQuerySla(pedidosSla as unknown as Record<string, unknown>[]);
    }
    if (tabla === "sellers") {
      return buildQuerySla(sellers as unknown as Record<string, unknown>[]);
    }
    if (tabla === "ventanas_corte") {
      return buildQuerySla(ventanas as unknown as Record<string, unknown>[]);
    }
    throw new Error(`Tabla no mockeada en SLA: ${tabla}`);
  }

  return {
    from: fromSla,
    schema: (_nombre: string) => ({ from: fromSla }),
  } as unknown as import("@supabase/supabase-js").SupabaseClient;
}

describe("obtenerSlaPorSeller — métricas SLA por seller (F7)", () => {
  const sellers: FilaSeller[] = [
    { id: "seller-a", tenant_id: TENANT_A, nombre_empresa: "Seller A" },
    { id: "seller-b", tenant_id: TENANT_A, nombre_empresa: "Seller B" },
  ];

  const ventanas: FilaVentanaCorte[] = [
    { seller_id: "seller-a", tenant_id: TENANT_A, hora_corte: "13:00", sla_objetivo_pct: 95, zona_id: null, activa: true },
    { seller_id: "seller-b", tenant_id: TENANT_A, hora_corte: "14:00", sla_objetivo_pct: 97, zona_id: null, activa: true },
  ];

  it("calcula slaPct = 100 cuando todos los pedidos son a tiempo", async () => {
    const pedidos: FilaPedidoSla[] = [
      { id: "p1", tenant_id: TENANT_A, seller_id: "seller-a", estado: "entregado", sla_cumplido: true, fecha_compromiso: "2026-06-09" },
      { id: "p2", tenant_id: TENANT_A, seller_id: "seller-a", estado: "entregado", sla_cumplido: true, fecha_compromiso: "2026-06-09" },
    ];

    const cliente = crearClienteSlaFalso(pedidos, sellers, ventanas);
    const resultado = await obtenerSlaPorSeller(cliente, TENANT_A, new Date("2026-06-09T12:00:00Z"), 'dia');

    const sellerA = resultado.find((r) => r.sellerId === "seller-a");
    expect(sellerA?.slaPct).toBe(100);
    expect(sellerA?.aTiempo).toBe(2);
    expect(sellerA?.totalTerminales).toBe(2);
    expect(sellerA?.objetivoPct).toBe(95);
  });

  it("calcula slaPct = 0 cuando todos los pedidos son tarde", async () => {
    const pedidos: FilaPedidoSla[] = [
      { id: "p1", tenant_id: TENANT_A, seller_id: "seller-b", estado: "entregado", sla_cumplido: false, fecha_compromiso: "2026-06-09" },
      { id: "p2", tenant_id: TENANT_A, seller_id: "seller-b", estado: "fallido", sla_cumplido: false, fecha_compromiso: "2026-06-09" },
    ];

    const cliente = crearClienteSlaFalso(pedidos, sellers, ventanas);
    const resultado = await obtenerSlaPorSeller(cliente, TENANT_A, new Date("2026-06-09T12:00:00Z"), 'dia');

    const sellerB = resultado.find((r) => r.sellerId === "seller-b");
    expect(sellerB?.slaPct).toBe(0);
    expect(sellerB?.objetivoPct).toBe(97);
  });

  it("calcula slaPct mixto correctamente (3/4 = 75%)", async () => {
    const pedidos: FilaPedidoSla[] = [
      { id: "p1", tenant_id: TENANT_A, seller_id: "seller-a", estado: "entregado", sla_cumplido: true, fecha_compromiso: "2026-06-09" },
      { id: "p2", tenant_id: TENANT_A, seller_id: "seller-a", estado: "entregado", sla_cumplido: true, fecha_compromiso: "2026-06-09" },
      { id: "p3", tenant_id: TENANT_A, seller_id: "seller-a", estado: "entregado", sla_cumplido: true, fecha_compromiso: "2026-06-09" },
      { id: "p4", tenant_id: TENANT_A, seller_id: "seller-a", estado: "fallido", sla_cumplido: false, fecha_compromiso: "2026-06-09" },
    ];

    const cliente = crearClienteSlaFalso(pedidos, sellers, ventanas);
    const resultado = await obtenerSlaPorSeller(cliente, TENANT_A, new Date("2026-06-09T12:00:00Z"), 'dia');

    const sellerA = resultado.find((r) => r.sellerId === "seller-a");
    expect(sellerA?.slaPct).toBe(75);
  });

  it("usa objetivo por defecto (97) cuando el seller no tiene ventana configurada", async () => {
    const pedidos: FilaPedidoSla[] = [
      { id: "p1", tenant_id: TENANT_A, seller_id: "seller-sin-ventana", estado: "entregado", sla_cumplido: true, fecha_compromiso: "2026-06-09" },
    ];
    const sellersExtra: FilaSeller[] = [
      ...sellers,
      { id: "seller-sin-ventana", tenant_id: TENANT_A, nombre_empresa: "Sin Ventana" },
    ];

    const cliente = crearClienteSlaFalso(pedidos, sellersExtra, ventanas);
    const resultado = await obtenerSlaPorSeller(cliente, TENANT_A, new Date("2026-06-09T12:00:00Z"), 'dia');

    const sinVentana = resultado.find((r) => r.sellerId === "seller-sin-ventana");
    expect(sinVentana?.objetivoPct).toBe(97);
  });

  it("devuelve array vacío si no hay pedidos con sla_cumplido evaluado", async () => {
    const cliente = crearClienteSlaFalso([], sellers, ventanas);
    const resultado = await obtenerSlaPorSeller(cliente, TENANT_A, new Date("2026-06-09T12:00:00Z"), 'dia');
    expect(resultado).toEqual([]);
  });
});
