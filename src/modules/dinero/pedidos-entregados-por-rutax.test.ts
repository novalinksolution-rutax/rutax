/**
 * Pruebas del predicado que decide qué pedidos cuentan para el dinero.
 *
 * ⚠️ **Los dos lados importan, y no cuestan lo mismo.** Dejar pasar un pedido que
 * Rutax no tocó llena la bandeja de ruido —lo que pasó el 2026-08-25 con 109
 * excepciones—, pero excluir uno que Rutax SÍ entregó esconde un cobro que
 * correspondía y le hace perder plata al courier sin que nada avise. Por eso hay
 * tantas pruebas del segundo caso como del primero.
 */

import { describe, expect, it } from "vitest";
import { listarPedidosEntregadosPorRutax } from "./pedidos-entregados-por-rutax";

const TENANT = "10000000-0000-0000-0000-000000000001";
const SELLER = "30000000-0000-0000-0000-000000000001";
const RANGO = { desdeIso: "2026-08-01T04:00:00.000Z", hastaIso: "2026-09-01T04:00:00.000Z" };

/**
 * Doble de Supabase que FILTRA de verdad por los `.eq()`/`.in()` recibidos.
 *
 * Un doble que devuelve todo siempre haría pasar la prueba aunque el predicado
 * no filtrara nada — que es exactamente el bug que estamos arreglando.
 */
function crearCliente(fixtures: {
  pedidos: Array<{ id: string; tenant_id: string; seller_id: string; estado: string; actualizado_en: string }>;
  asignaciones: Array<{ tenant_id: string; pedido_id: string }>;
}) {
  const tablas: Record<string, Record<string, unknown>[]> = {
    pedidos: fixtures.pedidos,
    asignaciones_pedido: fixtures.asignaciones,
  };

  function builder(tabla: string) {
    const filas = tablas[tabla] ?? [];
    const eq: Array<{ col: string; val: unknown }> = [];
    let dentro: { col: string; vals: unknown[] } | null = null;
    let gte: { col: string; val: string } | null = null;
    let lt: { col: string; val: string } | null = null;

    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (col: string, val: unknown) => {
      eq.push({ col, val });
      return b;
    };
    b.in = (col: string, vals: unknown[]) => {
      dentro = { col, vals };
      return b;
    };
    b.gte = (col: string, val: string) => {
      gte = { col, val };
      return b;
    };
    b.lt = (col: string, val: string) => {
      lt = { col, val };
      return b;
    };
    b.order = () => b;
    b.range = () => b;
    b.then = (resolver: (r: { data: unknown[]; error: null }) => void) => {
      let out = filas.filter((f) => eq.every((e) => f[e.col] === e.val));
      if (dentro) out = out.filter((f) => dentro!.vals.includes(f[dentro!.col]));
      if (gte) out = out.filter((f) => String(f[gte!.col]) >= gte!.val);
      if (lt) out = out.filter((f) => String(f[lt!.col]) < lt!.val);
      return resolver({ data: out, error: null });
    };
    return b;
  }

  return {
    schema: () => ({ from: (t: string) => builder(t) }),
  } as never;
}

function pedido(id: string, estado: string, actualizado = "2026-08-15T12:00:00.000Z") {
  return { id, tenant_id: TENANT, seller_id: SELLER, estado, actualizado_en: actualizado };
}

