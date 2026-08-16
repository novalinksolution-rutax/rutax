import { describe, it, expect } from "vitest";
import {
  sanearFiltroEstadoPedido,
  sanearFiltroFuentePedido,
  sanearFiltroUuid,
  sanearFiltroFechaCivil,
  sanearNumeroPagina,
} from "./sanear-filtros";

/**
 * Regresión (frontend, 2026-08-11): `/operaciones?estado=todos` (o un
 * `?seller=`/`?conductor=` no-UUID, o una `?fecha=` fuera de rango) hacía
 * caer la consulta a Postgres, y la pantalla completa mostraba "No pudimos
 * cargar los pedidos" en vez de simplemente ignorar el filtro roto.
 */
describe("sanearFiltroEstadoPedido", () => {
  it("acepta un estado válido del enum", () => {
    expect(sanearFiltroEstadoPedido("entregado")).toBe("entregado");
  });

  it("ignora un valor inválido en vez de dejarlo pasar (repro exacto: ?estado=todos)", () => {
    expect(sanearFiltroEstadoPedido("todos")).toBe("");
  });

  it("ignora undefined/null/vacío sin lanzar", () => {
    expect(sanearFiltroEstadoPedido(undefined)).toBe("");
    expect(sanearFiltroEstadoPedido(null)).toBe("");
    expect(sanearFiltroEstadoPedido("")).toBe("");
  });
});

describe("sanearFiltroFuentePedido", () => {
  it("acepta cada valor válido del enum de fuente", () => {
    expect(sanearFiltroFuentePedido("ml_flex")).toBe("ml_flex");
    expect(sanearFiltroFuentePedido("rutax_manual")).toBe("rutax_manual");
    expect(sanearFiltroFuentePedido("shopify")).toBe("shopify");
  });

  it("ignora un valor que no está en FUENTES_PEDIDO (p. ej. un tipo_pedido colado por error)", () => {
    expect(sanearFiltroFuentePedido("flex")).toBe("");
    expect(sanearFiltroFuentePedido("same_day")).toBe("");
    expect(sanearFiltroFuentePedido("todas")).toBe("");
  });

  it("ignora undefined/null/vacío sin lanzar", () => {
    expect(sanearFiltroFuentePedido(undefined)).toBe("");
    expect(sanearFiltroFuentePedido(null)).toBe("");
    expect(sanearFiltroFuentePedido("")).toBe("");
  });
});

describe("sanearFiltroUuid", () => {
  it("acepta un UUID válido", () => {
    const uuid = "feb7040c-21e4-4380-82ac-f6f3230ecb01";
    expect(sanearFiltroUuid(uuid)).toBe(uuid);
  });

  it("ignora un valor que no es UUID (marcador viejo, texto arbitrario)", () => {
    expect(sanearFiltroUuid("todos")).toBe("");
    expect(sanearFiltroUuid("12345")).toBe("");
  });

  it("ignora undefined/null/vacío sin lanzar", () => {
    expect(sanearFiltroUuid(undefined)).toBe("");
    expect(sanearFiltroUuid(null)).toBe("");
    expect(sanearFiltroUuid("")).toBe("");
  });
});

describe("sanearFiltroFechaCivil", () => {
  it("acepta una fecha civil válida", () => {
    expect(sanearFiltroFechaCivil("2026-08-11")).toBe("2026-08-11");
  });

  it("ignora un formato que no es YYYY-MM-DD", () => {
    expect(sanearFiltroFechaCivil("todos")).toBe("");
    expect(sanearFiltroFechaCivil("11-08-2026")).toBe("");
  });

  it("ignora una fecha con día/mes fuera de rango que Postgres rechazaría (JS la normaliza en silencio, no basta con isNaN)", () => {
    expect(sanearFiltroFechaCivil("2026-02-30")).toBe("");
    expect(sanearFiltroFechaCivil("2026-13-01")).toBe("");
  });

  it("ignora undefined/null/vacío sin lanzar", () => {
    expect(sanearFiltroFechaCivil(undefined)).toBe("");
    expect(sanearFiltroFechaCivil(null)).toBe("");
    expect(sanearFiltroFechaCivil("")).toBe("");
  });
});

describe("sanearNumeroPagina", () => {
  it("acepta un número de página válido", () => {
    expect(sanearNumeroPagina("3")).toBe(3);
  });

  it("cae a 1 cuando el valor no es numérico, en vez de propagar NaN (repro: Math.max(1, NaN) === NaN)", () => {
    expect(sanearNumeroPagina("abc")).toBe(1);
    expect(Number.isNaN(sanearNumeroPagina("abc"))).toBe(false);
  });

  it("cae a 1 con página 0 o negativa", () => {
    expect(sanearNumeroPagina("0")).toBe(1);
    expect(sanearNumeroPagina("-5")).toBe(1);
  });

  it("cae a 1 cuando no viene el parámetro", () => {
    expect(sanearNumeroPagina(undefined)).toBe(1);
    expect(sanearNumeroPagina(null)).toBe(1);
  });
});
