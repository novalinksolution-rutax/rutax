import { describe, expect, it } from "vitest";
import { decidirSiguienteAccion } from "./siguiente-accion-datos";

describe("decidirSiguienteAccion", () => {
  it("un pedido real apaga la tarjeta, haya lo que haya", () => {
    expect(decidirSiguienteAccion({ pedidosReales: 1, sellers: 0, conductoresActivos: 0 })).toBeNull();
  });
  it("una sola acción a la vez, en orden", () => {
    expect(decidirSiguienteAccion({ pedidosReales: 0, sellers: 0, conductoresActivos: 0 })).toBe("invitar_seller");
    expect(decidirSiguienteAccion({ pedidosReales: 0, sellers: 1, conductoresActivos: 0 })).toBe("sumar_conductor");
    expect(decidirSiguienteAccion({ pedidosReales: 0, sellers: 1, conductoresActivos: 2 })).toBe("esperar_pedido");
  });
});
