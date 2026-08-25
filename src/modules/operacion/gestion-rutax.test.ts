import { describe, expect, it } from "vitest";

import { loEntregoOtro, type PedidoParaGestion } from "./gestion-rutax";

function pedido(p: Partial<PedidoParaGestion> = {}): PedidoParaGestion {
  return {
    estado: "entregado",
    driverIdAsignado: null,
    situacionRetiro: "pendiente",
    ...p,
  };
}

describe("loEntregoOtro", () => {
  it("terminado, sin conductor y sin retiro: lo entregó otro", () => {
    // El caso real: Mercado Libre despachó el envío con su propia logística y
    // el pedido llegó a `entregado` sin que la flota lo tocara nunca.
    expect(loEntregoOtro(pedido())).toBe(true);
  });

  it("🔴 un pedido PENDIENTE nunca se marca, aunque no tenga conductor", () => {
    // No es ajeno: es nuestro y todavía no asignado. Marcarlo sería mentir
    // sobre un pedido que está esperando a que alguien lo tome — y es
    // justamente el que hay que ver.
    for (const estado of ["pendiente_asignacion", "asignado", "en_ruta"]) {
      expect(loEntregoOtro(pedido({ estado }))).toBe(false);
    }
  });

  it("🔴 basta UNA huella para que sea nuestro", () => {
    // Las tres condiciones son un `y`. Un conductor que lo cargó y después se
    // cayó dejó su huella: marcarlo como ajeno le borra el trabajo a alguien.
    expect(loEntregoOtro(pedido({ driverIdAsignado: "c-1" }))).toBe(false);
    expect(loEntregoOtro(pedido({ situacionRetiro: "retirado" }))).toBe(false);
  });

  it("aplica a todos los terminales, no solo a «entregado»", () => {
    // Un cancelado que nunca tocamos tampoco es nuestro.
    for (const estado of ["cancelado", "devuelto", "no_procesado", "fallido"]) {
      expect(loEntregoOtro(pedido({ estado }))).toBe(true);
    }
  });

  it("un retiro que no llegó a «retirado» no cuenta como huella", () => {
    // `pendiente` es el default de la columna: si contara, ningún pedido se
    // marcaría nunca y la regla no haría nada.
    expect(loEntregoOtro(pedido({ situacionRetiro: null }))).toBe(true);
    expect(loEntregoOtro(pedido({ situacionRetiro: "pendiente" }))).toBe(true);
  });
});
