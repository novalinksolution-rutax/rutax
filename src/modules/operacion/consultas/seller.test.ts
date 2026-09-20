import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { estadoDePedidoParaSeller, retiroDelDiaParaSeller, type AlcanceSeller } from "./seller";

/**
 * `AlcanceSeller` es un tipo nominal (§6.3): un `{ tenantId, sellerId }` a
 * secas NO compila contra él. En producción lo produce
 * `resolverAlcanceDesdeContacto`; acá, para poder ejercitar TODOS los casos de
 * aislamiento (incluidos los que deben fallar), se fabrica con el mismo cast
 * doble que documenta el tipo — es la única forma de simular, en una prueba,
 * un alcance mal resuelto sin pasarle a las funciones un `any`.
 */
function alcance(tenantId: string, sellerId: string): AlcanceSeller {
  return { tenantId, sellerId } as unknown as AlcanceSeller;
}

/**
 * Pruebas de aislamiento de §6.4 del documento de alcance de conversación por
 * WhatsApp, CON CONTRAPRUEBA (punto 4): sin ella, una función que siempre
 * devuelve `null` pasaría las tres primeras igual — la lección del pgTAP que
 * reponía el CHECK dentro del propio test.
 *
 * El doble de Supabase es un mini almacén en memoria que FILTRA de verdad por
 * los `eq`/`in`/`not` que la implementación aplica: así la prueba ejercita el
 * mismo criterio de aislamiento que corre en producción (donde el alcance
 * `(tenantId, sellerId)` es la única barrera porque el job corre con
 * `service_role`, sin RLS).
 */

type Fila = Record<string, unknown>;

function crearAlmacen(tablas: Record<string, Fila[]>) {
  function construirQuery(filas: Fila[]) {
    let resultado = filas;
    const q = {
      select: () => q,
      eq(col: string, val: unknown) {
        resultado = resultado.filter((f) => f[col] === val);
        return q;
      },
      in(col: string, vals: unknown[]) {
        resultado = resultado.filter((f) => vals.includes(f[col]));
        return q;
      },
      not(col: string, _op: string, val: unknown) {
        resultado = resultado.filter((f) => f[col] !== val);
        return q;
      },
      neq(col: string, val: unknown) {
        resultado = resultado.filter((f) => f[col] !== val);
        return q;
      },
      order: () => q,
      // `.range()` es terminal (así la usa `leerTodasLasFilas`): una sola
      // página basta para lo que estas pruebas ejercitan.
      range: () => Promise.resolve({ data: resultado, error: null, count: resultado.length }),
      then(onFulfilled: (v: { data: Fila[]; error: null; count: number }) => unknown) {
        return Promise.resolve({ data: resultado, error: null, count: resultado.length }).then(
          onFulfilled,
        );
      },
      maybeSingle: () =>
        Promise.resolve({ data: resultado[0] ?? null, error: null }),
    };
    return q;
  }

  function from(tabla: string) {
    return construirQuery(tablas[tabla] ?? []);
  }

  const cliente = {
    from,
    schema: (_esquema: string) => ({ from }),
  } as unknown as SupabaseClient;

  return cliente;
}

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";
const SELLER_A1 = "seller-a1";
const SELLER_A2 = "seller-a2";

function pedidoBase(overrides: Fila = {}): Fila {
  return {
    id: "pedido-1",
    tenant_id: TENANT_A,
    seller_id: SELLER_A1,
    estado: "en_ruta",
    destinatario_nombre: "Juan Pérez",
    destinatario_direccion: "Calle Falsa 123",
    destinatario_comuna: "Maipú",
    creado_en: "2026-09-20T10:00:00.000Z",
    actualizado_en: "2026-09-20T10:00:00.000Z",
    ml_shipment_id: "44760788901",
    codigo_interno: null,
    retirado_en: "2026-09-20T11:20:00.000Z",
    cancelado_en: null,
    ...overrides,
  };
}