describe("listarPedidosEntregadosPorRutax — lo que NO cuenta", () => {
  it("EXCLUYE un pedido entregado que nunca se asignó — el bug de las 109 excepciones", async () => {
    // El caso real: un pedido Flex ingestado desde ML, que el propio seller
    // despachó. En Rutax queda `entregado` porque el estado lo escribe ML.
    const cliente = crearCliente({
      pedidos: [pedido("solo-ingestado", "entregado")],
      asignaciones: [],
    });

    const resultado = await listarPedidosEntregadosPorRutax(cliente, {
      tenantId: TENANT,
      sellerId: SELLER,
      rango: RANGO,
    });

    expect(resultado).toEqual([]);
  });

  it("excluye lo que no está entregado, aunque esté asignado", async () => {
    const cliente = crearCliente({
      pedidos: [pedido("en-ruta", "en_ruta")],
      asignaciones: [{ tenant_id: TENANT, pedido_id: "en-ruta" }],
    });

    expect(
      await listarPedidosEntregadosPorRutax(cliente, { tenantId: TENANT, sellerId: SELLER, rango: RANGO }),
    ).toEqual([]);
  });

  it("excluye lo entregado FUERA del rango del período", async () => {
    const cliente = crearCliente({
      pedidos: [pedido("de-julio", "entregado", "2026-07-15T12:00:00.000Z")],
      asignaciones: [{ tenant_id: TENANT, pedido_id: "de-julio" }],
    });

    expect(
      await listarPedidosEntregadosPorRutax(cliente, { tenantId: TENANT, sellerId: SELLER, rango: RANGO }),
    ).toEqual([]);
  });
});

describe("listarPedidosEntregadosPorRutax — lo que SÍ cuenta (el error caro)", () => {
  it("INCLUYE un pedido entregado y asignado", async () => {
    const cliente = crearCliente({
      pedidos: [pedido("entregado-por-rutax", "entregado")],
      asignaciones: [{ tenant_id: TENANT, pedido_id: "entregado-por-rutax" }],
    });

    expect(
      await listarPedidosEntregadosPorRutax(cliente, { tenantId: TENANT, sellerId: SELLER, rango: RANGO }),
    ).toEqual(["entregado-por-rutax"]);
  });

  it("INCLUYE `entregado_manual` — el coordinador cerrándolo a mano sigue siendo una entrega de Rutax", async () => {
    const cliente = crearCliente({
      pedidos: [pedido("cerrado-a-mano", "entregado_manual")],
      asignaciones: [{ tenant_id: TENANT, pedido_id: "cerrado-a-mano" }],
    });

    expect(
      await listarPedidosEntregadosPorRutax(cliente, { tenantId: TENANT, sellerId: SELLER, rango: RANGO }),
    ).toEqual(["cerrado-a-mano"]);
  });

  it("separa lo de Rutax de lo solo ingestado dentro del MISMO período", async () => {
    // El caso que va a ocurrir de verdad cuando el courier empiece a operar:
    // pedidos viejos solo ingestados conviviendo con entregas reales.
    const cliente = crearCliente({
      pedidos: [
        pedido("ingestado-1", "entregado"),
        pedido("de-rutax", "entregado"),
        pedido("ingestado-2", "entregado"),
      ],
      asignaciones: [{ tenant_id: TENANT, pedido_id: "de-rutax" }],
    });

    expect(
      await listarPedidosEntregadosPorRutax(cliente, { tenantId: TENANT, sellerId: SELLER, rango: RANGO }),
    ).toEqual(["de-rutax"]);
  });
});

describe("listarPedidosEntregadosPorRutax — aislamiento", () => {
  it("no cruza tenants ni sellers", async () => {
    const cliente = crearCliente({
      pedidos: [
        { ...pedido("de-otro-tenant", "entregado"), tenant_id: "otro-tenant" },
        { ...pedido("de-otro-seller", "entregado"), seller_id: "otro-seller" },
      ],
      asignaciones: [
        { tenant_id: "otro-tenant", pedido_id: "de-otro-tenant" },
        { tenant_id: TENANT, pedido_id: "de-otro-seller" },
      ],
    });

    expect(
      await listarPedidosEntregadosPorRutax(cliente, { tenantId: TENANT, sellerId: SELLER, rango: RANGO }),
    ).toEqual([]);
  });

  it("una asignación de OTRO tenant no valida el pedido", async () => {
    const cliente = crearCliente({
      pedidos: [pedido("mio", "entregado")],
      asignaciones: [{ tenant_id: "otro-tenant", pedido_id: "mio" }],
    });

    expect(
      await listarPedidosEntregadosPorRutax(cliente, { tenantId: TENANT, sellerId: SELLER, rango: RANGO }),
    ).toEqual([]);
  });
});
