import { describe, expect, it } from "vitest";

import { filtroPedidosDelDia } from "./dia-operativo";

describe("filtroPedidosDelDia", () => {
  const filtro = filtroPedidosDelDia("2026-08-27");

  it("incluye los que tienen la fecha del día", () => {
    expect(filtro).toContain("fecha_compromiso.eq.2026-08-27");
  });

  it("🔴 incluye también los SIN fecha creados ese día", () => {
    // La mitad que faltaba en la lista de Pedidos: un `.eq` pelado los dejaba
    // fuera, porque en SQL un NULL no satisface ninguna comparación. El
    // Dashboard sí los contaba, y por eso decía «1 de 27» mientras la lista
    // mostraba 17.
    expect(filtro).toContain("fecha_compromiso.is.null");
    expect(filtro).toContain("creado_en.gte.");
    expect(filtro).toContain("creado_en.lt.");
  });

  it("acota los sin fecha al DÍA de Santiago, no a un día UTC", () => {
    // Chile está en UTC−4/−3, así que el día local empieza de madrugada en UTC.
    // Con límites UTC, un pedido creado a las 21:00 de Santiago caería en el día
    // siguiente y desaparecería del panel justo en el peak del despacho.
    const desde = filtro.match(/creado_en\.gte\.([^,)]+)/)?.[1];
    expect(desde).toBeDefined();
    expect(desde).not.toMatch(/^2026-08-27T00:00/);
    expect(desde?.startsWith("2026-08-27T0")).toBe(true);
  });

  it("los dos criterios van en UNA sola condición `or`", () => {
    // Si el `and(...)` de los sin fecha se soltara del `or`, PostgREST lo
    // aplicaría como filtro adicional y el resultado quedaría vacío.
    expect(filtro).toMatch(/^fecha_compromiso\.eq\.[^,]+,and\(/);
    expect(filtro.endsWith(")")).toBe(true);
  });
});
