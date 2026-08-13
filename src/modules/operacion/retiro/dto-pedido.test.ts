/**
 * Pruebas de `dto-pedido.ts`. El doble de Supabase FILTRA de verdad según los
 * `.eq()`/`.in()` recibidos (nunca un no-op) — así una prueba de aislamiento
 * significa algo: si el código dejara de filtrar por `tenant_id`, la prueba
 * de fuga cruzada fallaría de verdad, no por casualidad.
 */
import { describe, expect, it, vi } from "vitest";
import {
  buscarPedidosPorCodigos,
  buscarPedidosPorIds,
  construirDtoPedidoRetiro,
  resolverNombresSellers,
  type PedidoCandidatoRetiro,
} from "./dto-pedido";

const TENANT_A = "10000000-0000-0000-0000-000000000001";
const OTRO_TENANT = "10000000-0000-0000-0000-000000000099";
const SELLER_1 = "60000000-0000-0000-0000-000000000001";
const SELLER_2 = "60000000-0000-0000-0000-000000000002";
const PEDIDO_1 = "40000000-0000-0000-0000-000000000001";
const PEDIDO_AJENO = "40000000-0000-0000-0000-000000000099";

interface FilaFixture {
  [clave: string]: unknown;
}

/** Doble mínimo cuyo `.eq()`/`.in()` FILTRAN el fixture — nunca un no-op. */
function crearCliente(fixtures: Record<string, FilaFixture[]>) {
  const llamadasEq: { tabla: string; columna: string; valor: unknown }[] = [];

  function builder(tabla: string) {
    const filas = fixtures[tabla] ?? [];
    const filtrosEq: { columna: string; valor: unknown }[] = [];
    let filtroIn: { columna: string; valores: unknown[] } | null = null;

    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (columna: string, valor: unknown) => {
      filtrosEq.push({ columna, valor });
      llamadasEq.push({ tabla, columna, valor });
      return b;
    };
    b.in = (columna: string, valores: unknown[]) => {
      filtroIn = { columna, valores };
      return b;
    };
    b.then = (resolve: (r: { data: FilaFixture[]; error: null }) => void) => {
      let resultado = filas.filter((f) => filtrosEq.every((flt) => f[flt.columna] === flt.valor));
      if (filtroIn) {
        const { columna, valores } = filtroIn;
        resultado = resultado.filter((f) => valores.includes(f[columna]));
      }
      resolve({ data: resultado, error: null });
    };
    return b;
  }

  const from = vi.fn((tabla: string) => builder(tabla));
  return { cliente: { from } as never, from, llamadasEq };
}

const FILA_PEDIDO_FLEX: FilaFixture = {
  id: PEDIDO_1,
  ml_shipment_id: "44760788897",
  codigo_interno: null,
  seller_id: SELLER_1,
  estado: "pendiente_asignacion",
  situacion_retiro: "pendiente",
  destinatario_comuna: "Maipú",
};

const FILA_PEDIDO_SAME_DAY: FilaFixture = {
  id: "40000000-0000-0000-0000-000000000002",
  ml_shipment_id: null,
  codigo_interno: "RX-7K2M-9PQR",
  seller_id: SELLER_2,
  estado: "pendiente_asignacion",
  situacion_retiro: "pendiente",
  destinatario_comuna: "Ñuñoa",
};

const FILA_PEDIDO_OTRO_TENANT: FilaFixture = {
  id: PEDIDO_AJENO,
  ml_shipment_id: "99999999999",
  codigo_interno: null,
  seller_id: SELLER_1,
  estado: "pendiente_asignacion",
  situacion_retiro: "pendiente",
  destinatario_comuna: "Providencia",
};

describe("buscarPedidosPorCodigos", () => {
  it("resuelve flex_qr por ml_shipment_id y rutax_interno por codigo_interno, en lote", async () => {
    const { cliente } = crearCliente({
      pedidos: [{ ...FILA_PEDIDO_FLEX, tenant_id: TENANT_A }, { ...FILA_PEDIDO_SAME_DAY, tenant_id: TENANT_A }],
    });

    const resultado = await buscarPedidosPorCodigos(cliente, TENANT_A, [
      { formato: "flex_qr", codigoNormalizado: "44760788897" },
      { formato: "rutax_interno", codigoNormalizado: "RX-7K2M-9PQR" },
      { formato: "desconocido", codigoNormalizado: "sha256:aaa" },
    ]);

    expect(resultado.size).toBe(2);
    expect(resultado.get("44760788897")?.pedidoId).toBe(PEDIDO_1);
    expect(resultado.get("44760788897")?.codigoVisible).toBe("44760788897");
    expect(resultado.get("RX-7K2M-9PQR")?.codigoVisible).toBe("RX-7K2M-9PQR");
  });

  it("'desconocido' NUNCA dispara una consulta contra pedidos — nada que buscar", async () => {
    const { cliente, from } = crearCliente({ pedidos: [] });

    await buscarPedidosPorCodigos(cliente, TENANT_A, [
      { formato: "desconocido", codigoNormalizado: "sha256:aaa" },
    ]);

    expect(from).not.toHaveBeenCalled();
  });

  it("AISLAMIENTO: un shipment id que existe en OTRO tenant no aparece en el resultado", async () => {
    const { cliente, llamadasEq } = crearCliente({
      pedidos: [{ ...FILA_PEDIDO_OTRO_TENANT, tenant_id: OTRO_TENANT }],
    });

    const resultado = await buscarPedidosPorCodigos(cliente, TENANT_A, [
      { formato: "flex_qr", codigoNormalizado: "99999999999" },
    ]);

    expect(resultado.size).toBe(0);
    // El doble de verdad filtró por tenant_id = TENANT_A (no un .eq() no-op).
    expect(llamadasEq).toContainEqual({ tabla: "pedidos", columna: "tenant_id", valor: TENANT_A });
  });

  it("sin items, no consulta nada", async () => {
    const { cliente, from } = crearCliente({ pedidos: [] });
    const resultado = await buscarPedidosPorCodigos(cliente, TENANT_A, []);
    expect(resultado.size).toBe(0);
    expect(from).not.toHaveBeenCalled();
  });

  it("propaga un error legible si Postgres falla", async () => {
    const cliente = {
      from: () => ({
        select: () => ({
          eq: () => ({
            in: () => Promise.resolve({ data: null, error: { message: "boom" } }),
          }),
        }),
      }),
    } as never;

    await expect(
      buscarPedidosPorCodigos(cliente, TENANT_A, [{ formato: "flex_qr", codigoNormalizado: "1" }]),
    ).rejects.toThrow(/boom/);
  });
});

