import { describe, expect, it } from "vitest";

import { armarBitacoraPedido } from "./bitacora-pedido";

function fila(p: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "b-1",
    creado_en: "2026-08-25T14:04:00Z",
    accion: "pedido.cancelado",
    actor_tipo: "usuario",
    actor_usuario_id: "u-1",
    detalle: {},
    ...p,
  };
}

const nombres = { "u-1": { nombreCompleto: "C. Rojas" } };

describe("armarBitacoraPedido", () => {
  it("traduce la acción y nombra al autor", () => {
    const [e] = armarBitacoraPedido([fila()], nombres);
    expect(e.autor).toBe("C. Rojas");
    expect(e.frase).toBe("canceló el pedido");
  });

  it("🔴 una acción desconocida se muestra con su nombre técnico, no con un genérico", () => {
    // En una bitácora, un rótulo bonito que no dice qué pasó es peor que un
    // identificador feo: el feo se puede buscar en el código.
    const [e] = armarBitacoraPedido([fila({ accion: "pedido.algo_nuevo" })], nombres);
    expect(e.frase).toBe("pedido.algo_nuevo");
  });

  it("🔴 distingue «lo hizo el sistema» de «no pude resolver el nombre»", () => {
    // Son dos cosas distintas y confundirlas disfraza un fallo de lectura de
    // proceso automático — justo en el registro que existe para saber quién fue.
    const [sistema] = armarBitacoraPedido(
      [fila({ actor_tipo: "sistema", actor_usuario_id: null })],
      nombres,
    );
    expect(sistema.autor).toBeNull();

    const [huerfano] = armarBitacoraPedido([fila({ actor_usuario_id: "u-desconocido" })], nombres);
    expect(huerfano.autor).toBe("Usuario no encontrado");
  });

  it("trae el motivo cuando la acción lo exigía, y solo entonces", () => {
    const [con] = armarBitacoraPedido([fila({ detalle: { motivo: "  seller se arrepintió  " } })], nombres);
    expect(con.motivo).toBe("seller se arrepintió");

    const [sin] = armarBitacoraPedido([fila({ detalle: { motivo: "   " } })], nombres);
    expect(sin.motivo).toBeNull();
  });

  it("las dos anulaciones de dinero tienen frase propia", () => {
    // Son las acciones de la zona de consecuencia: si aparecieran con su nombre
    // técnico, el bloque que existe para dar cuenta de ellas no daría cuenta.
    const filas = [
      fila({ accion: "dinero.linea_cobro_anulada_manual" }),
      fila({ accion: "dinero.linea_liquidacion_anulada_manual" }),
    ];
    const [cobro, liq] = armarBitacoraPedido(filas, nombres);
    expect(cobro.frase).toBe("anuló el cobro al seller");
    expect(liq.frase).toBe("anuló la liquidación al conductor");
  });
});
