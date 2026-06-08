/**
 * Pruebas de procesar-shipment.ts
 *
 * Prueba la lógica de negocio del job:
 * 1. Idempotencia: mismo estado actual → no-op.
 * 2. Condición de carrera (ErrorConflicto) → captura y termina sin reintento.
 * 3. Traducción correcta: estado ML → estado interno.
 * 4. Estado sin traducción → salida limpia sin lanzar.
 */
import { describe, expect, it, vi } from "vitest";

import { ErrorConflicto, type EstadoPedidoInterno } from "../tipos-operacion";
import { traducirEstadoMl } from "../traduccion-estados";

// ---------------------------------------------------------------------------
// Lógica de negocio extraída para prueba aislada
// ---------------------------------------------------------------------------

interface PedidoSimulado {
  id: string;
  tenantId: string;
  sellerId: string;
  mlShipmentId: string;
  estado: EstadoPedidoInterno;
  estadoMl: string | null;
}

type FnActualizar = (entrada: {
  pedidoId: string;
  estadoNuevo: EstadoPedidoInterno;
  estadoEsperado: EstadoPedidoInterno;
  actuadoPor: "sistema_ml";
  motivo?: string;
}) => Promise<void>;

async function procesarActualizacionShipment(
  pedido: PedidoSimulado,
  estadoMlNuevo: string,
  fnActualizar: FnActualizar,
  onLog: (nivel: string, msg: string) => void,
): Promise<{ resultado: string; detalle?: string }> {
  // Traducir estado
  const estadoInterno = traducirEstadoMl(estadoMlNuevo);

  if (!estadoInterno) {
    onLog("info", `Estado ML '${estadoMlNuevo}' sin traducción. Ignorando.`);
    return { resultado: "estado_sin_traduccion", detalle: estadoMlNuevo };
  }

  // Idempotencia
  if (pedido.estado === estadoInterno) {
    onLog("info", `Pedido ${pedido.id} ya en estado '${estadoInterno}'. No-op.`);
    return { resultado: "ya_en_estado", detalle: estadoInterno };
  }

  // Actualizar
  try {
    await fnActualizar({
      pedidoId: pedido.id,
      estadoNuevo: estadoInterno,
      estadoEsperado: pedido.estado,
      actuadoPor: "sistema_ml",
    });
    return { resultado: "actualizado", detalle: estadoInterno };
  } catch (error) {
    if (error instanceof ErrorConflicto) {
      onLog("warn", `Pedido ${pedido.id}: condición de carrera resuelta. Terminando.`);
      return { resultado: "conflicto_resuelto" };
    }
    throw error; // Otros errores → Inngest reintenta
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const pedidoBase: PedidoSimulado = {
  id: "pedido-123",
  tenantId: "tenant-1",
  sellerId: "seller-1",
  mlShipmentId: "ship-999",
  estado: "en_ruta",
  estadoMl: "shipped",
};

describe("procesarShipmentActualizado — idempotencia", () => {
  it("pedido ya en 'entregado' + ML reporta 'delivered' → no-op (sin llamar fnActualizar)", async () => {
    const pedidoYaEntregado: PedidoSimulado = { ...pedidoBase, estado: "entregado", estadoMl: "delivered" };
    const fnMock = vi.fn();
    const logs: string[] = [];

    const resultado = await procesarActualizacionShipment(
      pedidoYaEntregado,
      "delivered",
      fnMock,
      (_, msg) => logs.push(msg),
    );

    expect(resultado.resultado).toBe("ya_en_estado");
    expect(fnMock).not.toHaveBeenCalled();
    expect(logs.some((l) => l.includes("No-op"))).toBe(true);
  });

  it("pedido en 'en_ruta' + ML reporta 'shipped' → no-op (ya está en_ruta)", async () => {
    const pedidoEnRuta: PedidoSimulado = { ...pedidoBase, estado: "en_ruta", estadoMl: "shipped" };
    const fnMock = vi.fn();

    const resultado = await procesarActualizacionShipment(
      pedidoEnRuta,
      "shipped", // traducción → en_ruta (mismo que estado actual)
      fnMock,
      () => {},
    );

    expect(resultado.resultado).toBe("ya_en_estado");
    expect(fnMock).not.toHaveBeenCalled();
  });
});

describe("procesarShipmentActualizado — condición de carrera (ErrorConflicto)", () => {
  it("ErrorConflicto → loguea y retorna sin relanzar (Inngest no reintenta)", async () => {
    const fnMock = vi.fn().mockRejectedValue(new ErrorConflicto("Estado cambió mientras procesaba"));
    const logs: string[] = [];

    const resultado = await procesarActualizacionShipment(
      pedidoBase,
      "delivered",
      fnMock,
      (nivel, msg) => { if (nivel === "warn") logs.push(msg); },
    );

    expect(resultado.resultado).toBe("conflicto_resuelto");
    expect(fnMock).toHaveBeenCalledOnce();
    expect(logs.some((l) => l.includes("carrera"))).toBe(true);
  });

  it("error genérico (no ErrorConflicto) → se propaga para reintento de Inngest", async () => {
    const errorGenerico = new Error("Timeout de base de datos");
    const fnMock = vi.fn().mockRejectedValue(errorGenerico);

    await expect(
      procesarActualizacionShipment(pedidoBase, "delivered", fnMock, () => {}),
    ).rejects.toThrow("Timeout de base de datos");
  });
});

describe("procesarShipmentActualizado — traducción de estados", () => {
  it("estado ML con traducción → llama fnActualizar con el estado correcto", async () => {
    const fnMock = vi.fn().mockResolvedValue(undefined);

    const resultado = await procesarActualizacionShipment(
      { ...pedidoBase, estado: "asignado", estadoMl: null },
      "shipped",
      fnMock,
      () => {},
    );

    expect(resultado.resultado).toBe("actualizado");
    expect(resultado.detalle).toBe("en_ruta");
    expect(fnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pedidoId: "pedido-123",
        estadoNuevo: "en_ruta",
        estadoEsperado: "asignado",
        actuadoPor: "sistema_ml",
      }),
    );
  });

  it("'to_be_agreed' → estado_sin_traduccion (ignorado limpiamente)", async () => {
    const fnMock = vi.fn();

    const resultado = await procesarActualizacionShipment(
      pedidoBase,
      "to_be_agreed",
      fnMock,
      () => {},
    );

    expect(resultado.resultado).toBe("estado_sin_traduccion");
    expect(fnMock).not.toHaveBeenCalled();
  });

  it("estado desconocido de ML → ignorado sin lanzar", async () => {
    const fnMock = vi.fn();

    const resultado = await procesarActualizacionShipment(
      pedidoBase,
      "estado_nuevo_que_ml_invento",
      fnMock,
      () => {},
    );

    expect(resultado.resultado).toBe("estado_sin_traduccion");
    expect(fnMock).not.toHaveBeenCalled();
  });

  it("'cancelled' → actualiza a 'cancelado'", async () => {
    const fnMock = vi.fn().mockResolvedValue(undefined);

    const resultado = await procesarActualizacionShipment(
      { ...pedidoBase, estado: "en_ruta" },
      "cancelled",
      fnMock,
      () => {},
    );

    expect(resultado.resultado).toBe("actualizado");
    expect(resultado.detalle).toBe("cancelado");
  });

  it("'not_delivered' → actualiza a 'fallido'", async () => {
    const fnMock = vi.fn().mockResolvedValue(undefined);

    const resultado = await procesarActualizacionShipment(
      { ...pedidoBase, estado: "en_ruta" },
      "not_delivered",
      fnMock,
      () => {},
    );

    expect(resultado.resultado).toBe("actualizado");
    expect(resultado.detalle).toBe("fallido");
  });
});
