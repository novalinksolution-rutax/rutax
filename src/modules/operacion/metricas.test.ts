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
import { obtenerMetricasDelDia } from "./metricas";

const TENANT_A = "10000000-0000-0000-0000-000000000001";

interface FilaPedido {
  id: string;
  tenant_id: string;
  estado: string;
  destinatario_comuna: string;
  fecha_compromiso: string | null;
  creado_en: string;
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
});