describe("estadoDePedidoParaSeller — aislamiento (§6.4)", () => {
  const identificador = { tipo: "ml_shipment_id" as const, valor: "44760788901" };

  it("1 · sellerId de otro seller del mismo tenant → null", async () => {
    const cliente = crearAlmacen({ pedidos: [pedidoBase()] });
    const resultado = await estadoDePedidoParaSeller(
      cliente,
      alcance(TENANT_A, SELLER_A2),
      identificador,
    );
    expect(resultado).toBeNull();
  });

  it("2 · sellerId de otro tenant → null", async () => {
    const cliente = crearAlmacen({ pedidos: [pedidoBase()] });
    const resultado = await estadoDePedidoParaSeller(
      cliente,
      alcance(TENANT_B, SELLER_A1),
      identificador,
    );
    expect(resultado).toBeNull();
  });

  it("3 · tenantId correcto e identificador que existe en OTRO tenant → null", async () => {
    // Los ml_shipment_id NO son únicos globalmente: la misma cuenta ML puede
    // vivir en dos tenants. Es la prueba que nadie escribe.
    const cliente = crearAlmacen({
      pedidos: [pedidoBase({ id: "pedido-otro-tenant", tenant_id: TENANT_B, seller_id: SELLER_A1 })],
    });
    const resultado = await estadoDePedidoParaSeller(
      cliente,
      alcance(TENANT_A, SELLER_A1),
      identificador,
    );
    expect(resultado).toBeNull();
  });

  it("4 · CONTRAPRUEBA — con el par correcto, devuelve la fila", async () => {
    const cliente = crearAlmacen({ pedidos: [pedidoBase()] });
    const resultado = await estadoDePedidoParaSeller(
      cliente,
      alcance(TENANT_A, SELLER_A1),
      identificador,
    );
    expect(resultado).not.toBeNull();
    expect(resultado?.codigo).toBe("44760788901");
    expect(resultado?.estado).toBe("en_ruta");
  });

  it("6 · forma del retorno — nunca aparecen destinatario*, direccion ni conductor*", async () => {
    const cliente = crearAlmacen({ pedidos: [pedidoBase()] });
    const resultado = await estadoDePedidoParaSeller(
      cliente,
      alcance(TENANT_A, SELLER_A1),
      identificador,
    );
    const claves = JSON.stringify(resultado ?? {}).toLowerCase();
    expect(claves).not.toContain("destinatario");
    expect(claves).not.toContain("direccion");
    expect(claves).not.toContain("conductor");
    expect(claves).not.toContain("hora_estimada");
  });
});

describe("retiroDelDiaParaSeller — aislamiento (§6.4 punto 5)", () => {
  const FECHA = "2026-09-20";

  it("5 · seller equivocado → visitas: [] Y esperadosHoy: 0 (los dos)", async () => {
    const cliente = crearAlmacen({
      pedidos: [
        pedidoBase({ id: "p1", fecha_compromiso: FECHA, situacion_retiro: "retirado" }),
      ],
      sesiones_retiro: [
        {
          id: "sesion-1",
          tenant_id: TENANT_A,
          seller_id: SELLER_A1,
          fecha_operacion: FECHA,
          estado: "cerrada",
          bodega_id: "bodega-1",
          abierta_en: "2026-09-20T10:00:00.000Z",
          cerrada_en: "2026-09-20T10:30:00.000Z",
          bultos_resueltos: 5,
        },
      ],
    });

    const resultado = await retiroDelDiaParaSeller(
      cliente,
      alcance(TENANT_A, SELLER_A2),
      FECHA,
    );

    // Un cero en uno y una cifra en el otro ya filtra volumen: se exigen los dos.
    expect(resultado.visitas).toEqual([]);
    expect(resultado.esperadosHoy).toBe(0);
  });

  it("con el seller correcto, cuenta visitas, esperados y faltantes", async () => {
    const cliente = crearAlmacen({
      pedidos: [
        pedidoBase({ id: "p1", ml_shipment_id: "111", fecha_compromiso: FECHA, situacion_retiro: "retirado" }),
        pedidoBase({ id: "p2", ml_shipment_id: "222", fecha_compromiso: FECHA, situacion_retiro: "pendiente" }),
      ],
      sesiones_retiro: [
        {
          id: "sesion-1",
          tenant_id: TENANT_A,
          seller_id: SELLER_A1,
          fecha_operacion: FECHA,
          estado: "cerrada",
          bodega_id: "bodega-1",
          abierta_en: "2026-09-20T10:00:00.000Z",
          cerrada_en: "2026-09-20T10:30:00.000Z",
          bultos_resueltos: 1,
        },
      ],
      seller_bodegas: [{ id: "bodega-1", tenant_id: TENANT_A, nombre: "Quilicura" }],
      bultos_retiro: [
        { tenant_id: TENANT_A, sesion_retiro_id: "sesion-1", pedido_id: "p1" },
      ],
    });

    const resultado = await retiroDelDiaParaSeller(
      cliente,
      alcance(TENANT_A, SELLER_A1),
      FECHA,
    );

    expect(resultado.esperadosHoy).toBe(2);
    expect(resultado.visitas).toHaveLength(1);
    expect(resultado.visitas[0].bodegaNombre).toBe("Quilicura");
    expect(resultado.visitas[0].cargados).toBe(1);
    // p2 no se escaneó: es el faltante.
    expect(resultado.faltantes).toEqual([{ codigoVisible: "222" }]);
  });
});