describe("buscarPedidosPorIds", () => {
  it("resuelve por id y respeta el aislamiento por tenant", async () => {
    const { cliente } = crearCliente({
      pedidos: [{ ...FILA_PEDIDO_FLEX, tenant_id: TENANT_A }, { ...FILA_PEDIDO_OTRO_TENANT, tenant_id: OTRO_TENANT }],
    });

    const resultado = await buscarPedidosPorIds(cliente, TENANT_A, [PEDIDO_1, PEDIDO_AJENO]);

    expect(resultado.size).toBe(1);
    expect(resultado.has(PEDIDO_1)).toBe(true);
    expect(resultado.has(PEDIDO_AJENO)).toBe(false);
  });

  it("lista vacía no consulta nada", async () => {
    const { cliente, from } = crearCliente({ pedidos: [] });
    await buscarPedidosPorIds(cliente, TENANT_A, []);
    expect(from).not.toHaveBeenCalled();
  });
});

describe("resolverNombresSellers", () => {
  it("mapea id -> razon_social, acotado al tenant", async () => {
    const { cliente } = crearCliente({
      sellers: [
        { id: SELLER_1, razon_social: "Tienda Uno SpA", tenant_id: TENANT_A },
        { id: SELLER_2, razon_social: "Otro courier", tenant_id: OTRO_TENANT },
      ],
    });

    const resultado = await resolverNombresSellers(cliente, TENANT_A, [SELLER_1, SELLER_2]);

    expect(resultado.get(SELLER_1)).toBe("Tienda Uno SpA");
    expect(resultado.has(SELLER_2)).toBe(false); // de otro tenant
  });
});

describe("construirDtoPedidoRetiro — función pura", () => {
  const candidatoBase: PedidoCandidatoRetiro = {
    pedidoId: PEDIDO_1,
    codigoVisible: "44760788897",
    sellerId: SELLER_1,
    comuna: "Maipú",
    estado: "pendiente_asignacion",
    situacionRetiro: "pendiente",
  };

  it("caso normal: mismo seller de la bodega, sin alertas", () => {
    const dto = construirDtoPedidoRetiro(candidatoBase, "Tienda Uno SpA", SELLER_1);
    expect(dto).toEqual({
      pedidoId: PEDIDO_1,
      codigoVisible: "44760788897",
      sellerNombre: "Tienda Uno SpA",
      comuna: "Maipú",
      esDeEstaBodega: true,
      yaRetirado: false,
      alerta: null,
    });
  });

  it("un bulto de OTRO seller aparecido en esta bodega: esDeEstaBodega = false", () => {
    const dto = construirDtoPedidoRetiro(candidatoBase, "Tienda Uno SpA", SELLER_2);
    expect(dto.esDeEstaBodega).toBe(false);
  });

  it("pedido cancelado -> alerta 'cancelado'", () => {
    const dto = construirDtoPedidoRetiro({ ...candidatoBase, estado: "cancelado" }, "x", SELLER_1);
    expect(dto.alerta).toBe("cancelado");
  });

  it("ya estaba retirado -> alerta 'ya_retirado' y yaRetirado = true", () => {
    const dto = construirDtoPedidoRetiro({ ...candidatoBase, situacionRetiro: "retirado" }, "x", SELLER_1);
    expect(dto.yaRetirado).toBe(true);
    expect(dto.alerta).toBe("ya_retirado");
  });

  it("cancelado Y ya retirado -> prioriza 'cancelado' (más urgente operativamente)", () => {
    const dto = construirDtoPedidoRetiro(
      { ...candidatoBase, estado: "cancelado", situacionRetiro: "retirado" },
      "x",
      SELLER_1,
    );
    expect(dto.alerta).toBe("cancelado");
  });
});
